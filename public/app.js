// app.js - Main Application Logic for Sticky Character Studio (v2: skeletal rig + viral FX engine)

class StickyStudioApp {
  constructor() {
    this.canvas = document.getElementById('stageCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.waveformCanvas = document.getElementById('waveformCanvas');
    this.waveCtx = this.waveformCanvas.getContext('2d');

    this.bgRenderer = new BackgroundRenderer();
    this.charRenderer = new CharacterRenderer();

    // v2 engines: articulated rig, camera punches, captions, media cards, SFX
    this.rig = new RigCharacter(this.charRenderer);
    this.cameraFx = new CameraFxEngine();
    this.captions = new CaptionRenderer();
    this.mediaLibrary = new Map(); // id -> { img, name, src }
    this.cardRenderer = new MediaCardRenderer(this.mediaLibrary);
    this.sfx = new SfxEngine(() => this.audioCtx);
    this.captionStyle = defaultCaptionStyle();
    this.showGizmos = true;
    this.isExporting = false;
    this.lastTriggerTime = 0;
    this.ikDragKey = null;
    this.draggingFx = null;
    this.resetTravel = false;

    // Timeline & Playback state
    this.totalDuration = 16.0;
    this.currentTime = 0.0;
    this.isPlaying = false;
    this.lastFrameTimestamp = performance.now();
    this.faceMode = 'hybrid'; // 'hybrid' (Original Sheet Art + LipSync) or 'procedural'
    this.autoSplitOnEmotion = false;
    this.lipSyncSensitivity = 1.4;

    // Audio Engine
    this.audioCtx = null;
    this.audioBuffer = null;
    this.audioSourceNode = null;
    this.analyserNode = null;
    this.audioDestNode = null;
    this.audioStartContextTime = 0;
    this.audioStartOffset = 0;
    this.audioFileName = 'Built-in Demo Voiceover (16.0s)';
    this.micActive = false;
    this.micStream = null;
    this.micSource = null;

    this.audioState = {
      mouthOpen: 0,
      mouthForm: 0.5,
      rawVolume: 0,
    };

    // Default 4-Scene YouTube Storytime Timeline (all scenes use the v2 articulated rig)
    this.scenes = [
      {
        id: 'sc_1',
        title: 'Intro Hook',
        start: 0.0,
        end: 4.0,
        emotion: 'neutral',
        pose: 'rig',
        motion: 'talk_bounce',
        background: 'cozy_night',
        camera: 'zoom_in',
        atmosphere: 'dust',
        x: 0.5,
        y: 0.55,
        scale: 1.0,
        flipX: false,
        subtitle: 'So... we need to talk about what happened last night.',
        rig: defaultRigSettings({ view: 'front', gesture: 'talking' }),
        cards: [],
        transitionSfx: 'none',
      },
      {
        id: 'sc_2',
        title: 'The Good Part',
        start: 4.0,
        end: 8.0,
        emotion: 'happy',
        pose: 'rig',
        motion: 'talk_bounce',
        background: 'paper_sketch',
        camera: 'static',
        atmosphere: 'none',
        x: 0.3,
        y: 0.55,
        scale: 0.95,
        flipX: false,
        subtitle: 'At first, everything was actually going great!',
        rig: defaultRigSettings({ view: 'three_quarter', gesture: 'idle', prop: 'mug', speed: 0.9, travel: 'translate' }),
        cards: [
          { id: 'card_demo_1', kind: 'post', text: 'Day 1 of finally being productive. Coffee in hand, zero bugs. Nothing can stop me now ☕', title: 'Sticky', side: 'left', appear: 1.3, hold: 2.5, size: 0.32 },
        ],
        transitionSfx: 'whoosh',
      },
      {
        id: 'sc_3',
        title: 'Long Night',
        start: 8.0,
        end: 12.0,
        emotion: 'tired',
        pose: 'rig',
        motion: 'breathe',
        background: 'rainy_window',
        camera: 'zoom_out',
        atmosphere: 'rain',
        x: 0.36,
        y: 0.55,
        scale: 1.0,
        flipX: false,
        subtitle: 'Then it hit 3 AM, and my brain completely stopped working...',
        rig: defaultRigSettings({ view: 'side', gesture: 'typing' }),
        cards: [
          { id: 'card_demo_2', kind: 'note', text: '3 hours later…', side: 'right', appear: 0.05, hold: 1.6, size: 0.3 },
        ],
        transitionSfx: 'whoosh',
      },
      {
        id: 'sc_4',
        title: 'The Breakdown',
        start: 12.0,
        end: 16.0,
        emotion: 'shocked',
        pose: 'rig',
        motion: 'shake',
        background: 'streetlight',
        camera: 'static',
        atmosphere: 'dust',
        x: 0.5,
        y: 0.55,
        scale: 1.05,
        flipX: false,
        subtitle: 'And that is when I realized I deleted the entire project.',
        rig: defaultRigSettings({ view: 'front', gesture: 'hands_head' }),
        cards: [],
        transitionSfx: 'scratch',
      },
    ];

    // Global FX timeline: camera punches + SFX hits (absolute seconds)
    this.fxEvents = [
      { id: 'fx_1', kind: 'camera', type: 'snap_zoom', time: 2.1, duration: 1.3, intensity: 1 },
      { id: 'fx_2', kind: 'sfx', type: 'pop', time: 2.1 },
      { id: 'fx_3', kind: 'sfx', type: 'typing', time: 8.5 },
      { id: 'fx_4', kind: 'sfx', type: 'typing', time: 10.1 },
      { id: 'fx_5', kind: 'camera', type: 'dutch', time: 10.2, duration: 1.7, intensity: 1, dir: 1 },
      { id: 'fx_6', kind: 'camera', type: 'spotlight', time: 12.2, duration: 3.7, intensity: 1 },
      { id: 'fx_7', kind: 'camera', type: 'snap_zoom', time: 13.6, duration: 2.3, intensity: 1 },
      { id: 'fx_8', kind: 'camera', type: 'shake', time: 13.6, duration: 0.8, intensity: 1 },
      { id: 'fx_9', kind: 'sfx', type: 'boom', time: 13.6 },
    ];

    this.selectedSceneId = 'sc_1';
    this.isDraggingChar = false;
    this.resizingSceneIndex = -1;
  }

  async init() {
    await this.charRenderer.load();
    this.generateDemoVoiceBuffer();
    this.buildUI();
    if (window.installStudioV2) window.installStudioV2(this);
    this.bindEvents();
    this.renderTimelineUI();
    this.syncInspectorToSelectedScene();
    this.drawWaveform();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.65;
      this.freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Synthesize a realistic speech-cadence voiceover buffer so lip-sync & waveform work out-of-the-box
  generateDemoVoiceBuffer() {
    this.ensureAudioContext();
    const sr = this.audioCtx.sampleRate;
    const dur = 16.0;
    const length = Math.floor(sr * dur);
    const buf = this.audioCtx.createBuffer(1, length, sr);
    const data = buf.getChannelData(0);

    // Create natural syllable bursts across the 4 scenes
    const phrases = [
      [0.3, 3.6, 135], // Scene 1: normal pitch
      [4.2, 7.6, 165], // Scene 2: upbeat pitch
      [8.3, 11.6, 112], // Scene 3: tired low pitch
      [12.2, 15.6, 150], // Scene 4: emotional quiver pitch
    ];

    for (const [pStart, pEnd, baseFreq] of phrases) {
      let t = pStart;
      let syllIdx = 0;
      while (t < pEnd) {
        const syllDur = 0.14 + ((syllIdx * 37) % 12) * 0.015;
        const gapDur = (syllIdx % 5 === 4) ? 0.22 : 0.045;
        const s0 = Math.floor(t * sr);
        const s1 = Math.min(length, Math.floor((t + syllDur) * sr));
        const f0 = baseFreq * (0.92 + ((syllIdx * 19) % 17) * 0.012);
        const formant = 550 + ((syllIdx * 131) % 700);

        for (let i = s0; i < s1; i++) {
          const localT = (i - s0) / Math.max(1, s1 - s0);
          const env = Math.sin(localT * Math.PI);
          const sec = i / sr;
          const vibrato = Math.sin(sec * 32) * 3.0;
          const glottal =
            0.55 * Math.sin(2 * Math.PI * (f0 + vibrato) * sec) +
            0.30 * Math.sin(2 * Math.PI * (f0 * 2) * sec) +
            0.15 * Math.sin(2 * Math.PI * formant * sec);
          data[i] = glottal * env * 0.35;
        }
        t += syllDur + gapDur;
        syllIdx++;
      }
    }

    this.audioBuffer = buf;
    this.totalDuration = dur;
  }

  async handleAudioFileUpload(file) {
    if (!file) return;
    this.pause();
    this.ensureAudioContext();

    const arrayBuf = await file.arrayBuffer();
    const decoded = await this.audioCtx.decodeAudioData(arrayBuf);
    this.audioBuffer = decoded;
    this.audioFileName = `${file.name} (${decoded.duration.toFixed(1)}s)`;
    document.getElementById('audioFileLabel').textContent = this.audioFileName;

    // Adjust timeline duration to match the uploaded audio file
    const oldDur = this.totalDuration;
    const newDur = Math.max(2.0, decoded.duration);
    this.totalDuration = newDur;

    // Scale scene boundaries proportionally to fit new audio duration
    const ratio = newDur / oldDur;
    this.scenes.forEach((sc, idx) => {
      sc.start = Number((sc.start * ratio).toFixed(2));
      sc.end = idx === this.scenes.length - 1 ? newDur : Number((sc.end * ratio).toFixed(2));
    });

    this.currentTime = 0;
    this.renderTimelineUI();
    this.drawWaveform();
    this.syncInspectorToSelectedScene();
  }

  async toggleMicrophone() {
    this.ensureAudioContext();
    const btn = document.getElementById('btnMicToggle');
    if (this.micActive) {
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
      }
      if (this.micSource) {
        try { this.micSource.disconnect(); } catch (e) {}
      }
      this.micActive = false;
      btn.classList.remove('btn-danger');
      btn.textContent = '🎙️ Live Mic: OFF';
      return;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.analyserNode);
      this.micActive = true;
      btn.classList.add('btn-danger');
      btn.textContent = '🎙️ Live Mic: ON';
    } catch (err) {
      alert('Could not access microphone: ' + err.message);
    }
  }

  play(connectToDestination = true, customDest = null) {
    if (this.isPlaying) this.stopAudioNode();
    this.ensureAudioContext();

    if (this.currentTime >= this.totalDuration - 0.05) {
      this.currentTime = 0;
    }

    if (this.audioBuffer) {
      this.audioSourceNode = this.audioCtx.createBufferSource();
      this.audioSourceNode.buffer = this.audioBuffer;
      this.audioSourceNode.connect(this.analyserNode);
      if (connectToDestination) {
        this.analyserNode.connect(this.audioCtx.destination);
      }
      if (customDest) {
        this.audioSourceNode.connect(customDest);
      }
      this.audioStartOffset = this.currentTime;
      this.audioStartContextTime = this.audioCtx.currentTime;
      this.audioSourceNode.start(0, this.currentTime);
    }

    this.isPlaying = true;
    this.lastTriggerTime = this.currentTime;
    document.getElementById('btnPlayPause').innerHTML = '⏸ Pause';
  }

  pause() {
    this.stopAudioNode();
    this.isPlaying = false;
    this.audioState.mouthOpen = 0;
    document.getElementById('btnPlayPause').innerHTML = '▶ Play';
  }

  stopAudioNode() {
    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.stop();
        this.audioSourceNode.disconnect();
      } catch (e) {}
      this.audioSourceNode = null;
    }
  }

  seek(timeSec) {
    const clamped = Math.max(0, Math.min(this.totalDuration, timeSec));
    this.currentTime = clamped;
    this.lastTriggerTime = clamped;
    this.resetTravel = true;
    const activeScene = this.getSceneAtTime(clamped);
    if (activeScene && activeScene.id !== this.selectedSceneId) {
      this.selectedSceneId = activeScene.id;
      this.syncInspectorToSelectedScene();
      this.highlightActiveSceneUI();
    }
    if (this.isPlaying) {
      this.play();
    }
    this.updatePlayheadUI();
  }

  getSceneAtTime(t) {
    for (const sc of this.scenes) {
      if (t >= sc.start && t <= sc.end + 0.001) return sc;
    }
    return this.scenes[this.scenes.length - 1] || this.scenes[0];
  }

  getSelectedScene() {
    return this.scenes.find(s => s.id === this.selectedSceneId) || this.scenes[0];
  }

  splitSceneAtPlayhead(overrideEmotion = null) {
    const t = Number(this.currentTime.toFixed(2));
    const idx = this.scenes.findIndex(s => t > s.start + 0.35 && t < s.end - 0.35);
    if (idx === -1) return null;

    const orig = this.scenes[idx];
    const oldEnd = orig.end;
    orig.end = t;

    const newScene = {
      ...JSON.parse(JSON.stringify(orig)),
      id: 'sc_' + Date.now() + '_' + Math.floor(Math.random() * 999),
      title: `Scene ${this.scenes.length + 1}`,
      start: t,
      end: oldEnd,
      emotion: overrideEmotion || orig.emotion,
      cards: [],
      transitionSfx: 'none',
    };

    this.scenes.splice(idx + 1, 0, newScene);
    this.selectedSceneId = newScene.id;
    this.renderTimelineUI();
    this.syncInspectorToSelectedScene();
    return newScene;
  }

  addSceneAtEnd() {
    const last = this.scenes[this.scenes.length - 1];
    const addDur = 4.0;
    const newStart = last ? last.end : 0;
    const newEnd = newStart + addDur;
    this.totalDuration = newEnd;

    const newScene = {
      id: 'sc_' + Date.now(),
      title: `Scene ${this.scenes.length + 1}`,
      start: newStart,
      end: newEnd,
      emotion: 'neutral',
      pose: last ? last.pose : 'front',
      motion: 'talk_bounce',
      background: last ? last.background : 'cozy_night',
      camera: 'static',
      atmosphere: 'dust',
      x: 0.5,
      y: last && last.pose === 'bust' ? 0.62 : 0.55,
      scale: 1.0,
      flipX: false,
      subtitle: '',
      rig: last && last.rig
        ? { ...JSON.parse(JSON.stringify(last.rig)), speed: 0, ik: {} }
        : defaultRigSettings(),
      cards: [],
      transitionSfx: 'whoosh',
    };

    this.scenes.push(newScene);
    this.selectedSceneId = newScene.id;
    this.renderTimelineUI();
    this.drawWaveform();
    this.syncInspectorToSelectedScene();
  }

  deleteSelectedScene() {
    if (this.scenes.length <= 1) return;
    const idx = this.scenes.findIndex(s => s.id === this.selectedSceneId);
    if (idx === -1) return;

    const removed = this.scenes[idx];
    if (idx > 0) {
      this.scenes[idx - 1].end = removed.end;
      this.selectedSceneId = this.scenes[idx - 1].id;
    } else {
      this.scenes[1].start = 0;
      this.selectedSceneId = this.scenes[1].id;
    }
    this.scenes.splice(idx, 1);
    this.renderTimelineUI();
    this.syncInspectorToSelectedScene();
  }

  updateAudioAnalysis() {
    if (!this.analyserNode || (!this.isPlaying && !this.micActive)) {
      this.audioState.mouthOpen *= 0.72;
      this.audioState.rawVolume = 0;
      document.getElementById('micMeterFill').style.width = '0%';
      return;
    }

    this.analyserNode.getByteFrequencyData(this.freqData);
    // Voice energy resides mostly in bins 2..65 (approx 85Hz to 3200Hz)
    let lowSum = 0;
    let highSum = 0;
    for (let i = 2; i < 22; i++) lowSum += this.freqData[i];
    for (let i = 22; i < 65; i++) highSum += this.freqData[i];

    const lowAvg = lowSum / 20 / 255;
    const highAvg = highSum / 43 / 255;
    const combined = (lowAvg * 0.65 + highAvg * 0.35) * this.lipSyncSensitivity;

    // Noise gate + smooth attack/release
    const targetOpen = combined < 0.04 ? 0 : Math.min(1.0, (combined - 0.04) * 1.65);
    this.audioState.mouthOpen = this.audioState.mouthOpen * 0.35 + targetOpen * 0.65;
    this.audioState.mouthForm = lowAvg + highAvg > 0.01 ? Math.min(1.0, highAvg / (lowAvg + 0.05)) : 0.5;
    this.audioState.rawVolume = Math.min(100, Math.round(targetOpen * 100));

    document.getElementById('micMeterFill').style.width = `${this.audioState.rawVolume}%`;
  }

  loop(timestamp) {
    const dt = Math.min(0.1, (timestamp - this.lastFrameTimestamp) / 1000);
    this.lastFrameTimestamp = timestamp;

    if (this.isPlaying) {
      if (this.audioBuffer && this.audioCtx) {
        this.currentTime = this.audioStartOffset + (this.audioCtx.currentTime - this.audioStartContextTime);
      } else {
        this.currentTime += dt;
      }

      if (this.currentTime >= this.totalDuration) {
        this.currentTime = this.totalDuration;
        this.pause();
      }

      const activeScene = this.getSceneAtTime(this.currentTime);
      if (activeScene && activeScene.id !== this.selectedSceneId) {
        this.selectedSceneId = activeScene.id;
        this.syncInspectorToSelectedScene();
        this.highlightActiveSceneUI();
      }
      this.updatePlayheadUI();
    }

    if (this.isPlaying) this.fireTimelineTriggers(this.lastTriggerTime, this.currentTime);
    this.lastTriggerTime = this.currentTime;

    this.updateAudioAnalysis();
    this.renderStage(timestamp / 1000, dt);

    requestAnimationFrame((ts) => this.loop(ts));
  }

  // Fire SFX events, scene-transition SFX and card pop sounds whose time falls in [from, to)
  fireTimelineTriggers(from, to) {
    if (to <= from) return;
    const inWin = (t) => t >= from && t < to;
    this.fxEvents.forEach((ev) => {
      if (ev.kind === 'sfx' && inWin(ev.time)) this.sfx.play(ev.type, { volume: ev.volume ?? 1 });
    });
    this.scenes.forEach((sc) => {
      if (sc.transitionSfx && sc.transitionSfx !== 'none' && inWin(sc.start)) this.sfx.play(sc.transitionSfx);
      (sc.cards || []).forEach((card) => {
        const sfx = card.sfx === undefined ? 'pop' : card.sfx;
        if (sfx && sfx !== 'none' && inWin(sc.start + (card.appear || 0))) this.sfx.play(sfx, { volume: 0.8 });
      });
    });
  }

  renderStage(wallTimeSec, dt = 1 / 60) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;
    const scene = this.getSceneAtTime(this.currentTime);
    if (!scene) return;

    const sceneDur = Math.max(0.1, scene.end - scene.start);
    const sceneProgress = Math.max(0, Math.min(1, (this.currentTime - scene.start) / sceneDur));
    const isRig = scene.pose === 'rig';

    // Clear (camera tilt / shake can reveal the canvas edge)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Simulate the articulated rig (gait, IK, gestures, cloth physics)
    if (isRig) {
      if (!scene.rig) scene.rig = defaultRigSettings();
      this.rig.update(dt, {
        scene, W, H, time: wallTimeSec, audio: this.audioState, resetTravel: this.resetTravel,
      });
      this.resetTravel = false;
    }

    // Character anchors in stage space (focus for snap zoom, spotlight & card placement)
    const head = isRig
      ? this.rig.headScreen()
      : { x: (scene.x ?? 0.5) * W, y: (scene.y ?? 0.55) * H - H * (scene.pose === 'bust' ? 0.1 : 0.27) };
    const chest = isRig
      ? this.rig.chestScreen()
      : { x: (scene.x ?? 0.5) * W, y: (scene.y ?? 0.55) * H - H * 0.08 };

    const fx = this.cameraFx.evaluate(this.fxEvents, this.currentTime, scene);
    ctx.save();
    this.cameraFx.apply(ctx, W, H, fx, head);

    // Scene camera move
    let camScale = 1.0;
    let camTx = 0;
    let camTy = 0;

    if (scene.camera === 'zoom_in') {
      camScale = 1.0 + sceneProgress * 0.12;
    } else if (scene.camera === 'zoom_out') {
      camScale = 1.12 - sceneProgress * 0.12;
    } else if (scene.camera === 'pan_right') {
      camScale = 1.08;
      camTx = (0.5 - sceneProgress) * W * 0.06;
    } else if (scene.camera === 'handheld') {
      camScale = 1.03;
      camTx = Math.sin(wallTimeSec * 1.9) * 6;
      camTy = Math.cos(wallTimeSec * 2.3) * 4;
    }

    if (camScale !== 1.0 || camTx !== 0 || camTy !== 0) {
      ctx.translate(W / 2 + camTx, H / 2 + camTy);
      ctx.scale(camScale, camScale);
      ctx.translate(-W / 2, -H / 2);
    }

    // 1. Background + Atmosphere
    this.bgRenderer.render(ctx, W, H, scene.background, wallTimeSec, scene);

    // 2. Spotlight dimming (background only — the character & glowing eyes stay bright)
    const charScale = isRig ? this.rig.S : (H * 0.76 / 358) * (scene.scale ?? 1);
    this.cameraFx.drawSpotlight(ctx, W, H, fx.dim, chest, 150 * charScale);

    // 3. Character
    if (isRig) {
      this.rig.draw(ctx, {
        scene,
        time: wallTimeSec,
        audio: this.audioState,
        faceMode: this.faceMode,
        showGizmos: this.showGizmos && !this.isExporting && !this.isPlaying,
      });
    } else {
      this.charRenderer.render(ctx, W, H, wallTimeSec, this.audioState, scene, this.faceMode);
    }

    ctx.restore();

    // 4. Picture-in-picture media cards (screen space)
    this.cardRenderer.render(ctx, W, H, scene, this.currentTime, head ? head.x : W / 2);

    // 5. Animated captions (pop-in words / karaoke / classic box)
    this.captions.render(ctx, W, H, scene, this.currentTime, this.captionStyle);

    // HUD
    const rigInfo = isRig
      ? ` • 🦴 ${scene.rig.gesture}${this.rig.loco.speed > 0.05 ? ` @ ${this.rig.loco.speed.toFixed(2)}x` : ''}`
      : ` (${scene.pose})`;
    const hudText = `${scene.title} • ${scene.emotion.toUpperCase()}${rigInfo}`;
    if (this._hudText !== hudText) {
      this._hudText = hudText;
      document.getElementById('hudSceneName').textContent = hudText;
    }
  }

  buildUI() {
    // Populate Emotion Grid
    const emoGrid = document.getElementById('emotionGrid');
    emoGrid.innerHTML = '';
    window.EMOTIONS.forEach(em => {
      const btn = document.createElement('button');
      btn.className = 'emotion-btn';
      btn.dataset.emotion = em.id;
      btn.innerHTML = `
        <span>${em.icon}</span>
        <span style="font-weight:600">${em.name}</span>
        <span class="emotion-hotkey">${em.hotkey}</span>
      `;
      btn.addEventListener('click', () => this.selectEmotion(em.id));
      emoGrid.appendChild(btn);
    });

    // Populate Background Grid
    this.renderBackgroundButtons();
  }

  renderBackgroundButtons() {
    const bgGrid = document.getElementById('bgGrid');
    bgGrid.innerHTML = '';

    // Custom uploaded backgrounds first
    for (const [id, item] of this.bgRenderer.customMedia.entries()) {
      const btn = document.createElement('button');
      btn.className = 'bg-btn';
      btn.dataset.bg = id;
      btn.innerHTML = `
        <span class="bg-swatch" style="background:#6366f1"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name}</span>
      `;
      btn.addEventListener('click', () => this.selectBackground(id));
      bgGrid.appendChild(btn);
    }

    // Built-in backgrounds
    window.BG_PRESETS.forEach(bg => {
      const btn = document.createElement('button');
      btn.className = 'bg-btn';
      btn.dataset.bg = bg.id;
      btn.innerHTML = `
        <span class="bg-swatch" style="background:${bg.swatch}"></span>
        <span>${bg.name}</span>
      `;
      btn.addEventListener('click', () => this.selectBackground(bg.id));
      bgGrid.appendChild(btn);
    });
  }

  selectEmotion(emotionId) {
    if (this.isPlaying && this.autoSplitOnEmotion) {
      const created = this.splitSceneAtPlayhead(emotionId);
      if (created) return;
    }
    const sc = this.getSelectedScene();
    if (!sc) return;
    sc.emotion = emotionId;
    this.syncInspectorToSelectedScene();
    this.renderTimelineUI();
  }

  selectBackground(bgId) {
    const sc = this.getSelectedScene();
    if (!sc) return;
    sc.background = bgId;
    this.syncInspectorToSelectedScene();
    this.renderTimelineUI();
  }

  applyBackgroundToAllScenes() {
    const sc = this.getSelectedScene();
    if (!sc) return;
    this.scenes.forEach(s => { s.background = sc.background; });
    this.renderTimelineUI();
  }

  syncInspectorToSelectedScene() {
    const sc = this.getSelectedScene();
    if (!sc) return;

    document.getElementById('sceneTitleInput').value = sc.title || '';
    document.getElementById('sceneSubtitleInput').value = sc.subtitle || '';
    document.getElementById('sceneMotionSelect').value = sc.motion || 'talk_bounce';
    document.getElementById('sceneCameraSelect').value = sc.camera || 'static';
    document.getElementById('sceneAtmoSelect').value = sc.atmosphere || 'dust';
    document.getElementById('charScaleSlider').value = sc.scale ?? 1.0;
    document.getElementById('charScaleVal').textContent = `${Math.round((sc.scale ?? 1.0) * 100)}%`;
    document.getElementById('charFlipCheck').checked = !!sc.flipX;

    // Highlight active emotion button
    document.querySelectorAll('.emotion-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.emotion === sc.emotion);
    });

    // Highlight active pose button
    document.querySelectorAll('.pose-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pose === sc.pose);
    });

    // Highlight active background button
    document.querySelectorAll('.bg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bg === sc.background);
    });

    if (this.syncV2Inspector) this.syncV2Inspector();
  }

  renderTimelineUI() {
    // 1. Left panel scene list
    const listEl = document.getElementById('sceneListContainer');
    listEl.innerHTML = '';

    this.scenes.forEach((sc, idx) => {
      const emoObj = window.EMOTIONS.find(e => e.id === sc.emotion) || window.EMOTIONS[0];
      const item = document.createElement('div');
      item.className = 'scene-list-item' + (sc.id === this.selectedSceneId ? ' active' : '');
      item.innerHTML = `
        <div class="scene-list-top">
          <span>${idx + 1}. ${sc.title}</span>
          <span style="font-family:monospace;font-size:11px;color:#94a0b8">${sc.start.toFixed(1)}s – ${sc.end.toFixed(1)}s</span>
        </div>
        <div class="scene-list-sub">
          <span>${emoObj.icon} ${emoObj.name}</span>
          <span>•</span>
          <span>Pose: ${sc.pose === 'rig' ? '🦴 ' + (sc.rig?.gesture || 'rig') : sc.pose}</span>
          <span>•</span>
          <span>BG: ${sc.background}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        this.selectedSceneId = sc.id;
        this.seek(sc.start + 0.02);
        this.syncInspectorToSelectedScene();
        this.highlightActiveSceneUI();
      });
      listEl.appendChild(item);
    });

    // 2. Bottom timeline track blocks
    const trackEl = document.getElementById('scenesTrack');
    trackEl.innerHTML = '';

    this.scenes.forEach((sc, idx) => {
      const emoObj = window.EMOTIONS.find(e => e.id === sc.emotion) || window.EMOTIONS[0];
      const leftPct = (sc.start / this.totalDuration) * 100;
      const widthPct = ((sc.end - sc.start) / this.totalDuration) * 100;

      const block = document.createElement('div');
      block.className = 'scene-block' + (sc.id === this.selectedSceneId ? ' active' : '');
      block.dataset.id = sc.id;
      block.style.left = `${leftPct}%`;
      block.style.width = `${widthPct}%`;
      block.innerHTML = `
        <div class="scene-block-header">
          <span>${emoObj.icon} ${sc.title}</span>
          <span style="font-weight:400;opacity:0.8">${(sc.end - sc.start).toFixed(1)}s</span>
        </div>
        <div class="scene-block-meta">${emoObj.name} • ${sc.pose === 'rig' ? '🦴 ' + (sc.rig?.gesture || 'rig') + (sc.rig?.speed ? ' ' + sc.rig.speed + 'x' : '') : sc.pose} • ${sc.background}</div>
      `;

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedSceneId = sc.id;
        this.syncInspectorToSelectedScene();
        this.highlightActiveSceneUI();
      });

      // Add draggable resize handle between scenes
      if (idx < this.scenes.length - 1) {
        const handle = document.createElement('div');
        handle.className = 'scene-resize-handle';
        handle.title = 'Drag to adjust scene timing';
        handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.resizingSceneIndex = idx;
        });
        block.appendChild(handle);
      }

      trackEl.appendChild(block);
    });

    if (this.renderFxTrack) this.renderFxTrack();
    this.updatePlayheadUI();
  }

  highlightActiveSceneUI() {
    document.querySelectorAll('.scene-list-item').forEach((el, i) => {
      el.classList.toggle('active', this.scenes[i]?.id === this.selectedSceneId);
    });
    document.querySelectorAll('.scene-block').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === this.selectedSceneId);
    });
  }

  updatePlayheadUI() {
    const pct = Math.max(0, Math.min(100, (this.currentTime / this.totalDuration) * 100));
    document.getElementById('playheadLine').style.left = `${pct}%`;
    document.getElementById('timeReadout').textContent =
      `${this.formatTime(this.currentTime)} / ${this.formatTime(this.totalDuration)}`;
  }

  formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  drawWaveform() {
    const W = (this.waveformCanvas.width = this.waveformCanvas.clientWidth || 900);
    const H = (this.waveformCanvas.height = 54);
    const ctx = this.waveCtx;

    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, W, H);

    // Center line
    ctx.strokeStyle = '#1f2637';
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    if (!this.audioBuffer) return;
    const data = this.audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));

    ctx.fillStyle = '#6366f1';
    for (let x = 0; x < W; x++) {
      let max = 0;
      const startIdx = x * step;
      for (let j = 0; j < step && startIdx + j < data.length; j += 4) {
        const v = Math.abs(data[startIdx + j]);
        if (v > max) max = v;
      }
      const barH = Math.max(2, Math.min(H - 4, max * H * 1.9));
      ctx.fillRect(x, (H - barH) / 2, 1, barH);
    }
  }

  bindEvents() {
    // Play / Pause
    document.getElementById('btnPlayPause').addEventListener('click', () => {
      if (this.isPlaying) this.pause();
      else this.play();
    });

    // Restart
    document.getElementById('btnRestart').addEventListener('click', () => {
      this.seek(0);
    });

    // Split Scene at Playhead
    document.getElementById('btnSplitScene').addEventListener('click', () => {
      this.splitSceneAtPlayhead();
    });

    // Add / Delete Scene
    document.getElementById('btnAddScene').addEventListener('click', () => this.addSceneAtEnd());
    document.getElementById('btnDeleteScene').addEventListener('click', () => this.deleteSelectedScene());

    // Upload Voiceover Audio
    const audioInput = document.getElementById('audioFileInput');
    document.getElementById('btnUploadAudio').addEventListener('click', () => audioInput.click());
    audioInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleAudioFileUpload(e.target.files[0]);
    });

    // Upload Custom Background (Image or Video)
    const bgInput = document.getElementById('bgFileInput');
    document.getElementById('btnUploadBg').addEventListener('click', () => bgInput.click());
    bgInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const id = 'custom_bg_' + Date.now();
      if (file.type.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = url;
        vid.muted = true;
        vid.loop = true;
        vid.play();
        this.bgRenderer.registerCustomMedia(id, 'video', vid, file.name, url);
        this.renderBackgroundButtons();
        this.selectBackground(id);
      } else {
        const img = new Image();
        img.onload = () => {
          this.bgRenderer.registerCustomMedia(id, 'image', img, file.name, url);
          this.renderBackgroundButtons();
          this.selectBackground(id);
        };
        img.src = url;
      }
    });

    document.getElementById('btnApplyBgAll').addEventListener('click', () => {
      this.applyBackgroundToAllScenes();
    });

    // Live Mic toggle
    document.getElementById('btnMicToggle').addEventListener('click', () => this.toggleMicrophone());

    // Pose buttons
    document.querySelectorAll('.pose-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = this.getSelectedScene();
        if (!sc) return;
        sc.pose = btn.dataset.pose;
        if (sc.pose === 'rig' && !sc.rig) sc.rig = defaultRigSettings();
        if (sc.pose === 'bust' && sc.y < 0.58) sc.y = 0.62;
        if (sc.pose !== 'bust' && sc.y > 0.60) sc.y = 0.55;
        this.syncInspectorToSelectedScene();
        this.renderTimelineUI();
      });
    });

    // Face Style toggle (Original Art + LipSync vs Procedural Morph)
    document.getElementById('faceModeSelect').addEventListener('change', (e) => {
      this.faceMode = e.target.value;
    });

    // Auto-Split on Emotion Click toggle
    document.getElementById('autoSplitCheck').addEventListener('change', (e) => {
      this.autoSplitOnEmotion = e.target.checked;
    });

    // Scene Inspector inputs
    document.getElementById('sceneTitleInput').addEventListener('input', (e) => {
      const sc = this.getSelectedScene();
      if (sc) {
        sc.title = e.target.value;
        this.renderTimelineUI();
      }
    });

    document.getElementById('sceneSubtitleInput').addEventListener('input', (e) => {
      const sc = this.getSelectedScene();
      if (sc) sc.subtitle = e.target.value;
    });

    document.getElementById('sceneMotionSelect').addEventListener('change', (e) => {
      const sc = this.getSelectedScene();
      if (sc) sc.motion = e.target.value;
    });

    document.getElementById('sceneCameraSelect').addEventListener('change', (e) => {
      const sc = this.getSelectedScene();
      if (sc) sc.camera = e.target.value;
    });

    document.getElementById('sceneAtmoSelect').addEventListener('change', (e) => {
      const sc = this.getSelectedScene();
      if (sc) sc.atmosphere = e.target.value;
    });

    document.getElementById('charScaleSlider').addEventListener('input', (e) => {
      const sc = this.getSelectedScene();
      if (sc) {
        sc.scale = parseFloat(e.target.value);
        document.getElementById('charScaleVal').textContent = `${Math.round(sc.scale * 100)}%`;
      }
    });

    document.getElementById('charFlipCheck').addEventListener('change', (e) => {
      const sc = this.getSelectedScene();
      if (sc) sc.flipX = e.target.checked;
    });

    // Canvas: IK effector dragging (hands / feet / head) or drag the whole character
    this.canvas.addEventListener('mousedown', (e) => {
      const active = this.getSceneAtTime(this.currentTime);
      if (active && active.pose === 'rig' && this.showGizmos && !this.isPlaying && !e.shiftKey) {
        const pt = this.canvasPoint(e);
        const key = this.rig.hitTest(pt.x, pt.y);
        if (key) {
          this.ikDragKey = key;
          this.ikDragScene = active;
          this.rig.dragKey = key;
          this.rig.dragEffector(key, pt.x, pt.y, active.rig);
          e.preventDefault();
          return;
        }
      }
      this.isDraggingChar = true;
      this.updateCharPosFromMouse(e);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const active = this.getSceneAtTime(this.currentTime);
      if (this.ikDragKey || !active || active.pose !== 'rig' || !this.showGizmos || this.isPlaying) {
        this.rig.hoverKey = null;
        this.canvas.style.cursor = this.ikDragKey ? 'grabbing' : '';
        return;
      }
      const pt = this.canvasPoint(e);
      this.rig.hoverKey = this.rig.hitTest(pt.x, pt.y);
      this.canvas.style.cursor = this.rig.hoverKey ? 'crosshair' : '';
    });
    this.canvas.addEventListener('dblclick', (e) => {
      const active = this.getSceneAtTime(this.currentTime);
      if (!active || active.pose !== 'rig') return;
      const pt = this.canvasPoint(e);
      const key = this.rig.hitTest(pt.x, pt.y);
      if (key && active.rig.ik && active.rig.ik[key]) {
        delete active.rig.ik[key];
        if (this.syncV2Inspector) this.syncV2Inspector();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.ikDragKey && this.ikDragScene) {
        const pt = this.canvasPoint(e);
        this.rig.dragEffector(this.ikDragKey, pt.x, pt.y, this.ikDragScene.rig);
        return;
      }
      if (this.isDraggingChar) {
        this.updateCharPosFromMouse(e);
      }
      if (this.resizingSceneIndex !== -1) {
        const trackRect = document.getElementById('scenesTrack').getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - trackRect.left) / trackRect.width));
        const newBoundary = Number((ratio * this.totalDuration).toFixed(2));
        const leftSc = this.scenes[this.resizingSceneIndex];
        const rightSc = this.scenes[this.resizingSceneIndex + 1];
        if (newBoundary > leftSc.start + 0.4 && newBoundary < rightSc.end - 0.4) {
          leftSc.end = newBoundary;
          rightSc.start = newBoundary;
          this.renderTimelineUI();
        }
      }
    });
    window.addEventListener('mouseup', () => {
      if (this.ikDragKey && this.syncV2Inspector) this.syncV2Inspector();
      this.ikDragKey = null;
      this.ikDragScene = null;
      this.rig.dragKey = null;
      this.isDraggingChar = false;
      this.resizingSceneIndex = -1;
    });

    // Waveform scrubbing
    this.waveformCanvas.addEventListener('mousedown', (e) => {
      const rect = this.waveformCanvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.seek(ratio * this.totalDuration);
    });

    // Keyboard shortcuts (Space = play/pause, S = split scene, 1-9/0 = emotions)
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.isPlaying) this.pause();
        else this.play();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.splitSceneAtPlayhead();
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this.showGizmos = !this.showGizmos;
        if (this.syncV2Inspector) this.syncV2Inspector();
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        this.rig.loco.triggerJump();
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (this.addFxEvent) this.addFxEvent('camera', 'snap_zoom');
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (this.addFxEvent) this.addFxEvent('sfx', 'boom');
      } else {
        const matchedEmo = window.EMOTIONS.find(em => em.hotkey === e.key);
        if (matchedEmo) {
          e.preventDefault();
          this.selectEmotion(matchedEmo.id);
        }
      }
    });

    // Export Video (MP4)
    document.getElementById('btnExportMp4').addEventListener('click', () => this.exportFullVideoMp4());
  }

  // Mouse event → canvas pixel coordinates (independent of CSS scaling)
  canvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  updateCharPosFromMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = Math.max(0.08, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.15, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    const sc = this.getSelectedScene();
    if (sc) {
      sc.x = Number(nx.toFixed(3));
      sc.y = Number(ny.toFixed(3));
    }
  }

  async exportFullVideoMp4() {
    this.pause();
    this.ensureAudioContext();

    const overlay = document.getElementById('exportOverlay');
    const statusText = document.getElementById('exportStatusText');
    const progressFill = document.getElementById('exportProgressFill');
    overlay.classList.add('visible');
    statusText.textContent = 'Rendering timeline & lip-sync audio...';
    progressFill.style.width = '0%';

    // Create combined MediaStream (60fps Canvas video + WebAudio voiceover track)
    const canvasStream = this.canvas.captureStream(60);
    const audioDest = this.audioCtx.createMediaStreamDestination();
    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ];
    const combinedStream = new MediaStream(combinedTracks);

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const donePromise = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });

    this.isExporting = true;
    this.sfx.setExtraDestination(audioDest);
    this.seek(0);
    recorder.start(100);
    this.play(true, audioDest);

    const progressTimer = setInterval(() => {
      const pct = Math.min(95, Math.round((this.currentTime / this.totalDuration) * 95));
      progressFill.style.width = `${pct}%`;
      if (!this.isPlaying && recorder.state === 'recording') {
        clearInterval(progressTimer);
        recorder.stop();
      }
    }, 100);

    await donePromise;
    clearInterval(progressTimer);
    this.isExporting = false;
    this.sfx.setExtraDestination(null);

    statusText.textContent = 'Encoding YouTube-ready MP4 (H.264 + AAC via FFmpeg)...';
    progressFill.style.width = '98%';

    const webmBlob = new Blob(chunks, { type: mimeType });
    try {
      const res = await fetch('/api/convert-mp4', {
        method: 'POST',
        body: webmBlob,
      });

      if (!res.ok) throw new Error('MP4 conversion failed');
      const savedPath = res.headers.get('X-Saved-Path') || '';
      const mp4Blob = await res.blob();
      const downloadUrl = URL.createObjectURL(mp4Blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `sticky_youtube_video_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      progressFill.style.width = '100%';
      statusText.textContent = savedPath
        ? `Done! Saved MP4 to ${savedPath}`
        : 'Done! MP4 downloaded.';
      setTimeout(() => overlay.classList.remove('visible'), 2200);
    } catch (err) {
      // Fallback download WebM if needed
      const url = URL.createObjectURL(webmBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sticky_youtube_video_${Date.now()}.webm`;
      a.click();
      overlay.classList.remove('visible');
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.studioApp = new StickyStudioApp();
  window.studioApp.init();
});
