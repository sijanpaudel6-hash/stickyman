// sfx.js — Zero-asset, fully synthesized YouTube commentary sound effects (Web Audio API).
// Whoosh · Pop/Bubble · Vine Boom / Bass Drop · Record Scratch · Camera Shutter · Keyboard Typing
(function () {
  window.SFX_LIST = [
    { id: 'whoosh', name: 'Whoosh', icon: '💨' },
    { id: 'pop', name: 'Pop / Bubble', icon: '🫧' },
    { id: 'boom', name: 'Vine Boom', icon: '💥' },
    { id: 'scratch', name: 'Record Scratch', icon: '💿' },
    { id: 'shutter', name: 'Camera Shutter', icon: '📸' },
    { id: 'typing', name: 'Keyboard Typing', icon: '⌨️' },
  ];

  class SfxEngine {
    constructor(getAudioCtx) {
      this.getAudioCtx = getAudioCtx;
      this.ctx = null;
      this.master = null;
      this.extraDest = null;
      this.noise = null;
      this.volume = 0.9;
    }

    ensure() {
      const ac = this.getAudioCtx();
      if (!ac) return null;
      if (this.ctx !== ac) {
        this.ctx = ac;
        this.comp = ac.createDynamicsCompressor();
        this.comp.threshold.value = -10;
        this.comp.ratio.value = 6;
        this.comp.attack.value = 0.002;
        this.comp.release.value = 0.15;
        this.master = ac.createGain();
        this.master.gain.value = this.volume;
        this.comp.connect(this.master);
        this.master.connect(ac.destination);
        const len = ac.sampleRate * 2;
        this.noise = ac.createBuffer(1, len, ac.sampleRate);
        const d = this.noise.getChannelData(0);
        let seed = 1337;
        for (let i = 0; i < len; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          d[i] = (seed / 4294967296) * 2 - 1;
        }
        if (this.extraDest) this.master.connect(this.extraDest);
      }
      return ac;
    }

    // Route SFX into the MP4 export recorder as well
    setExtraDestination(node) {
      this.ensure();
      if (this.extraDest && this.master) {
        try { this.master.disconnect(this.extraDest); } catch (e) {}
      }
      this.extraDest = node;
      if (node && this.master) this.master.connect(node);
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = v;
    }

    noiseSrc(ac, t0, dur, rate = 1) {
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(t0, Math.random() * 1.5);
      src.stop(t0 + dur + 0.05);
      return src;
    }

    envGain(ac, t0, peak, attack, decay, hold = 0) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
      return g;
    }

    play(id, opts = {}) {
      const ac = this.ensure();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + (opts.delay || 0) + 0.005;
      const vol = opts.volume ?? 1;
      const out = ac.createGain();
      out.gain.value = vol;
      out.connect(this.comp);
      switch (id) {
        case 'whoosh': this.whoosh(ac, t0, out); break;
        case 'pop': this.pop(ac, t0, out); break;
        case 'boom': this.boom(ac, t0, out); break;
        case 'scratch': this.scratch(ac, t0, out); break;
        case 'shutter': this.shutter(ac, t0, out); break;
        case 'typing': this.typing(ac, t0, out); break;
        default: break;
      }
      setTimeout(() => { try { out.disconnect(); } catch (e) {} }, 4000);
    }

    whoosh(ac, t0, out) {
      const dur = 0.7;
      const src = this.noiseSrc(ac, t0, dur);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(260, t0);
      bp.frequency.exponentialRampToValueAtTime(2800, t0 + 0.3);
      bp.frequency.exponentialRampToValueAtTime(450, t0 + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(1.1, t0 + 0.27);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      src.connect(bp).connect(g);
      if (pan) {
        pan.pan.setValueAtTime(-0.8, t0);
        pan.pan.linearRampToValueAtTime(0.8, t0 + dur);
        g.connect(pan).connect(out);
      } else {
        g.connect(out);
      }
    }

    pop(ac, t0, out) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(320, t0);
      o.frequency.exponentialRampToValueAtTime(1250, t0 + 0.045);
      o.frequency.exponentialRampToValueAtTime(900, t0 + 0.11);
      const g = this.envGain(ac, t0, 0.85, 0.004, 0.11);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 0.2);
      // Wet "bubble" click
      const n = this.noiseSrc(ac, t0, 0.03);
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const ng = this.envGain(ac, t0, 0.25, 0.001, 0.02);
      n.connect(hp).connect(ng).connect(out);
    }

    boom(ac, t0, out) {
      const shaper = ac.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = Math.tanh(x * 3.2);
      }
      shaper.curve = curve;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t0);
      lp.frequency.exponentialRampToValueAtTime(220, t0 + 1.2);
      const body = this.envGain(ac, t0, 1.0, 0.008, 1.9);
      const o1 = ac.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(68, t0);
      o1.frequency.exponentialRampToValueAtTime(36, t0 + 1.6);
      const o2 = ac.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(136, t0);
      o2.frequency.exponentialRampToValueAtTime(70, t0 + 1.2);
      const g2 = ac.createGain();
      g2.gain.value = 0.35;
      o1.connect(shaper);
      o2.connect(g2).connect(shaper);
      shaper.connect(lp).connect(body).connect(out);
      // Reverb-ish tail (feedback delay)
      const delay = ac.createDelay(1);
      delay.delayTime.value = 0.09;
      const fb = ac.createGain();
      fb.gain.value = 0.32;
      const dl = ac.createBiquadFilter();
      dl.type = 'lowpass';
      dl.frequency.value = 600;
      body.connect(delay);
      delay.connect(dl).connect(fb).connect(delay);
      const wet = ac.createGain();
      wet.gain.value = 0.35;
      dl.connect(wet).connect(out);
      [o1, o2].forEach((o) => { o.start(t0); o.stop(t0 + 2.1); });
      // Transient thump
      const n = this.noiseSrc(ac, t0, 0.08);
      const nl = ac.createBiquadFilter();
      nl.type = 'lowpass';
      nl.frequency.value = 900;
      const ng = this.envGain(ac, t0, 0.7, 0.002, 0.07);
      n.connect(nl).connect(ng).connect(out);
      setTimeout(() => { try { fb.disconnect(); delay.disconnect(); } catch (e) {} }, 3500);
    }

    scratch(ac, t0, out) {
      const dur = 0.62;
      const n = this.noiseSrc(ac, t0, dur, 1);
      const pts = [[0, 0.5], [0.1, 2.4], [0.2, 0.35], [0.33, 2.0], [0.46, 0.3], [dur, 1.2]];
      pts.forEach(([dt, r], i) => (i ? n.playbackRate.linearRampToValueAtTime(r, t0 + dt) : n.playbackRate.setValueAtTime(r, t0)));
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.4;
      pts.forEach(([dt, r], i) => (i ? bp.frequency.linearRampToValueAtTime(500 + r * 900, t0 + dt) : bp.frequency.setValueAtTime(500 + r * 900, t0)));
      const saw = ac.createOscillator();
      saw.type = 'sawtooth';
      pts.forEach(([dt, r], i) => (i ? saw.frequency.linearRampToValueAtTime(90 + r * 210, t0 + dt) : saw.frequency.setValueAtTime(90 + r * 210, t0)));
      const sl = ac.createBiquadFilter();
      sl.type = 'lowpass';
      sl.frequency.value = 1400;
      const sg = ac.createGain();
      sg.gain.value = 0.22;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
      g.gain.setValueAtTime(0.9, t0 + 0.18);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.21);
      g.gain.linearRampToValueAtTime(0.9, t0 + 0.26);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      n.connect(bp).connect(g);
      saw.connect(sl).connect(sg).connect(g);
      g.connect(out);
      saw.start(t0);
      saw.stop(t0 + dur + 0.05);
    }

    shutter(ac, t0, out) {
      const click = (t, peak, hpF, dur) => {
        const n = this.noiseSrc(ac, t, dur + 0.02);
        const hp = ac.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = hpF;
        const g = this.envGain(ac, t, peak, 0.001, dur);
        n.connect(hp).connect(g).connect(out);
      };
      click(t0, 1.0, 3200, 0.018);
      // mechanical body
      const n = this.noiseSrc(ac, t0, 0.08);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 3;
      const bg = this.envGain(ac, t0 + 0.004, 0.45, 0.004, 0.06);
      n.connect(bp).connect(bg).connect(out);
      click(t0 + 0.085, 0.75, 2200, 0.022);
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(190, t0 + 0.085);
      o.frequency.exponentialRampToValueAtTime(90, t0 + 0.13);
      const og = this.envGain(ac, t0 + 0.085, 0.35, 0.002, 0.05);
      o.connect(og).connect(out);
      o.start(t0 + 0.085);
      o.stop(t0 + 0.2);
    }

    typing(ac, t0, out) {
      const gaps = [0, 0.09, 0.11, 0.07, 0.13, 0.08, 0.1, 0.16, 0.07, 0.09, 0.12, 0.08, 0.1];
      let t = t0;
      gaps.forEach((gap, i) => {
        t += gap;
        const r = ((i * 7919) % 100) / 100;
        const space = i === 7;
        const n = this.noiseSrc(ac, t, 0.03);
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = space ? 1400 : 2600 + r * 2200;
        bp.Q.value = 1.6;
        const g = this.envGain(ac, t, space ? 0.5 : 0.42 + r * 0.3, 0.001, space ? 0.04 : 0.022);
        n.connect(bp).connect(g).connect(out);
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(space ? 120 : 170 + r * 60, t);
        const og = this.envGain(ac, t, space ? 0.35 : 0.18, 0.001, 0.03);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.06);
      });
    }
  }

  window.SfxEngine = SfxEngine;
})();
