// Procedural sound effects and ambient music (Web Audio API).
// Sound design and music by kostik1337; adapted for PewPlay: the audio graph is only created
// after a user gesture, everything goes through a master gain (mute button) and the context
// is suspended while the page is hidden.
"use strict";

const Sound = (() => {
    let processor = null;
    let muted = false;
    let hidden = false;
    let wantAmbient = false;

    function createProcessor() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        const context = new AC();
        const t = (dt) => context.currentTime + dt;

        const master = context.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(context.destination);

        const reverb = Freeverb(context);
        reverb.roomSize = 0.7;
        reverb.dampening = 4000;
        reverb.wet.value = 0.5;
        reverb.dry.value = 0.0;
        reverb.connect(master);

        const attackDecay = (param, attack, decay, maxVal = 1, minVal = 0) => {
            param.linearRampToValueAtTime(maxVal, t(attack));
            param.linearRampToValueAtTime(minVal, t(attack + decay));
        };

        // two sine oscillators, one modulating the amplitude of the other
        const createRingmodNodes = (freq1, freq2) => {
            const osc = context.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq1;

            const osc2 = context.createOscillator();
            osc2.type = "sine";
            osc2.frequency.value = freq2;

            const ringgain = context.createGain();
            ringgain.gain.setValueAtTime(0, t(0));

            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t(0));

            osc.connect(ringgain);
            osc2.connect(ringgain.gain);
            ringgain.connect(gain);

            osc.start();
            osc2.start();

            return [osc, osc2, gain];
        };

        const setupTypingProcessor = () => {
            const [, , gain] = createRingmodNodes(834, 1147);
            const filter = context.createBiquadFilter();
            filter.Q.setValueAtTime(5, t(0));
            filter.frequency.setValueAtTime(2500, t(0));
            filter.type = "bandpass";

            gain.connect(filter);
            filter.connect(master);
            return () => attackDecay(gain.gain, 0.01, 0.1);
        };

        const setupMenuChangeProcessor = () => {
            const [osc, osc2, gain] = createRingmodNodes(0, 0);
            gain.connect(master);
            return (freq) => {
                osc.frequency.value = freq;
                osc2.frequency.value = freq * 1.33;
                attackDecay(gain.gain, 0.01, 0.1);
            };
        };

        const setupCheckpointProcessor = () => {
            const [osc, osc2, gain] = createRingmodNodes(0, 0);

            const delayTime = 0.45;
            const delay = context.createDelay(delayTime);
            delay.delayTime.setValueAtTime(delayTime, t(0));
            const delayGain = context.createGain();
            delayGain.gain.setValueAtTime(0.5, t(0));

            gain.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(delay);
            gain.connect(reverb);
            delayGain.connect(reverb);

            const freqs = [440, 220, 440];
            const playNote = (index, when) => {
                osc.frequency.setValueAtTime(freqs[index], t(when));
                osc2.frequency.setValueAtTime(freqs[index] * 0.75, t(when));
            };
            return () => {
                attackDecay(gain.gain, 0.0, 0.5);
                playNote(0, 0);
                playNote(1, delayTime / 4);
                playNote(2, delayTime / 2);
            };
        };

        const setupDeathProcessor = () => {
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t(0));

            const detuneCents = 20;
            for (let i = -1; i <= 1; ++i) {
                const osc = context.createOscillator();
                osc.type = "sawtooth";
                osc.frequency.value = 55 * Math.pow(2, i * detuneCents / 1200);
                osc.start();
                osc.connect(gain);
            }

            const filter = context.createBiquadFilter();
            filter.Q.setValueAtTime(1, t(0));
            filter.frequency.setValueAtTime(1000, t(0));
            filter.type = "lowpass";
            gain.connect(filter);
            filter.connect(reverb);
            filter.connect(master);

            return () => attackDecay(gain.gain, 0.01, 0.5);
        };

        const setupAmbient = () => {
            const delay = context.createDelay(1.0);
            delay.delayTime.setValueAtTime(1.0, t(0));
            const delayGain = context.createGain();
            delayGain.gain.setValueAtTime(0.8, t(0));

            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t(0));

            const oscs = Array(3).fill().map(() => {
                const lfo = context.createOscillator();
                lfo.frequency.value = 0.1 + 0.1 * Math.random();
                lfo.type = "sine";
                lfo.start();

                const lfoGain = context.createGain();
                lfoGain.gain.setValueAtTime(10, t(0));
                lfo.connect(lfoGain);

                const oscGain = context.createGain();
                const oscGainLfo = context.createOscillator();
                oscGainLfo.frequency.value = 0.05 + 0.05 * Math.random();
                oscGainLfo.type = "sine";
                oscGainLfo.start();

                const osc = context.createOscillator();
                osc.type = "sine";
                osc.start();

                oscGainLfo.connect(oscGain.gain);
                lfoGain.connect(osc.detune);
                osc.connect(oscGain);
                oscGain.connect(gain);
                return osc;
            });

            gain.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(delay);
            delay.connect(reverb);

            const chords = [
                [0, 5, 9],
                [3, 10, 12],
                [2, 5, 7],
                [0, 3, 10],
                [5, 7, 10],
                [0, 2, 7],
            ];
            let currentChord = -1;

            const setChord = (notes) => {
                for (let i = 0; i < oscs.length; ++i)
                    oscs[i].frequency.setValueAtTime(220 * Math.pow(2, notes[i] / 12), t(0));
            };
            const nextChord = () => {
                currentChord = (currentChord + 1) % chords.length;
                setChord(chords[currentChord]);
            };

            setInterval(() => {
                if (context.state !== "running") return;
                // random chord inversions
                setChord(chords[currentChord].map((n) => n + 12 * (Math.floor(Math.random() * 3) - 1)));
            }, 2000);

            nextChord();
            return {
                setOn(on) {
                    gain.gain.cancelScheduledValues(t(0));
                    if (on) {
                        gain.gain.setValueAtTime(0, t(0));
                        gain.gain.linearRampToValueAtTime(0.05, t(5));
                    } else {
                        gain.gain.setValueAtTime(0, t(0));
                    }
                },
                nextChord
            };
        };

        const typingProcs = Array(3).fill().map(setupTypingProcessor);
        let typingProcIndex = 0;
        const menuProc = setupMenuChangeProcessor();
        const checkpointProc = setupCheckpointProcessor();
        const deathProc = setupDeathProcessor();
        const ambient = setupAmbient();

        return {
            context,
            master,
            typing: () => typingProcs[(++typingProcIndex) % typingProcs.length](),
            menuChange: (isLeftRight) => menuProc(isLeftRight ? 550 : 660),
            checkpoint: () => {
                checkpointProc();
                ambient.nextChord();
            },
            death: deathProc,
            ambient
        };
    }

    function syncState() {
        if (!processor) return;
        const ctx = processor.context;
        processor.master.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);
        if (hidden) {
            if (ctx.state === "running") ctx.suspend().catch(() => {});
        } else if (ctx.state !== "running") {
            ctx.resume().catch(() => {});
        }
    }

    return {
        // Called from user gestures (pointerdown / keydown) only.
        unlock() {
            if (!processor) {
                try { processor = createProcessor(); } catch (e) { processor = null; }
                if (processor && wantAmbient) processor.ambient.setOn(true);
            }
            syncState();
        },
        setMuted(m) { muted = m; syncState(); },
        isMuted: () => muted,
        setHidden(h) { hidden = h; syncState(); },
        typing() { if (processor) processor.typing(); },
        menuChange(isLeftRight) { if (processor) processor.menuChange(isLeftRight); },
        checkpoint() { if (processor) processor.checkpoint(); },
        death() { if (processor) processor.death(); },
        ambient(on) {
            wantAmbient = on;
            if (processor) processor.ambient.setOn(on);
        }
    };
})();
