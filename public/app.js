// app.js - Main Application Logic for Sticky Character Studio

class StickyStudioApp {
  constructor() {
    this.canvas = document.getElementById('stageCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.waveformCanvas = document.getElementById('waveformCanvas');
    this.waveCtx = this.waveformCanvas.getContext('2d');

    this.bgRenderer = new BackgroundRenderer();
    this.charRenderer = new CharacterRenderer();

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

    // Default 4-Scene YouTube Storytime Timeline
    this.scenes = [
      {
        id: 'sc_1',
        title: 'Intro Hook',
        start: 0.0,
        end: 4.0,
        emotion: 'neutral',
        pose: 'front',
        motion: 'talk_bounce',
        background: 'cozy_night',
        camera: 'zoom_in',
        atmosphere: 'dust',
        x: 0.5,
        y: 0.55,
        scale: 1.0,
        flipX: false,
        subtitle: 'So... we need to talk about what happened last night.',
      },
      {
        id: 'sc_2',
        title: 'The Good Part',
        start: 4.0,
        end: 8.0,
        emotion: 'happy',
        pose: 'bust',
        motion: 'talk_bounce',
        background: 'paper_sketch',
        camera: 'static',
        atmosphere: 'none',
        x: 0.5,
        y: 0.62,
        scale: 1.05,
        flipX: false,
        subtitle: 'At first, everything was actually going great!',
      },
      {
        id: 'sc_3',
        title: 'Long Night',
        start: 8.0,
        end: 12.0,
        emotion: 'tired',
        pose: 'front',
        motion: 'breathe',
        background: 'rainy_window',
        camera: 'zoom_out',
        atmosphere: 'rain',
        x: 0.46,
        y: 0.55,
        scale: 1.0,
        flipX: false,
        subtitle: 'Then it hit 3 AM, and my brain completely stopped working...',
      },
      {
        id: 'sc_4',
        title: 'The Breakdown',
        start: 12.0,
        end: 16.0,
        emotion: 'crying',
        pose: 'bust',
        motion: 'shake',
        background: 'streetlight',
        camera: 'zoom_in',
        atmosphere: 'dust',
        x: 0.5,
        y: 0.62,
        scale: 1.08,
        flipX: false,
        subtitle: 'And that is when I realized I deleted the entire project.',
      },
    ];

    this.selectedSceneId = 'sc_1';
    this.isDraggingChar = false;
    this.resizingSceneIndex = -1;
  }

  async init() {
    await this.charRenderer.load();
    this.generateDemoVoiceBuffer();
    this.buildUI();
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

    this.updateAudioAnalysis();
    this.renderStage(timestamp / 1000);

    requestAnimationFrame((ts) => this.loop(ts));
  }

  renderStage(wallTimeSec) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scene = this.getSceneAtTime(this.currentTime);
    if (!scene) return;

    const sceneDur = Math.max(0.1, scene.end - scene.start);
    const sceneProgress = Math.max(0, Math.min(1, (this.currentTime - scene.start) / sceneDur));

    // Camera transform per scene
    this.ctx.save();
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
      this.ctx.translate(W / 2 + camTx, H / 2 + camTy);
      this.ctx.scale(camScale, camScale);
      this.ctx.translate(-W / 2, -H / 2);
    }

    // 1. Render Background + Atmosphere
    this.bgRenderer.render(this.ctx, W, H, scene.background, wallTimeSec, scene);

    // 2. Render Sticky Character with Emotion + Lip-Sync
    this.charRenderer.render(
      this.ctx,
      W,
      H,
      wallTimeSec,
      this.audioState,
      scene,
      this.faceMode
    );

    this.ctx.restore();

    // 3. Render Subtitle / Caption if present
    if (scene.subtitle && scene.subtitle.trim().length > 0) {
      this.renderSubtitle(this.ctx, W, H, scene.subtitle.trim());
    }

    // Update HUD labels
    document.getElementById('hudSceneName').textContent = `${scene.title} • ${scene.emotion.toUpperCase()} (${scene.pose})`;
  }

  renderSubtitle(ctx, W, H, text) {
    ctx.save();
    ctx.font = '700 28px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(text);
    const padX = 24;
    const padY = 14;
    const boxW = Math.min(W * 0.86, metrics.width + padX * 2);
    const boxH = 52;
    const bx = (W - boxW) / 2;
    const by = H - 78;

    ctx.fillStyle = 'rgba(10, 12, 18, 0.82)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 252, 230, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fffdf2';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, W / 2, by + boxH / 2, W * 0.82);
    ctx.restore();
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
          <span>Pose: ${sc.pose}</span>
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
        <div class="scene-block-meta">${emoObj.name} • ${sc.pose} • ${sc.background}</div>
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

    // Drag character directly on canvas
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDraggingChar = true;
      this.updateCharPosFromMouse(e);
    });
    window.addEventListener('mousemove', (e) => {
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

    this.currentTime = 0;
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
