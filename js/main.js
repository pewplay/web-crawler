// Boot, main loop and the small HTML overlay (menu / mute / skip buttons, speedrun timer).
"use strict";

const UI = (() => {
    const btnMenu = document.getElementById("btn-menu");
    const btnMute = document.getElementById("btn-mute");
    const btnSkip = document.getElementById("btn-skip");
    const timer = document.getElementById("timer");

    // buttons must not start the joystick or count as a tap on the screen below
    [btnMenu, btnMute, btnSkip].forEach(b => {
        b.addEventListener("pointerdown", e => { e.stopPropagation(); Sound.unlock(); });
        b.addEventListener("contextmenu", e => e.preventDefault());
    });

    btnMenu.addEventListener("click", () => onAction("back"));
    btnSkip.addEventListener("click", () => onAction("confirm"));
    btnMute.addEventListener("click", () => {
        Sound.unlock();
        Sound.setMuted(!Sound.isMuted());
        Store.set("muted", Sound.isMuted());
        updateMute();
    });

    function updateMute() {
        const m = Sound.isMuted();
        btnMute.classList.toggle("muted", m);
        btnMute.setAttribute("aria-label", m ? "Unmute" : "Mute");
        btnMute.title = m ? "Unmute" : "Mute";
    }

    function updateTimer() {
        const show = settings.speedrunMode && game.state === STATE_GAME;
        timer.hidden = !show;
        if (show) timer.textContent = formatTime(game.runTimeMs);
        const skipLabel = game.cutsceneDone ? "Start \u203a" : "Skip \u203a";
        if (!btnSkip.hidden && btnSkip.textContent !== skipLabel) btnSkip.textContent = skipLabel;
    }

    function onStateChange(state) {
        btnMenu.hidden = state === STATE_MENU;
        btnSkip.hidden = state !== STATE_START_CUTSCENE;
        document.body.dataset.state = ["menu", "intro", "game", "end"][state];
        updateTimer();
    }

    Sound.setMuted(Store.get("muted", false) === true);
    updateMute();
    return { onStateChange, updateTimer };
})();

(function boot() {
    if (!Renderer.init()) {
        document.getElementById("nogl").hidden = false;
        return;
    }

    function resize() {
        Renderer.resize();
        const s = Renderer.size;
        Terminal.resize(s.cssW, s.cssH, s.scale);
        redrawText();
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 100));
    if (window.ResizeObserver) new ResizeObserver(resize).observe(document.getElementById("screen"));

    document.addEventListener("contextmenu", e => e.preventDefault());

    let last = performance.now();
    let acc = 0;

    document.addEventListener("visibilitychange", () => {
        Sound.setHidden(document.hidden);
        if (document.hidden) {
            // leave the run safely paused in the menu ("resume" brings you back)
            if (game.state === STATE_GAME && !game.player.isEnd) setState(STATE_MENU);
        } else {
            last = performance.now();
            acc = 0;
        }
    });

    function renderText() {
        if (!game.textDirty) return;
        game.textDirty = false;
        if (game.state === STATE_MENU) {
            game.menuRects = Terminal.drawMenu(menuItems(), game.menuSelection, menuHint());
        } else {
            Terminal.drawTerminal();
        }
        Renderer.uploadCanvas(Terminal.canvas);
    }

    function frame(now) {
        let dt = now - last;
        last = now;
        if (dt > 100) dt = 100;
        if (dt < 0) dt = 0;
        acc += dt;

        Input.pollGamepad();
        // fixed 60 Hz simulation; at most 3 steps per frame so that collisions, which are
        // read back from the rendered frame, are never skipped on slow devices
        let steps = 0;
        while (acc >= SIM_STEP_MS && steps < 3) {
            step();
            acc -= SIM_STEP_MS;
            steps++;
        }
        if (steps === 3) acc = Math.min(acc, SIM_STEP_MS);

        if (game.state === STATE_GAME) {
            applyCollision(Renderer.drawGame(game.time, game.player, GRAPHICS_DIVIDE[settings.graphics]));
        } else {
            renderText();
            Renderer.drawCrt(game.time, game.player.endFactor);
        }
        UI.updateTimer();
        requestAnimationFrame(frame);
    }

    setState(STATE_MENU);
    requestAnimationFrame(frame);
})();
