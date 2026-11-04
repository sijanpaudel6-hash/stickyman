// ambient.js — Continuous procedural ambient soundscapes for silent films (Web Audio, zero assets).
// Beds crossfade when the active scene changes and are routed through the SFX master bus, so they are
// mixed into the MP4 export (MediaStreamDestination) together with music and foley.
(function () {
  window.AMBIENT_BEDS = [
    { id: 'none', name: 'None', icon: '∅' },
    { id: 'rain_window', name: 'Rain on Window', icon: '🌧️' },
    { id: 'night_wind', name: 'Night Wind', icon: '🌬️' },
    { id: 'vinyl_crackle', name: 'Vinyl Crackle', icon: '💿' },
    { id: 'clock_ticking', name: 'Clock Ticking (3 AM)', icon: '🕰️' },
    { id: 'heartbeat', name: 'Heartbeat', icon: '🫀' },
    { id: 'crowd_muffle', name: 'Muffled Crowd', icon: '👥' },
  ];

  // Small deterministic PRNG so beds sound the same in preview and export
  function prng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  class Bed {
    constructor(engine, id) {
      this.engine = engine;
      this.ac = engine.ac;
      this.id = id;
      this.g = this.ac.createGain();
      this.g.gain.value = 0.0001;
      this.g.connect(engine.out);
      this.nodes = [];
      this.timers = [];
      this.rand = prng(id.length * 977 + 13);
      this.build();
    }

    loopNoise(rate = 1) {
      const src = this.ac.createBufferSource();
      src.buffer = this.engine.sfx.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(this.ac.currentTime, this.rand() * 1.5);
      this.nodes.push(src);
      return src;
    }

    loopBuffer(buf, rate = 1) {
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(this.ac.currentTime, this.rand() * buf.duration);
      this.nodes.push(src);
      return src;
    }

    filter(type, freq, Q = 0.7) {
      const f = this.ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = Q;
      return f;
    }

    gain(v) {
      const g = this.ac.createGain();
      g.gain.value = v;
      return g;
    }

    lfo(freq, depth, target) {
      const o = this.ac.createOscillator();
      o.frequency.value = freq;
      const d = this.gain(depth);
      o.connect(d).connect(target);
      o.start();
      this.nodes.push(o);
    }

    // Look-ahead scheduler: fn(time) returns the next event time
    schedule(firstDelay, fn) {
      let next = this.ac.currentTime + firstDelay;
      const tick = () => {
        while (next < this.ac.currentTime + 0.25) next = fn(Math.max(next, this.ac.currentTime + 0.01));
      };
      tick();
      this.timers.push(setInterval(tick, 60));
    }

    env(t, peak, attack, decay) {
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return g;
    }

    burst(t, dur, rate = 1) {
      const src = this.ac.createBufferSource();
      src.buffer = this.engine.sfx.noise;
      src.playbackRate.value = rate;
      src.start(t, this.rand() * 1.5);
      src.stop(t + dur + 0.05);
      return src;
    }

    tone(t, f0, f1, dur, type = 'sine') {
      const o = this.ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    }

    build() {
      const out = this.g;
      switch (this.id) {
        case 'rain_window': {
          this.loopNoise().connect(this.filter('highpass', 500)).connect(this.filter('lowpass', 4800)).connect(this.gain(0.32)).connect(out);
          this.loopNoise(0.8).connect(this.filter('bandpass', 900, 0.6)).connect(this.gain(0.22)).connect(out);
          // droplets ticking on the glass
          this.schedule(0.1, (t) => {
            const f = this.filter('bandpass', 2800 + this.rand() * 3500, 6);
            const g = this.env(t, 0.04 + this.rand() * 0.1, 0.001, 0.03);
            this.burst(t, 0.04).connect(f).connect(g).connect(out);
            return t + 0.03 + this.rand() * 0.12;
          });
          // occasional distant thunder rumble
          this.schedule(6 + this.rand() * 6, (t) => {
            const lp = this.filter('lowpass', 140, 1.2);
            const lp2 = this.filter('lowpass', 70, 0.7);
            const g = this.env(t, 0.9, 0.9, 3.8);
            this.burst(t, 5, 0.5).connect(lp).connect(lp2).connect(g).connect(out);
            return t + 14 + this.rand() * 12;
          });
          break;
        }
        case 'night_wind': {
          const b1 = this.filter('bandpass', 520, 4);
          const b2 = this.filter('bandpass', 950, 7);
          const g1 = this.gain(0.45);
          const g2 = this.gain(0.18);
          this.loopNoise().connect(b1).connect(g1).connect(out);
          this.loopNoise(0.9).connect(b2).connect(g2).connect(out);
          this.lfo(0.07, 260, b1.frequency);
          this.lfo(0.113, 380, b2.frequency);
          this.lfo(0.05, 0.22, g1.gain);
          this.lfo(0.083, 0.1, g2.gain);
          this.loopNoise(0.6).connect(this.filter('lowpass', 180)).connect(this.gain(0.25)).connect(out);
          break;
        }
        case 'vinyl_crackle': {
          this.loopBuffer(this.engine.vinylBuffer()).connect(this.filter('highpass', 250)).connect(this.gain(0.7)).connect(out);
          this.loopNoise(0.4).connect(this.filter('lowpass', 900)).connect(this.gain(0.03)).connect(out);
          break;
        }
        case 'clock_ticking': {
          const delay = this.ac.createDelay(1);
          delay.delayTime.value = 0.13;
          const fb = this.gain(0.32);
          const dl = this.filter('lowpass', 2400);
          delay.connect(dl).connect(fb).connect(delay);
          const bus = this.gain(1);
          bus.connect(out);
          bus.connect(delay);
          dl.connect(this.gain(0.5)).connect(out);
          this.nodes.push({ disconnect: () => { try { fb.disconnect(); delay.disconnect(); } catch (e) {} } });
          let k = 0;
          this.schedule(0.2, (t) => {
            const hi = k++ % 2 === 0;
            const f = this.filter('bandpass', hi ? 2600 : 1700, 5);
            this.burst(t, 0.02).connect(f).connect(this.env(t, 0.55, 0.001, 0.025)).connect(bus);
            this.tone(t, hi ? 1900 : 1300, hi ? 1700 : 1150, 0.05).connect(this.env(t, 0.12, 0.001, 0.045)).connect(bus);
            return t + 1.0;
          });
          break;
        }
        case 'heartbeat': {
          const lp = this.filter('lowpass', 150, 0.9);
          lp.connect(this.gain(1.4)).connect(out);
          this.schedule(0.2, (t) => {
            this.tone(t, 60, 40, 0.16).connect(this.env(t, 0.95, 0.008, 0.16)).connect(lp);
            this.burst(t, 0.06, 0.4).connect(this.filter('lowpass', 90)).connect(this.env(t, 0.5, 0.004, 0.06)).connect(lp);
            this.tone(t + 0.27, 54, 38, 0.13).connect(this.env(t + 0.27, 0.6, 0.008, 0.13)).connect(lp);
            return t + 0.97;
          });
          break;
        }
        case 'crowd_muffle': {
          this.loopBuffer(this.engine.crowdBuffer()).connect(this.filter('lowpass', 560, 0.7)).connect(this.gain(1.6)).connect(out);
          this.loopNoise(0.5).connect(this.filter('lowpass', 380)).connect(this.gain(0.08)).connect(out);
          break;
        }
        default:
          break;
      }
    }

    setLevel(v, time = 1.2) {
      const t = this.ac.currentTime;
      this.g.gain.cancelScheduledValues(t);
      this.g.gain.setTargetAtTime(Math.max(0.0001, v), t, time / 3);
    }

    stop(fade = 1.2) {
      this.setLevel(0.0001, fade);
      this.timers.forEach(clearInterval);
      this.timers = [];
      setTimeout(() => {
        this.nodes.forEach((n) => {
          try { if (n.stop) n.stop(); } catch (e) {}
          try { n.disconnect(); } catch (e) {}
        });
        try { this.g.disconnect(); } catch (e) {}
      }, fade * 1000 + 300);
    }
  }

  class AmbientEngine {
    constructor(sfx) {
      this.sfx = sfx;
      this.ac = null;
      this.out = null;
      this.current = null;
      this.masterVolume = 0.8;
      this._vinyl = null;
      this._crowd = null;
    }

    ensure() {
      const ac = this.sfx.ensure();
      if (!ac) return null;
      if (this.ac !== ac) {
        this.ac = ac;
        this.out = ac.createGain();
        this.out.gain.value = this.masterVolume;
        this.out.connect(this.sfx.bus);      // bus → speakers + MP4 export destination
        this.current = null;
      }
      return ac;
    }

    setMasterVolume(v) {
      this.masterVolume = v;
      if (this.out) this.out.gain.setTargetAtTime(v, this.ac.currentTime, 0.05);
    }

    // Called every frame. bed: id, volume: 0..1, active: whether audio should play (playing / preview)
    update(bed, volume, active) {
      const target = active && bed && bed !== 'none' ? bed : 'none';
      if (target === 'none' && !this.current) return;
      if (!this.ensure()) return;
      if (!this.current || this.current.id !== target) {
        if (this.current) this.current.stop(1.4);
        this.current = null;
        if (target !== 'none') {
          this.current = new Bed(this, target);
          this.current.setLevel(volume, 1.6);
          this.currentVolume = volume;
        }
      } else if (Math.abs(volume - this.currentVolume) > 0.005) {
        this.current.setLevel(volume, 0.4);
        this.currentVolume = volume;
      }
    }

    stopAll() {
      if (this.current) this.current.stop(0.6);
      this.current = null;
    }

    // Warm lo-fi dust: sparse clicks & pops over faint hiss (6 s loop)
    vinylBuffer() {
      if (this._vinyl && this._vinyl.sampleRate === this.ac.sampleRate) return this._vinyl;
      const sr = this.ac.sampleRate;
      const len = sr * 6;
      const buf = this.ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const r = prng(42);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.9 + (r() * 2 - 1) * 0.1;
        d[i] = lp * 0.05;
      }
      for (let k = 0; k < 260; k++) {
        const pos = Math.floor(r() * (len - 400));
        const amp = (r() < 0.08 ? 0.9 : 0.15 + r() * 0.35) * (r() < 0.5 ? -1 : 1);
        const decay = 8 + r() * 40;
        for (let j = 0; j < 300; j++) d[pos + j] += amp * Math.exp(-j / decay) * (j % 2 ? -0.6 : 1);
      }
      this._vinyl = buf;
      return buf;
    }

    // Indistinct murmur: overlapping synthetic "voices" (pitch contours + syllable envelopes + crude formants)
    crowdBuffer() {
      if (this._crowd) return this._crowd;
      const sr = 16000;
      const dur = 8;
      const len = sr * dur;
      const buf = this.ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const r = prng(7);
      for (let v = 0; v < 12; v++) {
        const f0 = 95 + r() * 140;
        const rate = 3 + r() * 2.5;
        const pan = 0.4 + r() * 0.6;
        const ph0 = r() * 10;
        const formant = 500 + r() * 900;
        let ph = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const syl = Math.max(0, Math.sin(2 * Math.PI * rate * t + ph0)) ** 1.5 * (0.5 + 0.5 * Math.sin(t * 0.7 + v));
          const f = f0 * (1 + 0.08 * Math.sin(t * 2.3 + v) + 0.04 * Math.sin(t * 7.1 + v * 2));
          ph += (2 * Math.PI * f) / sr;
          let s = 0;
          for (let h = 1; h <= 5; h++) {
            const fh = f * h;
            const w = 1 / (1 + Math.abs(fh - formant) / 300);
            s += Math.sin(ph * h) * w / h;
          }
          d[i] += s * syl * pan * 0.07;
        }
      }
      // seamless loop crossfade
      const xf = sr * 0.5;
      for (let i = 0; i < xf; i++) {
        const a = i / xf;
        d[i] = d[i] * a + d[len - xf + i] * (1 - a);
      }
      this._crowd = buf;
      return buf;
    }
  }

  window.AmbientEngine = AmbientEngine;
})();
