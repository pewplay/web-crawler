// 2D text layer: title menu and the "terminal" cutscenes, drawn on an off-screen canvas
// that the CRT shader shows on screen. Rewritten from the original canvashelpers.js
// (an eval-driven typewriter) as a small script player with a re-flowable text model,
// so the cutscenes wrap and scale on any screen size and survive window resizes.
"use strict";

const Terminal = (() => {
    const canvas = document.createElement("canvas");
    const c = canvas.getContext("2d");

    const MONO = "'Andale Mono', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', monospace";
    const SANS = "'Lucida Sans Unicode', 'Lucida Grande', 'DejaVu Sans', sans-serif";
    const LOGO = "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Liberation Sans Narrow', sans-serif";

    let W = 1, H = 1, scale = 1;

    function resize(cssW, cssH, s) {
        W = cssW; H = cssH; scale = s;
        canvas.width = Math.max(1, Math.round(W * s));
        canvas.height = Math.max(1, Math.round(H * s));
    }

    function begin() {
        c.setTransform(scale, 0, 0, scale, 0, 0);
        c.clearRect(0, 0, W, H);
        c.textBaseline = "alphabetic";
        c.textAlign = "left";
    }

    function glowText(text, x, y, color, blur) {
        c.fillStyle = color;
        c.shadowColor = color + "b"; // #rgb -> #rgba
        c.shadowBlur = blur * scale;
        c.fillText(text, x, y);
    }

    // ---------------------------------------------------------------- menu

    function menuMetrics() {
        const portrait = W / H < 1.1;
        const em = portrait ? Math.min(W / 24, H / 44) : Math.min(W / 80, H / 36);
        return { portrait, em };
    }

    function drawLogo(cx, cy, maxWidth, em) {
        const text = "WEB CRAWLER";
        c.font = `bold 100px ${LOGO}`;
        const size = Math.min(6 * em, maxWidth / c.measureText(text).width * 100);
        c.font = `bold ${size}px ${LOGO}`;
        c.textAlign = "center";
        // misregistered fill + outline, like the original glitchy logo
        c.shadowColor = c.fillStyle = "#742";
        c.shadowBlur = 0.75 * em * scale;
        c.fillText(text, cx + size * 0.06, cy + size * 0.03);
        c.shadowBlur = 0;
        c.strokeStyle = "#fa7";
        c.lineWidth = Math.max(1, size / 60);
        c.strokeText(text, cx, cy);
        c.font = `bold ${1.4 * em}px ${MONO}`;
        c.shadowColor = c.fillStyle = "#742";
        c.shadowBlur = 0.75 * em * scale;
        c.fillText("..e.r.r.o.r..4.0.4..", cx, cy + size * 0.18 + 1.6 * em);
        c.textAlign = "left";
    }

    // items: [{label}], returns hit rectangles in text-canvas CSS px
    function drawMenu(items, selection, hint) {
        begin();
        const { portrait, em } = menuMetrics();
        const lh = (portrait ? 3.4 : 3.6) * em;
        const rects = [];
        c.font = `bold ${1.4 * em}px ${MONO}`;

        let menuX, menuTop, logoX, logoY, logoW;
        if (portrait) {
            logoX = W / 2; logoY = H * 0.32; logoW = W * 0.7;
            menuTop = H * 0.56 - (items.length - 1) * lh / 2;
            if (menuTop < logoY + 5 * em) menuTop = logoY + 5 * em;
        } else {
            menuX = Math.max(3 * em, W * 0.06);
            menuTop = H / 2 - (items.length - 1) * lh / 2;
            let menuRight = menuX;
            items.forEach(it => { menuRight = Math.max(menuRight, menuX + c.measureText(it.label).width); });
            logoX = (menuRight + W) / 2 + em;
            logoY = H / 2 - em;
            logoW = Math.min(W * 0.93 - logoX - 2 * em, logoX - menuRight - 2 * em) * 2;
        }

        items.forEach((it, i) => {
            const y = menuTop + i * lh;
            const color = i === selection ? "#9c4" : "#999";
            c.font = `bold ${1.4 * em}px ${MONO}`;
            const label = i === selection ? `> ${it.label}` : it.label;
            const tw = c.measureText(label).width;
            let x = portrait ? (W - tw) / 2 : menuX - c.measureText("> ").width * (i === selection ? 1 : 0);
            glowText(label, x, y, color, 0.75 * em);
            // generous hit area: full row height, wide enough for comfortable tapping
            const hx = portrait ? W * 0.08 : menuX - 2 * em;
            const hw = portrait ? W * 0.84 : Math.max(tw + 4 * em, 18 * em);
            rects.push({ x: hx, y: y - lh * 0.62, w: hw, h: lh });
        });

        drawLogo(logoX, logoY, logoW, em);

        if (hint) {
            c.font = `bold ${Math.max(11, 1.05 * em)}px ${MONO}`;
            c.textAlign = "center";
            glowText(hint, W / 2, H * 0.9, "#777", 0.5 * em);
            c.textAlign = "left";
        }
        c.shadowBlur = 0;
        return rects;
    }

    // ---------------------------------------------------------------- terminal

    // Text model: logical lines made of spans {text, color, status?, center?}, plus
    // an optional dialog line (the hacker talking) shown near the bottom.
    let lines = [[]];
    let dialog = null; // {text, color}
    let color = "#9c4";

    function clearTerminal() { lines = [[]]; dialog = null; }

    function termMetrics() {
        const em = Math.min(W / 34, H / 36, Math.max(10.5, Math.sqrt(W * H) / 70));
        return { em, font: `bold ${1.4 * em}px ${MONO}`, lh: 1.45 * 1.4 * em };
    }

    function drawTerminal() {
        begin();
        const { em, font, lh } = termMetrics();
        c.font = font;
        const charW = c.measureText("M").width;
        const margin = Math.max(1.6 * em, W * 0.045);
        const cols = Math.max(10, Math.floor((W - 2 * margin) / charW));
        const statusCol = Math.min(50, cols - 6);

        // lay out rows of {col, text, color}
        const rows = [];
        lines.forEach(line => {
            let row = [], col = 0;
            const newRow = () => { rows.push(row); row = []; col = 0; };
            line.forEach(span => {
                if (span.status) {
                    let target = Math.max(statusCol, Math.min(cols - span.text.length, col + 1));
                    if (target + span.text.length > cols || target < col) { newRow(); target = cols - span.text.length; }
                    row.push({ col: target, text: span.text, color: span.color });
                    col = target + span.text.length;
                    return;
                }
                if (span.center) {
                    if (col > 0) newRow();
                    // word-wrap centered text
                    const words = span.text.split(" ");
                    let cur = "";
                    const flush = () => { row.push({ col: Math.max(0, Math.floor((cols - cur.length) / 2)), text: cur, color: span.color }); newRow(); };
                    words.forEach(w => {
                        if (cur && (cur + " " + w).length > cols) { flush(); cur = w; }
                        else cur = cur ? cur + " " + w : w;
                    });
                    if (cur) { row.push({ col: Math.max(0, Math.floor((cols - cur.length) / 2)), text: cur, color: span.color }); col = cols; }
                    return;
                }
                let text = span.text;
                while (text.length) {
                    if (col >= cols) newRow();
                    const take = text.slice(0, cols - col);
                    row.push({ col, text: take, color: span.color });
                    col += take.length;
                    text = text.slice(take.length);
                }
            });
            rows.push(row);
        });

        // keep the newest rows on screen, leaving room for the dialog line
        const top = Math.max(2.2 * em, H * 0.06);
        const bottomReserve = Math.max(6.5 * em, H * 0.16);
        const maxRows = Math.max(1, Math.floor((H - top - bottomReserve) / lh));
        const visible = rows.slice(Math.max(0, rows.length - maxRows));

        visible.forEach((row, r) => {
            const y = top + (r + 1) * lh;
            row.forEach(seg => glowText(seg.text, margin + seg.col * charW, y, seg.color, 12));
        });

        if (dialog && dialog.text) {
            c.font = `bold italic ${2 * em}px ${SANS}`;
            c.textAlign = "center";
            const maxW = W - 2 * margin;
            const words = dialog.text.split(" ");
            const out = [];
            let cur = "";
            words.forEach(w => {
                const test = cur ? cur + " " + w : w;
                if (cur && c.measureText(test).width > maxW) { out.push(cur); cur = w; } else cur = test;
            });
            if (cur) out.push(cur);
            const dl = 2.6 * em;
            const y0 = H - Math.max(4.5 * em, H * 0.1) - (out.length - 1) * dl;
            out.forEach((t, i) => glowText(t, W / 2, y0 + i * dl, dialog.color, 12));
            c.textAlign = "left";
        }
        c.shadowBlur = 0;
    }

    // ---------------------------------------------------------------- script player
    // Script ops:
    //   {color}             set the current colour
    //   {mode, ms}          typing mode: "char" (one character every ms) or "line" (whole text after ms)
    //   {print}             type text on the current line
    //   {nl: n}             n line breaks
    //   {wait: ms}
    //   {status, color}     right-aligned status tag ("[ OK ]")
    //   {center, color}     centered line
    //   {say, color}        dialog line, typed one character every 60 ms
    //   {hush: true}        remove the dialog line
    //   {clear: true}       clear the screen
    async function play(script, isCancelled, onChange, onType) {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        let mode = "line", ms = 50;
        const cur = () => lines[lines.length - 1];
        const appendChar = (target, ch) => {
            const last = target[target.length - 1];
            if (last && last.color === color && !last.status && !last.center) last.text += ch;
            else target.push({ text: ch, color });
        };

        for (const op of script) {
            if (isCancelled()) return false;
            if (op.color && op.print === undefined && op.status === undefined && op.center === undefined && op.say === undefined) {
                color = op.color;
            } else if (op.mode) {
                mode = op.mode; ms = op.ms;
            } else if (op.print !== undefined) {
                if (mode === "line") {
                    await wait(ms);
                    if (isCancelled()) return false;
                    for (const ch of op.print) appendChar(cur(), ch);
                    onType(); onChange();
                } else {
                    for (const ch of op.print) {
                        await wait(ms);
                        if (isCancelled()) return false;
                        appendChar(cur(), ch);
                        if (ch !== " ") onType();
                        onChange();
                    }
                }
            } else if (op.nl) {
                for (let i = 0; i < op.nl; i++) lines.push([]);
                onChange();
            } else if (op.wait) {
                await wait(op.wait);
            } else if (op.status !== undefined) {
                await wait(ms);
                if (isCancelled()) return false;
                cur().push({ text: op.status, color: op.color, status: true });
                onType(); onChange();
            } else if (op.center !== undefined) {
                await wait(ms);
                if (isCancelled()) return false;
                cur().push({ text: op.center, color: op.color || color, center: true });
                onType(); onChange();
            } else if (op.say !== undefined) {
                dialog = { text: "", color: op.color };
                for (const ch of op.say) {
                    await wait(60);
                    if (isCancelled()) return false;
                    dialog.text += ch;
                    if (ch !== " ") onType();
                    onChange();
                }
            } else if (op.hush) {
                dialog = null; onChange();
            } else if (op.clear) {
                clearTerminal(); onChange();
            }
        }
        return true;
    }

    return { canvas, resize, drawMenu, drawTerminal, clearTerminal, play };
})();

// ---------------------------------------------------------------- cutscene scripts
// The story is told through fake terminal sessions; the "<title>" lines are part of the
// fictional server responses, not of this page.

const PROMPT = "[totosz@vlt1337 ~]$ ";

function startCutsceneScript(touch) {
    return [
        { nl: 2 }, { mode: "line", ms: 50 }, { color: "#9c4" }, { print: PROMPT },
        { wait: 500 },
        { color: "#ccc" }, { mode: "char", ms: 50 }, { print: "hack https://asodih90xvy809.com/90as8y/" },
        { nl: 1 }, { mode: "char", ms: 300 }, { print: ". . .  " },

        { nl: 2 }, { color: "#999" }, { mode: "line", ms: 50 },
        { print: "HTTP/2 404" }, { nl: 1 },
        { print: "content-type: text/html" }, { nl: 1 },
        { print: "content-length: 1565" }, { nl: 1 },
        { print: `date: ${new Date().toDateString()}` }, { nl: 2 },

        { print: "<!DOCTYPE html>" }, { nl: 1 },
        { print: "<html lang=en>" }, { nl: 1 },
        { print: "<title>Error 404 (Not Found)!!1</title>" }, { nl: 1 },
        { print: "<p>The requested URL was not found on this server. Tough luck :-)" },

        { nl: 2 }, { mode: "line", ms: 500 }, { color: "#f83" }, { print: "[ERROR] Hacking failed with code 0x04729632" },
        { nl: 1 }, { color: "#9c4" }, { print: PROMPT },

        { wait: 1200 },
        { say: "@#$%! *They* moved the page again.", color: "#baa" },
        { wait: 800 }, { hush: true },
        { say: "You can hide it, but I'll find it anyway!", color: "#baa" },
        { wait: 800 }, { hush: true },

        { color: "#ccc" }, { mode: "char", ms: 50 }, { print: "./crawler https://asodih90xvy809.com/ --find-missing-page" },
        { mode: "char", ms: 800 }, { print: " " }, { mode: "char", ms: 50 }, { print: "--please" },

        { wait: 400 }, { clear: true },
        { nl: 1 }, { mode: "line", ms: 500 },
        { color: "#fff" }, { print: "Initialize crawler" }, { status: "[ OK ]", color: "#9c4" },
        { nl: 1 }, { color: "#fff" }, { print: "Generate search route" }, { status: "[ OK ]", color: "#9c4" },
        { nl: 1 }, { color: "#fff" }, { print: "Calculate expression matcher" }, { status: "[ OK ]", color: "#9c4" },
        { nl: 1 }, { color: "#fff" }, { print: "Perform automated search" }, { wait: 500 }, { status: "[FAIL]", color: "#f83" },
        { nl: 2 }, { center: "Manual guidance required.", color: "#fff" },
        { nl: 1 }, { center: touch ? "Tap to start" : "Press Enter to start", color: "#fff" },
        { nl: 1 }, { color: "#fff" }, { mode: "char", ms: 200 }, { center: ". . .", color: "#fff" }
    ];
}

function endCutsceneScript(touch, speedrun, timerText, difficultyName) {
    const speedrunLines = speedrun ? [
        { print: `overall-time: ${timerText}` }, { nl: 1 },
        { print: `difficulty: ${difficultyName}` }, { nl: 1 },
    ] : [];
    return [
        { nl: 2 }, { mode: "line", ms: 50 }, { color: "#9c4" }, { print: PROMPT },
        { wait: 1000 },
        { color: "#ccc" }, { mode: "char", ms: 50 }, { print: "hack https://asodih90xvy809.com/90as8y/" },
        { nl: 1 }, { mode: "char", ms: 300 }, { print: ". . .  " },
        { nl: 2 }, { color: "#ccc" }, { mode: "line", ms: 50 },
        { print: "HTTP/2 " }, { color: "#fff" }, { print: "200 OK" }, { nl: 1 }, { color: "#ccc" },
        { print: "content-type: text/html" }, { nl: 1 },
        { print: "content-length: 2273" }, { nl: 1 },
        ...speedrunLines,
        { print: `date: ${new Date().toDateString()}` }, { nl: 2 },

        { print: "<!DOCTYPE html>" }, { nl: 1 },
        { print: "<html lang=en>" }, { nl: 1 },
        { print: "<title>Hello there!</title>" }, { nl: 1 },
        { print: `<p>${speedrun ? "How did you get here so fast?!" : "You're welcome!"}</p>` },
        { wait: 500 }, { nl: 2 }, { color: "#9c4" }, { print: PROMPT },

        { wait: 1200 },
        { say: "Finally... I found it.", color: "#f80" },

        { wait: speedrun ? 10000 : 3000 },
        { clear: true }, { nl: 1 }, { mode: "line", ms: 50 }, { color: "#9c4" },
        { print: "WEB CRAWLER" },
        { wait: 1500 },
        { nl: 1 }, { color: "#ccc" },
        { print: "A game by " }, { color: "#f22" }, { print: "kostik1337" }, { color: "#ccc" }, { print: " & " },
        { color: "#66f" }, { print: "lampysprites" },
        { wait: 400 }, { nl: 2 }, { color: "#ccc" },
        { print: "Thank you for playing!" },
        { wait: 2500 }, { nl: 2 },
        { center: touch ? "Tap to return to the menu" : "Press Enter to return to the menu", color: "#999" }
    ];
}
