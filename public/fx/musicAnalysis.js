// musicAnalysis.js — Silent Film Mode music engine.
//  * Offline beat / onset detection on the loaded music track (waveform beat markers, snap-to-beat cuts,
//    deterministic beatPulse during playback & export).
//  * Real-time low-frequency energy follower (musicEnergy) from the AnalyserNode.
//  * Procedural demo music (soft 72 BPM piano + pad + felt kick) so Silent Film Mode works out of the box.
//  * Silent mouth overrides (closed / slow heavy sigh / quivering lip) — the mouth never follows music.
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  window.SILENT_MOUTHS = [
    { id: 'closed', name: 'Closed (default)' },
    { id: 'sigh', name: 'Slow Heavy Sigh' },
    { id: 'quiver', name: 'Quivering Lip' },
  ];

  /**
   * Detect musical beats/onsets.
   * Returns { beats: [{ time, strength }], bpm, duration }.
   */
  function analyzeBeats(buffer) {
    const sr = buffer.sampleRate;
    const chs = buffer.numberOfChannels;
    const len = buffer.length;
    const hop = 512;
    const frames = Math.floor(len / hop);
    if (frames < 8) return { beats: [], bpm: 0, duration: buffer.duration };

    // Low-band (kick / bass / piano attack body) and full-band energy per hop
    const data = [];
    for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
    const a = Math.exp(-2 * Math.PI * 180 / sr); // one-pole low-pass ~180 Hz
    let lp = 0;
    const low = new Float32Array(frames);
    const full = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let el = 0, ef = 0;
      const base = f * hop;
      for (let i = 0; i < hop; i++) {
        let s = 0;
        for (let c = 0; c < chs; c++) s += data[c][base + i];
        s /= chs;
        lp = a * lp + (1 - a) * s;
        el += lp * lp;
        ef += s * s;
      }
      low[f] = Math.log(1e-9 + el / hop);
      full[f] = Math.log(1e-9 + ef / hop);
    }

    // Onset strength = positive spectral-energy flux (weighted toward the low band)
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      onset[f] = Math.max(0, low[f] - low[f - 1]) * 0.65 + Math.max(0, full[f] - full[f - 1]) * 0.35;
    }
    // Ignore near-silence
    const loud = new Float32Array(frames);
    let maxFull = -Infinity;
    for (let f = 0; f < frames; f++) maxFull = Math.max(maxFull, full[f]);
    for (let f = 0; f < frames; f++) loud[f] = full[f] > maxFull - 9 ? 1 : 0;

    // Adaptive threshold (local mean + k·std over ±0.6 s) and peak picking
    const win = Math.max(4, Math.round((0.6 * sr) / hop));
    const minGap = Math.round((0.26 * sr) / hop);
    const beats = [];
    let last = -minGap;
    let sum = 0, sum2 = 0, n = 0;
    const add = (i, s) => { if (i >= 0 && i < frames) { sum += s * onset[i]; sum2 += s * onset[i] * onset[i]; n += s; } };
    for (let i = 0; i <= win && i < frames; i++) add(i, 1);
    for (let f = 1; f < frames - 1; f++) {
      add(f + win, 1);
      add(f - win - 1, -1);
      const mean = sum / Math.max(1, n);
      const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
      const thr = mean + std * 1.35 + 0.02;
      if (loud[f] && onset[f] > thr && onset[f] >= onset[f - 1] && onset[f] >= onset[f + 1] && f - last >= minGap) {
        beats.push({ time: (f * hop) / sr, strength: onset[f] });
        last = f;
      }
    }
    const maxS = beats.reduce((m, b) => Math.max(m, b.strength), 1e-6);
    beats.forEach((b) => { b.strength = clamp(b.strength / maxS, 0.05, 1); });

    // Tempo estimate: autocorrelation of the onset envelope between 60 and 180 BPM
    const fps = sr / hop;
    let bestLag = 0, best = 0;
    for (let lag = Math.round((fps * 60) / 180); lag <= Math.round((fps * 60) / 60); lag++) {
      let acc = 0;
      for (let f = lag; f < frames; f++) acc += onset[f] * onset[f - lag];
      if (acc > best) { best = acc; bestLag = lag; }
    }
    const bpm = bestLag ? Math.round((60 * fps) / bestLag) : 0;
    return { beats, bpm, duration: buffer.duration };
  }

  // Nearest beat to a time (within maxDist seconds) or null
  function nearestBeat(analysis, t, maxDist = 0.3) {
    if (!analysis || !analysis.beats.length) return null;
    let best = null, bd = Infinity;
    for (const b of analysis.beats) {
      const d = Math.abs(b.time - t);
      if (d < bd) { bd = d; best = b; }
      if (b.time > t + maxDist) break;
    }
    return bd <= maxDist ? best : null;
  }

  // Index of the most recent beat ≤ t (binary search)
  function lastBeatBefore(analysis, t) {
    const arr = analysis ? analysis.beats : [];
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? arr[ans] : null;
  }

  /** Procedural emotional demo track: Am – F – C – G piano arpeggios over a soft pad and felt kick. */
  function generateDemoMusic(ac, duration = 24) {
    const sr = ac.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ac.createBuffer(2, len, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const bpm = 72;
    const beat = 60 / bpm;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const bass = [45, 41, 36, 43];

    const note = (t0, freq, dur, amp, pan, bright = 1) => {
      const s0 = Math.floor(t0 * sr);
      const s1 = Math.min(len, Math.floor((t0 + dur) * sr));
      for (let i = s0; i < s1; i++) {
        const t = (i - s0) / sr;
        const env = Math.min(1, t / 0.006) * Math.exp(-t * (2.2 / bright));
        const v = (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) * Math.exp(-t * 3)
          + 0.12 * Math.sin(6 * Math.PI * freq * t) * Math.exp(-t * 5)) * env * amp;
        L[i] += v * (1 - pan * 0.5);
        R[i] += v * (1 + pan * 0.5);
      }
    };
    const kick = (t0, amp) => {
      const s0 = Math.floor(t0 * sr);
      const s1 = Math.min(len, s0 + Math.floor(0.45 * sr));
      let ph = 0;
      for (let i = s0; i < s1; i++) {
        const t = (i - s0) / sr;
        const f = 48 + 70 * Math.exp(-t * 22);
        ph += (2 * Math.PI * f) / sr;
        const v = Math.sin(ph) * Math.exp(-t * 7) * amp;
        L[i] += v;
        R[i] += v;
      }
    };

    const bars = Math.ceil(duration / (beat * 4));
    for (let b = 0; b < bars; b++) {
      const ci = b % 4;
      const tBar = b * beat * 4;
      // pad (long, soft)
      chords[ci].forEach((m, k) => note(tBar, midi(m), beat * 4.2, 0.045, (k - 1) * 0.6, 3.5));
      note(tBar, midi(bass[ci]), beat * 4, 0.12, 0, 2.2);
      // arpeggio
      const arp = [...chords[ci], chords[ci][1] + 12, chords[ci][2] + 12, chords[ci][1] + 12, chords[ci][0] + 12, chords[ci][2]];
      for (let s = 0; s < 8; s++) note(tBar + s * beat * 0.5, midi(arp[s] + 12), beat * 1.4, s % 2 ? 0.05 : 0.075, s % 2 ? 0.4 : -0.4);
      // felt kick on beats 1 and 3 (stronger on bar starts after the intro)
      if (b >= 1) {
        kick(tBar, 0.55);
        kick(tBar + beat * 2, 0.35);
      }
    }
    // gentle master fade in/out + soft clip
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const g = Math.min(1, t / 1.5) * Math.min(1, (duration - t) / 2.0);
      L[i] = Math.tanh(L[i] * 1.2) * g * 0.8;
      R[i] = Math.tanh(R[i] * 1.2) * g * 0.8;
    }
    return buf;
  }

  // Per-scene silent mouth (never follows music). Returns { mouthOpen, mouthForm }.
  function silentMouthState(mode, t) {
    if (mode === 'sigh') {
      const u = (t % 4.5) / 4.5;
      // opens a little on the slow inhale, more on the exhale, closed in between
      const inhale = Math.sin(clamp((u - 0.05) / 0.3, 0, 1) * Math.PI) * 0.06;
      const exhale = Math.sin(clamp((u - 0.4) / 0.22, 0, 1) * Math.PI) * 0.16;
      const open = Math.max(inhale, exhale);
      return { mouthOpen: open > 0.05 ? open : 0, mouthForm: 0.25 };
    }
    if (mode === 'quiver') {
      const tremble = Math.sin(t * 31) * 0.5 + Math.sin(t * 47 + 1.3) * 0.5;
      return { mouthOpen: 0.055 + 0.022 * tremble, mouthForm: 0.95 };
    }
    return { mouthOpen: 0, mouthForm: 0.5 };
  }

  window.MusicAnalysis = { analyzeBeats, nearestBeat, lastBeatBefore, generateDemoMusic, silentMouthState };
})();
