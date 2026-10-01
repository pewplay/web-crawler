// Input: keyboard (arrows / WASD, also ZQSD on AZERTY since physical key codes are used),
// gamepad (as in the original), and Pointer Events for mouse and touch:
// tap the menu, tap to skip/continue cutscenes, and a floating joystick while playing
// (press anywhere and drag).
"use strict";

const Input = (() => {
    const keys = { up: 0, down: 0, left: 0, right: 0 };
    const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    const pad = { x: 0, y: 0, prev: {} };
    let lastInput = window.matchMedia && matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
    let menuPress = -1;
    let tapStarted = false;

    const layer = document.getElementById("touch");
    const joyBase = document.getElementById("joy");
    const joyKnob = document.getElementById("joy-knob");

    const KEY_ACTIONS = {
        ArrowUp: "up", KeyW: "up",
        ArrowDown: "down", KeyS: "down",
        ArrowLeft: "left", KeyA: "left",
        ArrowRight: "right", KeyD: "right",
        Enter: "confirm", NumpadEnter: "confirm", Space: "confirm",
        Escape: "back",
        KeyT: "speedrun", KeyR: "restart"
    };

    function setLastInput(kind) {
        if (kind === lastInput) return;
        lastInput = kind;
        if (game.state === STATE_MENU) redrawText();
    }

    window.addEventListener("keydown", e => {
        const action = KEY_ACTIONS[e.code];
        if (!action) return;
        e.preventDefault();
        Sound.unlock();
        setLastInput("keyboard");
        if (action in keys) keys[action] = 1;
        if (!e.repeat) onAction(action);
    });
    window.addEventListener("keyup", e => {
        const action = KEY_ACTIONS[e.code];
        if (action in keys) keys[action] = 0;
    });
    window.addEventListener("blur", () => resetMovement());

    // ------------------------------------------------------------ pointer

    function stickRadius() {
        return Math.max(40, Math.min(72, Math.min(innerWidth, innerHeight) * 0.11));
    }

    function showStick(show) {
        joyBase.style.display = show ? "block" : "none";
        if (!show) return;
        const r = stickRadius();
        joyBase.style.width = joyBase.style.height = (2 * r) + "px";
        joyBase.style.transform = `translate(${stick.ox - r}px, ${stick.oy - r}px)`;
    }

    function updateStick(x, y) {
        const r = stickRadius();
        let dx = x - stick.ox, dy = y - stick.oy;
        let len = Math.hypot(dx, dy);
        // floating joystick: the base follows the finger when it goes past the rim
        if (len > r) {
            stick.ox += dx * (1 - r / len);
            stick.oy += dy * (1 - r / len);
            dx = x - stick.ox; dy = y - stick.oy; len = r;
        }
        const dead = 0.18;
        const m = len / r;
        if (m < dead) {
            stick.x = stick.y = 0;
        } else {
            const k = Math.min(1, (m - dead) / (1 - dead)) / m;
            // scaled so that pushing straight gives full speed and diagonals match the
            // keyboard (both axes at full speed)
            stick.x = clamp1(dx / r * k * Math.SQRT2);
            stick.y = clamp1(-dy / r * k * Math.SQRT2);
        }
        showStick(true);
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    function endStick() {
        stick.id = null;
        stick.x = stick.y = 0;
        showStick(false);
    }

    function menuHit(x, y) {
        const [tx, ty] = Renderer.screenToText(x, y);
        return game.menuRects.findIndex(r => tx >= r.x && tx <= r.x + r.w && ty >= r.y && ty <= r.y + r.h);
    }

    layer.addEventListener("pointerdown", e => {
        Sound.unlock();
        setLastInput(e.pointerType === "mouse" ? "mouse" : "touch");
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (game.state === STATE_MENU) {
            menuPress = menuHit(e.clientX, e.clientY);
            if (menuPress >= 0 && menuPress !== game.menuSelection) {
                game.menuSelection = menuPress;
                Sound.menuChange(false);
                redrawText();
            }
        } else if (game.state === STATE_GAME) {
            if (stick.id === null) {
                stick.id = e.pointerId;
                stick.ox = e.clientX; stick.oy = e.clientY;
                try { layer.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                updateStick(e.clientX, e.clientY);
            }
        } else {
            tapStarted = true;
        }
    });

    layer.addEventListener("pointermove", e => {
        if (stick.id === e.pointerId) {
            updateStick(e.clientX, e.clientY);
        } else if (game.state === STATE_MENU && e.pointerType === "mouse" && e.buttons === 0) {
            const i = menuHit(e.clientX, e.clientY);
            if (i >= 0 && i !== game.menuSelection) {
                game.menuSelection = i;
                redrawText();
            }
            layer.style.cursor = i >= 0 ? "pointer" : "default";
        }
    });

    function pointerEnd(e, cancelled) {
        if (stick.id === e.pointerId) { endStick(); return; }
        if (cancelled) { menuPress = -1; tapStarted = false; return; }
        if (game.state === STATE_MENU) {
            const i = menuHit(e.clientX, e.clientY);
            if (menuPress >= 0 && i === menuPress) menuActivate(i);
            menuPress = -1;
        } else if (tapStarted && (game.state === STATE_START_CUTSCENE || game.state === STATE_END)) {
            tapStarted = false;
            onAction("confirm");
        }
    }
    layer.addEventListener("pointerup", e => pointerEnd(e, false));
    layer.addEventListener("pointercancel", e => pointerEnd(e, true));

    // ------------------------------------------------------------ gamepad (polled every frame)

    function pollGamepad() {
        if (!navigator.getGamepads) return;
        let gp = null;
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
        if (!gp) { pad.x = pad.y = 0; return; }

        const btn = i => (gp.buttons[i] && gp.buttons[i].pressed) ? 1 : 0;
        const axis = (i) => {
            const v = gp.axes[i] || 0, dz = 0.33;
            return Math.abs(v) < dz ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - dz) / (1 - dz) * 1.2);
        };
        pad.x = clamp1(axis(0) + btn(15) - btn(14));
        pad.y = clamp1(-axis(1) + btn(12) - btn(13));

        const now = {
            up: pad.y > 0.5, down: pad.y < -0.5, left: pad.x < -0.5, right: pad.x > 0.5,
            confirm: btn(0) || btn(1) || btn(2) || btn(3), back: btn(9)
        };
        for (const a in now) {
            if (now[a] && !pad.prev[a]) {
                setLastInput("keyboard");
                Sound.unlock();
                onAction(a);
            }
        }
        pad.prev = now;
    }

    function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

    return {
        direction() {
            return {
                x: clamp1(keys.right - keys.left + stick.x + pad.x),
                y: clamp1(keys.up - keys.down + stick.y + pad.y)
            };
        },
        resetMovement() {
            keys.up = keys.down = keys.left = keys.right = 0;
            endStick();
            menuPress = -1;
            tapStarted = false;
        },
        prefersTouch: () => lastInput === "touch",
        pollGamepad
    };
})();
