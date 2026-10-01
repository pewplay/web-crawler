// Game state and rules. Based on the original gamelogic.js by kostik1337 & lampysprites.
// Changes for PewPlay: fixed 60 Hz simulation (the original tied the level clock to the
// display refresh rate), pause when hidden, "resume" in the menu, saved settings,
// touch / mouse joystick and responsive camera.
"use strict";

const STATE_MENU = 0;
const STATE_START_CUTSCENE = 1;
const STATE_GAME = 2;
const STATE_END = 3;

const SIM_STEP_MS = 1000 / 60;

class Vec2 {
    constructor(x, y) { this.x = x; this.y = y; }
    addEq(x, y) { this.x += x; this.y += y; }
    mul(a) { return new Vec2(this.x * a, this.y * a); }
    mixEq(x, y, t) {
        this.x = this.x * (1 - t) + x * t;
        this.y = this.y * (1 - t) + y * t;
    }
    dot(v) { return this.x * v.x + this.y * v.y; }
    set(x, y) { this.x = x; this.y = y; }
}

const Store = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem("web-crawler:" + key);
            return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem("web-crawler:" + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }
};

const DIFFICULTY_NAMES = ["very easy", "easy", "normal", "hardcore"];
// the difficulty changes how fast the level clock (lasers, fans, waves...) runs
const DIFFICULTY_TIME_STEP = [1 / 80, 1 / 70, 1 / 60, 1 / 50];
const GRAPHICS_NAMES = ["low", "medium", "high"];
const GRAPHICS_DIVIDE = [4, 2, 1];

const settings = {
    difficulty: clampInt(Store.get("difficulty", 1), 0, 3, 1),
    graphics: clampInt(Store.get("graphics", 2), 0, 2, 2),
    speedrunMode: Store.get("speedrun", false) === true
};

function clampInt(v, lo, hi, fallback) {
    return Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
}

const game = {
    state: -1,
    time: 0,
    runInProgress: false,
    runTimeMs: 0,
    menuSelection: 0,
    menuRects: [],
    cutsceneDone: false,
    textDirty: true,
    player: null
};

function newPlayer() {
    return {
        pos: new Vec2(0, 0),
        cam: new Vec2(0, 0),
        maxVelocity: 0.005,
        reqSpeed: new Vec2(0, 0),
        speed: new Vec2(0, 0),
        lastCheckpointId: -1,
        lastCheckpointPos: new Vec2(0.5, -0.9),
        isDead: false,
        deadTimer: 0,
        deathFactor: 0,
        checkpointFactor: 0,
        endFactor: 0,
        isEnd: false,
        solidNormal: null
    };
}
game.player = newPlayer();

// ------------------------------------------------------------------ menu

function menuItems() {
    const items = [];
    if (game.runInProgress) items.push({ id: "resume", label: "resume" });
    items.push({ id: "play", label: game.runInProgress ? "new game" : "play" });
    items.push({ id: "difficulty", label: `difficulty: ${DIFFICULTY_NAMES[settings.difficulty]}` });
    items.push({ id: "graphics", label: `graphics: ${GRAPHICS_NAMES[settings.graphics]}` });
    return items;
}

function menuHint() {
    return Input.prefersTouch() ? "tap an option" : "arrow keys: choose & change  |  Enter: confirm";
}

function redrawText() { game.textDirty = true; }

function menuMove(dir) {
    const n = menuItems().length;
    game.menuSelection = (game.menuSelection + dir + n) % n;
    Sound.menuChange(false);
    redrawText();
}

function menuChange(dir) {
    const item = menuItems()[game.menuSelection];
    if (!item) return;
    if (item.id === "difficulty") {
        settings.difficulty = (settings.difficulty + dir + 4) % 4;
        Store.set("difficulty", settings.difficulty);
    } else if (item.id === "graphics") {
        settings.graphics = (settings.graphics + dir + 3) % 3;
        Store.set("graphics", settings.graphics);
    } else return;
    Sound.menuChange(true);
    redrawText();
}

function menuActivate(index) {
    const item = menuItems()[index];
    if (!item) return;
    game.menuSelection = index;
    if (item.id === "resume") {
        Sound.menuChange(true);
        setState(STATE_GAME, true);
    } else if (item.id === "play") {
        Sound.menuChange(true);
        setState(STATE_START_CUTSCENE);
    } else {
        menuChange(1);
    }
}

// ------------------------------------------------------------------ states

let cutsceneToken = 0;

function runCutscene(script) {
    const token = ++cutsceneToken;
    const forState = game.state;
    game.cutsceneDone = false;
    Terminal.clearTerminal();
    redrawText();
    Terminal.play(script, () => token !== cutsceneToken || game.state !== forState,
        redrawText, () => Sound.typing())
        .then(done => { if (done && token === cutsceneToken) game.cutsceneDone = true; });
}

function setState(state, resume) {
    const prev = game.state;
    game.state = state;
    cutsceneToken++;
    Input.resetMovement();
    if (state === STATE_MENU) {
        Sound.ambient(false);
        const n = menuItems().length;
        game.menuSelection = game.runInProgress ? 0 : Math.min(game.menuSelection, n - 1);
        redrawText();
    } else if (state === STATE_START_CUTSCENE) {
        game.runInProgress = false;
        runCutscene(startCutsceneScript(Input.prefersTouch()));
    } else if (state === STATE_END) {
        game.runInProgress = false;
        runCutscene(endCutsceneScript(Input.prefersTouch(), settings.speedrunMode,
            formatTime(game.runTimeMs), DIFFICULTY_NAMES[settings.difficulty]));
    } else if (state === STATE_GAME) {
        Sound.ambient(true);
        if (!(resume && game.runInProgress)) {
            game.time = 0;
            game.runTimeMs = 0;
            game.runInProgress = true;
            game.player = newPlayer();
            playerResurrect();
            game.player.cam.set(game.player.pos.x, game.player.pos.y);
        }
    }
    UI.onStateChange(state, prev);
}

function playerResurrect() {
    const p = game.player;
    p.isDead = false;
    p.deathFactor = 0;
    p.speed.set(0, 0);
    p.pos.set(p.lastCheckpointPos.x, p.lastCheckpointPos.y);
}

function formatTime(t) {
    t = Math.floor(t);
    const ms = t % 1000, s = Math.floor(t / 1000) % 60, m = Math.floor(t / 60000);
    const pad = (v, n) => String(v).padStart(n, "0");
    return `${pad(m, 2)}:${pad(s, 2)}:${pad(ms, 3)}`;
}

function toggleSpeedrun() {
    settings.speedrunMode = !settings.speedrunMode;
    Store.set("speedrun", settings.speedrunMode);
    UI.updateTimer();
}

// ------------------------------------------------------------------ simulation (60 Hz)

function step() {
    const p = game.player;
    game.time += DIFFICULTY_TIME_STEP[settings.difficulty];

    if (game.state !== STATE_GAME) {
        p.endFactor *= 0.99;
        return;
    }

    game.runTimeMs += SIM_STEP_MS;

    const dir = Input.direction();
    p.reqSpeed.set(dir.x * p.maxVelocity, dir.y * p.maxVelocity);

    if (p.isDead) {
        p.speed.set(0, 0);
        if (--p.deadTimer <= 0) playerResurrect();
    } else {
        p.speed.mixEq(p.reqSpeed.x, p.reqSpeed.y, 0.3);
        p.pos.addEq(p.speed.x, p.speed.y);
        // slide along walls: remove the velocity component going into the solid
        if (p.solidNormal) {
            const dot = p.solidNormal.dot(p.speed);
            if (dot < 0) {
                const offset = p.solidNormal.mul(-dot);
                p.pos.addEq(offset.x, offset.y);
            }
        }
    }
    p.cam.mixEq(p.pos.x, p.pos.y, 0.1);

    p.deathFactor *= 0.92;
    p.checkpointFactor *= 0.95;
    if (p.isEnd) {
        p.endFactor += (1 - p.endFactor) * 0.03;
        if (p.endFactor > 0.99) setState(STATE_END);
    }
}

// Reads the data pixels the game shader wrote for the player's position.
function applyCollision(px) {
    const p = game.player;
    if (!px || p.isEnd) return;

    p.solidNormal = px[0] > 1
        ? new Vec2(2 * px[1] / 255 - 1, 2 * px[2] / 255 - 1)
        : null;

    const isCheckpoint = px[8] > 1;
    if (px[4] > 1 && !isCheckpoint && !p.isDead) {
        p.isDead = true;
        p.deathFactor = 1;
        p.deadTimer = 30; // half a second
        Sound.death();
    }

    const checkpointId = Math.round(px[9]);
    if (isCheckpoint && checkpointId >= p.lastCheckpointId) {
        if (checkpointId === 255) {
            p.isEnd = true;
            Sound.checkpoint();
            return;
        }
        if (checkpointId > p.lastCheckpointId) {
            p.checkpointFactor = 1;
            Sound.checkpoint();
        }
        p.lastCheckpointPos.set(p.pos.x, p.pos.y);
        p.lastCheckpointId = checkpointId;
    }
}

// ------------------------------------------------------------------ actions (keyboard, gamepad, taps)

function onAction(action) {
    switch (game.state) {
        case STATE_MENU:
            if (action === "up") menuMove(-1);
            else if (action === "down") menuMove(1);
            else if (action === "left") menuChange(-1);
            else if (action === "right") menuChange(1);
            else if (action === "confirm") menuActivate(game.menuSelection);
            else if (action === "back" && game.runInProgress) setState(STATE_GAME, true);
            break;
        case STATE_START_CUTSCENE:
            if (action === "confirm") setState(STATE_GAME);
            else if (action === "back") setState(STATE_MENU);
            break;
        case STATE_GAME:
            if (action === "back") setState(STATE_MENU);
            break;
        case STATE_END:
            if (action === "back" || (action === "confirm" && game.cutsceneDone)) setState(STATE_MENU);
            break;
    }
    if (action === "speedrun") toggleSpeedrun();
    if (action === "restart" && settings.speedrunMode && game.state !== STATE_MENU) setState(STATE_GAME);
}
