// WebGL renderer: one shader draws the whole game world into an off-screen framebuffer,
// a second one post-processes it to the screen; menus and cutscenes are a 2D canvas
// shown through a CRT shader. Based on the original glhelpers.js / gamelogic.js.
"use strict";

const Renderer = (() => {
    const canvas = document.getElementById("screen");
    let gl = null;
    let quad = null;
    let progGame = null, progPost = null, progCrt = null;
    let canvasTex = null;
    let fb = null, fbTex = null, fbW = 0, fbH = 0;
    let textCanvas = null; // last 2D canvas uploaded, re-uploaded after a context loss
    const pixels = new Uint8Array(3 * 4);

    // CSS size of the drawing area and backing-store size (devicePixelRatio aware, capped at 2)
    const size = { cssW: 1, cssH: 1, pxW: 1, pxH: 1, scale: 1 };

    function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
            throw new Error("Shader compile error: " + gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    function program(fsSource, uniforms) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, VS_SOURCE));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
            throw new Error("Shader link error: " + gl.getProgramInfoLog(p));
        }
        const info = { program: p };
        uniforms.forEach(u => { info[u] = gl.getUniformLocation(p, u); });
        return info;
    }

    function createTexture(w, h) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (w > 0 && h > 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    function setupGL() {
        quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, -1, 1, 1, -1, -1, -1]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        progGame = program(GAME_FS_SOURCE, ["t", "res", "pos", "cam", "speed"]);
        progPost = program(POSTPROC_FS_SOURCE, ["res", "tex", "fact"]);
        progCrt = program(CRT_FS_SOURCE, ["res", "tex", "t", "ef"]);
        gl.activeTexture(gl.TEXTURE0);
        canvasTex = createTexture(0, 0);
        fb = null; fbTex = null; fbW = fbH = 0;
        if (textCanvas) uploadCanvas(textCanvas);
    }

    function init() {
        const opts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
        gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
        if (!gl) return false;
        canvas.addEventListener("webglcontextlost", e => e.preventDefault());
        canvas.addEventListener("webglcontextrestored", () => setupGL());
        setupGL();
        return true;
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        size.cssW = Math.max(1, Math.round(rect.width));
        size.cssH = Math.max(1, Math.round(rect.height));
        size.scale = Math.min(window.devicePixelRatio || 1, 2);
        size.pxW = Math.max(1, Math.round(size.cssW * size.scale));
        size.pxH = Math.max(1, Math.round(size.cssH * size.scale));
        if (canvas.width !== size.pxW) canvas.width = size.pxW;
        if (canvas.height !== size.pxH) canvas.height = size.pxH;
    }

    // The game world is rendered at CSS-pixel resolution divided by the graphics setting
    // (like the original); the cheap post-process pass then fills the full backing store.
    function ensureFramebuffer(divide) {
        const w = Math.max(4, Math.round(size.cssW / divide));
        const h = Math.max(4, Math.round(size.cssH / divide));
        if (fb && w === fbW && h === fbH) return;
        if (fbTex) gl.deleteTexture(fbTex);
        fbTex = createTexture(w, h);
        if (!fb) fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
        fbW = w; fbH = h;
    }

    function uploadCanvas(c) {
        textCanvas = c;
        if (!gl || gl.isContextLost()) return;
        gl.bindTexture(gl.TEXTURE_2D, canvasTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    }

    // Menu / cutscene frame: the 2D text canvas through the CRT effect
    function drawCrt(time, endFactor) {
        if (gl.isContextLost()) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, size.pxW, size.pxH);
        gl.useProgram(progCrt.program);
        gl.bindTexture(gl.TEXTURE_2D, canvasTex);
        gl.uniform2f(progCrt.res, size.pxW, size.pxH);
        gl.uniform1i(progCrt.tex, 0);
        gl.uniform1f(progCrt.t, time);
        gl.uniform1f(progCrt.ef, endFactor);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Camera zoom: the original used a fixed zoom tuned for 16:9 screens, where a room
    // exactly fills the width. On narrower screens (portrait phones, tablets) we zoom out
    // so the full room width (plus a small margin) always stays visible.
    function cameraZoom(aspect) {
        const zx = 3.0 * 1.3, zy = 3.0;
        const minHalfWidth = 0.47; // rooms are 0.909 world units wide
        const s = Math.min(1, (aspect / zx) / minHalfWidth);
        return [zx * s, zy * s];
    }

    // Game frame. Returns the 3 data pixels (collision+normal, death, checkpoint+id).
    function drawGame(time, player, divide) {
        if (gl.isContextLost()) return null;
        ensureFramebuffer(divide);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, fbW, fbH);
        gl.useProgram(progGame.program);
        gl.uniform1f(progGame.t, time);
        gl.uniform2f(progGame.res, fbW, fbH);
        gl.uniform2f(progGame.pos, player.pos.x, player.pos.y);
        gl.uniform2f(progGame.speed, player.speed.x / player.maxVelocity, player.speed.y / player.maxVelocity);
        const [zx, zy] = cameraZoom(fbW / fbH);
        gl.uniform4f(progGame.cam, player.cam.x, player.cam.y, zx, zy);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.readPixels(0, 0, 3, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, size.pxW, size.pxH);
        gl.useProgram(progPost.program);
        gl.bindTexture(gl.TEXTURE_2D, fbTex);
        gl.uniform2f(progPost.res, size.pxW, size.pxH);
        gl.uniform1i(progPost.tex, 0);
        gl.uniform3f(progPost.fact, player.deathFactor, player.checkpointFactor, player.endFactor);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return pixels;
    }

    // Maps a point on screen (CSS px) to the 2D text canvas (CSS px), applying exactly the
    // same transform as the CRT shader (zoom, barrel distortion, frame), so taps on the
    // menu land on the right item.
    function screenToText(x, y) {
        let u = 1.04 * (x / size.cssW) - 0.02;
        let v = 1.04 * (y / size.cssH) - 0.02;
        const ux = 2 * u - 1, vy = 2 * v - 1, f = 0.05;
        u = (ux * (1 + f * vy * vy) + 1) / 2;
        v = (vy * (1 + f * ux * ux) + 1) / 2;
        return [(u - 0.02) / 0.96 * size.cssW, (v - 0.02) / 0.96 * size.cssH];
    }

    return { init, resize, size, uploadCanvas, drawCrt, drawGame, screenToText };
})();
