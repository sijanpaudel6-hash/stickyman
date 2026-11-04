// remoteBridge.js — Two-way live bridge between the studio tab and the local server, so AI agents
// (MCP server / CLI) can direct the studio: GET /api/bridge/events (SSE) delivers RPC commands, results go
// back via POST /api/bridge/reply, and the project is mirrored to projects/live_state.json.
(function () {
  const P = window.StickyProject;
  const bridge = {
    es: null,
    clientId: null,
    connected: false,
    restoredOnce: false,
    appliedServerStateAt: 0,
    lastPushed: '',
    busy: 0,
  };
  window.stickyBridge = bridge;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const app = () => window.studioApp;

  async function appReady() {
    for (let i = 0; i < 400; i++) {
      const a = app();
      if (a && a.charRenderer && a.charRenderer.ready && a.syncV2Inspector && a.loadTemplate) return a;
      await sleep(50);
    }
    throw new Error('studio app did not initialise');
  }

  // ---------- Status pill ----------
  function pill(stateName, text) {
    let el = document.getElementById('agentBridgePill');
    if (!el) {
      el = document.createElement('span');
      el.id = 'agentBridgePill';
      el.className = 'bridge-pill';
      el.title = 'Live link to the local server — AI agents (MCP / CLI) control the studio through it';
      const bar = document.querySelector('.topbar-actions');
      if (bar) bar.insertBefore(el, bar.firstChild);
    }
    el.dataset.state = stateName;
    el.textContent = text;
  }

  // ---------- Serialization ----------
  function lightProfile(L) {
    if (!L) return null;
    const round = (c) => c.map((v) => Math.round(v));
    const [r, , b] = L.ambient;
    return {
      ambient: round(L.ambient), sky: round(L.top), ground: round(L.bottom), key: round(L.key),
      luminance: r3(L.lum), keyLuminance: r3(L.keyLum), lightX: r3(L.lightX),
      tone: b > r * 1.12 ? 'cool' : r > b * 1.12 ? 'warm' : 'neutral',
      brightness: L.lum < 0.18 ? 'dark' : L.lum < 0.45 ? 'mid' : 'bright',
      lightFrom: L.lightX < -0.15 ? 'left' : L.lightX > 0.15 ? 'right' : 'even',
    };
  }

  function backgroundList(a) {
    return [...a.bgRenderer.customMedia.entries()].map(([id, item]) => ({
      bgId: id,
      name: item.name,
      path: item.path || null,
      type: item.type,
      width: item.type === 'video' ? item.el.videoWidth : item.el.naturalWidth,
      height: item.type === 'video' ? item.el.videoHeight : item.el.naturalHeight,
      lightProfile: lightProfile(item.lighting),
    }));
  }

  function beatTimes(a) {
    return a.musicAnalysis ? a.musicAnalysis.beats.map((b) => r3(b.time)) : [];
  }

  function serializeProject() {
    const a = app();
    const bgInfo = Object.fromEntries([...a.bgRenderer.customMedia.entries()].map(([id, it]) => [id, { name: it.name }]));
    return {
      version: 4,
      mode: a.filmMode,
      aspectRatio: P.aspectOut(a.aspect),
      fadeOutEnd: a.filmFadeOut || 0,
      masterAmbientVol: r3(a.ambientMaster ?? 0.8),
      snapToBeats: !!a.snapToBeats,
      captionStyle: { ...a.captionStyle },
      totalDuration: r3(a.totalDuration),
      currentTime: r3(a.currentTime),
      audio: {
        fileName: a.audioFileName,
        path: a.audioPath || null,
        isDemo: !!a.audioIsDemo,
        duration: a.audioBuffer ? r3(a.audioBuffer.duration) : 0,
        bpm: a.musicAnalysis ? a.musicAnalysis.bpm : 0,
        beats: beatTimes(a),
        strongBeats: a.musicAnalysis ? a.musicAnalysis.beats.filter((b) => b.strength > 0.6).map((b) => r3(b.time)) : [],
      },
      backgrounds: backgroundList(a),
      scenes: a.scenes.map((s, i) => P.internalToFlat(s, i, bgInfo)),
      fxMarkers: a.fxEvents.map(P.fxToFlat),
      mediaCards: a.scenes.flatMap((s, i) => (s.cards || []).map((c) => P.cardToFlat(c, i, s.id))),
    };
  }

  async function pushState(force = false) {
    if (!bridge.restoredOnce || (bridge.holdPush && !force)) return;
    bridge.holdPush = false;
    let project;
    try {
      project = serializeProject();
    } catch (e) {
      return;
    }
    const json = JSON.stringify(project);
    const cmp = json.replace(/"currentTime":[0-9.]+/, '');
    if (!force && cmp === bridge.lastPushed) return;
    bridge.lastPushed = cmp;
    try {
      await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, source: 'browser' }) });
    } catch (e) { /* server offline — retried on the next tick */ }
  }

  // ---------- Local asset loading ----------
  const looksLikePath = (v) => typeof v === 'string' && (/[\\/]/.test(v) || /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(v));
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  const photoId = (p) => `photo_${baseName(p).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 24).toLowerCase()}_${hash(p)}`;

  async function fetchLocal(path) {
    const res = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (e) { /* not JSON */ }
      throw new Error(`could not load "${path}": ${msg}`);
    }
    return res;
  }

  function findBgByPath(a, path) {
    for (const [id, item] of a.bgRenderer.customMedia.entries()) if (item.path === path) return id;
    return null;
  }

  async function importPhoto(path, forcedId) {
    const a = app();
    const existing = findBgByPath(a, path);
    if (existing) return existing;
    const res = await fetchLocal(path);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const id = forcedId || photoId(path);
    const isVideo = (blob.type || '').startsWith('video/') || /\.(mp4|webm|mov)$/i.test(path);
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      await new Promise((resolve, reject) => {
        vid.onloadeddata = resolve;
        vid.onerror = () => reject(new Error(`could not decode video "${path}"`));
      });
      vid.play().catch(() => {});
      a.bgRenderer.registerCustomMedia(id, 'video', vid, baseName(path), url);
      a.bgRenderer.analyzeLighting(id);
    } else {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`could not decode image "${path}"`));
        img.src = url;
      });
      a.bgRenderer.registerCustomMedia(id, 'image', img, baseName(path), url);
    }
    a.bgRenderer.customMedia.get(id).path = path;
    return id;
  }

  function refreshUI(a, opts = {}) {
    a.renderBackgroundButtons();
    if (opts.seek !== undefined) a.seek(opts.seek);
    a.renderTimelineUI();
    a.drawWaveform();
    a.syncInspectorToSelectedScene();
    if (a.updatePhotoInfo) a.updatePhotoInfo();
    if (a.updateBeatInfo) a.updateBeatInfo();
  }

  function resolveBackground(a) {
    return (v) => {
      if (a.bgRenderer.customMedia.has(v)) return v;
      const byPath = findBgByPath(a, v);
      if (byPath) return byPath;
      for (const [id, item] of a.bgRenderer.customMedia.entries()) if (item.name === v) return id;
      return null;
    };
  }

  async function ensureCardMedia(a, card) {
    if (card.imagePath) {
      const id = await importPhoto(card.imagePath);
      card.mediaId = id;
    }
    if (card.mediaId && !a.mediaLibrary.has(card.mediaId)) {
      const item = a.bgRenderer.customMedia.get(card.mediaId);
      if (item && item.type === 'image') a.mediaLibrary.set(card.mediaId, { img: item.el, name: item.name, src: item.url });
    }
  }

  // ---------- RPC handlers ----------
  const H = {};

  H.get_status = async () => {
    const a = app();
    const sc = a.getSceneAtTime(a.currentTime);
    return {
      connected: true,
      clientId: bridge.clientId,
      mode: a.filmMode,
      aspectRatio: P.aspectOut(a.aspect),
      canvas: { width: a.canvas.width, height: a.canvas.height },
      totalDuration: r3(a.totalDuration),
      currentTime: r3(a.currentTime),
      isPlaying: a.isPlaying,
      bpm: a.musicAnalysis ? a.musicAnalysis.bpm : 0,
      beatCount: a.musicAnalysis ? a.musicAnalysis.beats.length : 0,
      audio: { fileName: a.audioFileName, path: a.audioPath || null, isDemo: !!a.audioIsDemo, duration: a.audioBuffer ? r3(a.audioBuffer.duration) : 0 },
      sceneCount: a.scenes.length,
      activeSceneIndex: a.scenes.indexOf(sc),
      backgroundsLoaded: a.bgRenderer.customMedia.size,
      fxMarkerCount: a.fxEvents.length,
      captionMode: a.captionStyle.mode,
      scenes: a.scenes.map((s, i) => ({ index: i, id: s.id, title: s.title, start: r3(s.start), end: r3(s.end), emotion: s.emotion, gesture: s.rig && s.rig.gesture, view: s.rig && s.rig.view, background: s.background, transition: s.transition ? s.transition.type : 'cut' })),
    };
  };

  H.get_project = async () => serializeProject();

  // Full or partial project. Only the top-level keys that are present are applied.
  async function applyProject(p, opts = {}) {
    const a = app();
    a.pause();
    a.ensureAudioContext();
    const warnings = [];
    if (p.mode !== undefined) {
      if (P.IDS.modes.includes(p.mode)) {
        if (p.audio && p.audio.path) a.audioIsDemo = false; // avoid swapping demo tracks right before a real load
        a.setFilmMode(p.mode);
      } else warnings.push(`mode: expected silent|voiceover, got "${p.mode}"`);
    }
    if (p.aspectRatio !== undefined) {
      const asp = P.normAspect(p.aspectRatio);
      if (asp) a.setAspect(asp); else warnings.push(`aspectRatio: expected ${P.IDS.aspectRatios.join(', ')}`);
    }
    if (p.audio && p.audio.path && p.audio.path !== a.audioPath) {
      try {
        await H.load_audio_path({ path: p.audio.path, rescale: false });
      } catch (e) {
        warnings.push(e.message);
      }
    }
    if (Array.isArray(p.backgrounds)) {
      for (const b of p.backgrounds) {
        if (!b || !b.path) continue;
        if (b.bgId && a.bgRenderer.customMedia.has(b.bgId)) continue;
        try { await importPhoto(b.path, b.bgId); } catch (e) { warnings.push(e.message); }
      }
    }
    if (p.captionStyle !== undefined) {
      a.captionStyle = { ...a.captionStyle, ...(typeof p.captionStyle === 'string' ? { mode: p.captionStyle } : p.captionStyle) };
    }
    if (p.fadeOutEnd !== undefined) a.filmFadeOut = p.fadeOutEnd === true ? 2.2 : Math.max(0, Number(p.fadeOutEnd) || 0);
    if (p.masterAmbientVol !== undefined) {
      const v = Number(p.masterAmbientVol);
      if (Number.isFinite(v)) {
        a.ambientMaster = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
        a.ambient.setMasterVolume(a.ambientMaster);
      }
    }
    if (p.snapToBeats !== undefined) a.snapToBeats = !!p.snapToBeats;

    if (Array.isArray(p.scenes)) {
      if (!p.scenes.length) throw new Error('scenes must contain at least one scene');
      for (const s of p.scenes) {
        if (looksLikePath(s.background) && !resolveBackground(a)(s.background)) {
          try { await importPhoto(s.background); } catch (e) { warnings.push(e.message); }
        }
      }
      const total = Number(p.totalDuration) > 0 ? Number(p.totalDuration) : a.totalDuration;
      const snap = (opts.snapToBeats ?? p.snapToBeats ?? true) && a.musicAnalysis;
      const timing = P.layoutScenes(p.scenes.map((s) => ({ ...s })), total, beatTimes(a), snap);
      const existing = new Map(a.scenes.map((s) => [s.id, s]));
      const ctx = { resolveBackground: resolveBackground(a), onCaptionStyle: (st) => { a.captionStyle = { ...a.captionStyle, ...st }; } };
      a.scenes = p.scenes.map((s, i) => {
        const base = s.id && existing.has(s.id) ? JSON.parse(JSON.stringify(existing.get(s.id))) : P.defaultScene(s.id ? { id: s.id } : {});
        const r = P.applySceneUpdate(base, s, ctx);
        r.warnings.forEach((w) => warnings.push(`scene ${i}: ${w}`));
        base.start = timing[i].start;
        base.end = timing[i].end;
        if (!Array.isArray(p.mediaCards) && !base.cards) base.cards = [];
        return base;
      });
      a.totalDuration = Math.max(a.audioBuffer ? a.audioBuffer.duration : 0, a.scenes[a.scenes.length - 1].end, 1);
      a.scenes[a.scenes.length - 1].end = Math.max(a.scenes[a.scenes.length - 1].end, a.totalDuration);
    }
    if (Array.isArray(p.fxMarkers)) {
      a.fxEvents = [];
      p.fxMarkers.forEach((m, i) => {
        const r = P.flatToFx(m);
        if (r.error) warnings.push(`fxMarkers[${i}]: ${r.error}`);
        else a.fxEvents.push(r.ev);
      });
      a.fxEvents.sort((x, y) => x.time - y.time);
    }
    if (Array.isArray(p.mediaCards)) {
      a.scenes.forEach((s) => { s.cards = []; });
      for (const [i, c] of p.mediaCards.entries()) {
        let idx = c.sceneId ? a.scenes.findIndex((s) => s.id === c.sceneId) : Number(c.sceneIndex ?? -1);
        if ((idx < 0 || idx >= a.scenes.length) && Number.isFinite(Number(c.timeSec))) idx = a.sceneIndexAtTime(Number(c.timeSec));
        if (idx < 0 || idx >= a.scenes.length) { warnings.push(`mediaCards[${i}]: needs a valid sceneIndex, sceneId or timeSec`); continue; }
        const card = P.flatToCard(Number.isFinite(Number(c.timeSec)) && c.appear === undefined ? { ...c, appear: Number(c.timeSec) - a.scenes[idx].start } : c);
        try { await ensureCardMedia(a, card); } catch (e) { warnings.push(e.message); }
        a.scenes[idx].cards.push(card);
      }
    }
    a.selectedSceneId = a.scenes[0].id;
    refreshUI(a, { seek: 0 });
    return { warnings, sceneCount: a.scenes.length, totalDuration: r3(a.totalDuration), scenes: a.scenes.map((s, i) => P.internalToFlat(s, i)) };
  }

  H.set_project = async (params) => {
    const project = params.project || params;
    return applyProject(project, { snapToBeats: params.snapToBeats });
  };

  H.update_scene = async (params) => {
    const a = app();
    const ref = params.index ?? params.id;
    const i = P.findScene(a.scenes, ref);
    if (i < 0) throw new Error(`scene "${ref}" not found — there are ${a.scenes.length} scenes (0-based index or id)`);
    const { index, id, updates, ...rest } = params;
    const u = { ...rest, ...(updates || {}) };
    if (looksLikePath(u.background) && !resolveBackground(a)(u.background)) await importPhoto(u.background);
    const sc = a.scenes[i];
    const r = P.applySceneUpdate(sc, u, { resolveBackground: resolveBackground(a), onCaptionStyle: (st) => { a.captionStyle = { ...a.captionStyle, ...st }; } });
    P.retime(a.scenes, i, { start: u.start !== undefined, end: u.end !== undefined });
    if (i === a.scenes.length - 1 && u.end !== undefined) a.totalDuration = Math.max(a.totalDuration, sc.end);
    a.selectedSceneId = sc.id;
    refreshUI(a);
    return { scene: P.internalToFlat(sc, i), warnings: r.warnings };
  };

  H.split_scene = async (params) => {
    const a = app();
    let t = Number(params.timeSec);
    if (!Number.isFinite(t)) throw new Error('timeSec is required');
    let snapped = false;
    if (params.snapToBeat !== false && a.musicAnalysis) {
      const b = window.MusicAnalysis.nearestBeat(a.musicAnalysis, t, 0.35);
      if (b) { t = b.time; snapped = true; }
    }
    a.pause();
    const prevSnap = a.snapToBeats;
    a.snapToBeats = false;
    a.currentTime = t;
    const created = a.splitSceneAtPlayhead();
    a.snapToBeats = prevSnap;
    if (!created) throw new Error(`cannot split at ${t.toFixed(2)}s — the cut must be at least 0.35s inside a scene`);
    refreshUI(a);
    const idx = a.scenes.indexOf(created);
    return { splitAt: r3(t), snappedToBeat: snapped, newScene: P.internalToFlat(created, idx), sceneCount: a.scenes.length };
  };

  H.load_audio_path = async (params) => {
    const a = app();
    const path = params.path;
    if (!path) throw new Error('path is required');
    const res = await fetchLocal(path);
    const buf = await res.arrayBuffer();
    a.ensureAudioContext();
    let decoded;
    try {
      decoded = await a.audioCtx.decodeAudioData(buf);
    } catch (e) {
      throw new Error(`could not decode audio "${path}" (${e.message || 'unsupported format'})`);
    }
    if (params.mode) {
      if (!P.IDS.modes.includes(params.mode)) throw new Error('mode must be silent or voiceover');
      a.audioIsDemo = false;
      a.setFilmMode(params.mode);
    }
    a.setAudioTrack(decoded, `${baseName(path)} (${decoded.duration.toFixed(1)}s)`, false, params.rescale !== false);
    a.audioPath = path;
    const an = a.musicAnalysis || { beats: [], bpm: 0 };
    return {
      fileName: baseName(path),
      path,
      duration: r3(decoded.duration),
      mode: a.filmMode,
      bpm: an.bpm,
      beatCount: an.beats.length,
      beats: an.beats.map((b) => r3(b.time)),
      strongBeats: an.beats.filter((b) => b.strength > 0.6).map((b) => r3(b.time)),
    };
  };

  H.import_photo_paths = async (params) => {
    const a = app();
    const paths = params.paths || params.photoPaths || [];
    if (!Array.isArray(paths) || !paths.length) throw new Error('paths must be a non-empty array of absolute file paths');
    const ids = [];
    const errors = [];
    for (const p of paths) {
      try { ids.push(await importPhoto(p)); } catch (e) { errors.push(e.message); }
    }
    a.renderBackgroundButtons();
    if (a.updatePhotoInfo) a.updatePhotoInfo();
    const all = backgroundList(a);
    const photos = ids.map((id) => all.find((b) => b.bgId === id));
    let scenes;
    if (params.autoBuildScenes && ids.length) {
      a.autoBuildFromPhotos(ids);
      scenes = a.scenes.map((s, i) => P.internalToFlat(s, i));
    }
    return { photos, errors, ...(scenes ? { scenes, totalDuration: r3(a.totalDuration) } : {}) };
  };

  H.apply_template = async (params) => {
    const a = app();
    const id = P.normTemplate(params.template || params.id);
    if (!id) throw new Error(`unknown template "${params.template}" (valid: ${P.IDS.templates.join(', ')})`);
    let photoIds;
    if (Array.isArray(params.photoPaths) && params.photoPaths.length) {
      photoIds = [];
      for (const p of params.photoPaths) photoIds.push(await importPhoto(p));
    }
    const tpl = a.loadTemplate(id, { usePhotos: params.usePhotos !== false, photoIds });
    refreshUI(a);
    return { template: id, name: tpl && tpl.name, totalDuration: r3(a.totalDuration), scenes: a.scenes.map((s, i) => P.internalToFlat(s, i)), fxMarkers: a.fxEvents.map(P.fxToFlat) };
  };

  H.add_fx = async (params) => {
    const a = app();
    const t = Number(params.timeSec);
    if (!Number.isFinite(t)) throw new Error('timeSec is required');
    const isCard = params.kind === 'card' || params.type === 'card' || (params.card && typeof params.card === 'object');
    if (isCard) {
      const idx = a.sceneIndexAtTime(t);
      const sc = a.scenes[idx];
      const c = { ...(params.card || {}), ...(params.kind === 'card' ? params : {}) };
      const card = P.flatToCard({ ...c, appear: t - sc.start });
      await ensureCardMedia(a, card);
      sc.cards = sc.cards || [];
      sc.cards.push(card);
      refreshUI(a);
      return { added: 'card', sceneIndex: idx, card: P.cardToFlat(card, idx, sc.id) };
    }
    const r = P.flatToFx(params);
    if (r.error) throw new Error(r.error);
    a.fxEvents.push(r.ev);
    a.fxEvents.sort((x, y) => x.time - y.time);
    if (a.renderFxTrack) a.renderFxTrack();
    return { added: r.ev.kind, marker: P.fxToFlat(r.ev), fxMarkerCount: a.fxEvents.length };
  };

  // Deterministic frame: re-simulate from the scene start at 30 fps (rig gait/travel, cloth, actions,
  // transitions), then capture the canvas.
  H.render_frame = async (params) => {
    const a = app();
    a.pause();
    const t = Math.max(0, Math.min(a.totalDuration, Number(params.timeSec ?? a.currentTime)));
    const idx = a.sceneIndexAtTime(t);
    const sc = a.scenes[idx];
    const tr = sc.transition || {};
    const lead = tr.type === 'dissolve' ? (tr.duration || 0) : 0;
    const simStart = Math.max(0, Math.min(t, Math.max(sc.start - lead - 0.05, t - 12)));
    const prevGizmos = a.showGizmos;
    a.showGizmos = !!params.gizmos;
    a.seek(simStart);
    const fps = 30;
    const steps = Math.max(2, Math.ceil((t - simStart) * fps));
    const dt = Math.max(1 / 240, (t - simStart) / steps);
    for (let i = 1; i <= steps; i++) {
      a.currentTime = simStart + ((t - simStart) * i) / steps;
      a.renderStage(1000 + a.currentTime, dt);
    }
    const dataUrl = a.canvas.toDataURL('image/png');
    a.showGizmos = prevGizmos;
    a.seek(t);
    const flat = P.internalToFlat(sc, idx);
    return {
      base64Png: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: a.canvas.width,
      height: a.canvas.height,
      timeSec: r3(t),
      sceneAtTime: {
        index: idx, id: flat.id, title: flat.title, start: flat.start, end: flat.end, emotion: flat.emotion,
        gesture: flat.gesture, view: flat.view, background: flat.background, backgroundName: (a.bgRenderer.customMedia.get(sc.background) || {}).name,
        hoodUp: flat.hoodUp, walkSpeed: flat.walkSpeed, transitionType: flat.transitionType, subtitle: flat.subtitle,
      },
    };
  };

  H.export_mp4 = async (params) => {
    const a = app();
    const r = await a.exportFullVideoMp4({ download: params.download === true });
    if (r.error) throw new Error(`export failed: ${r.error}`);
    return r;
  };

  const MUTATING = new Set(['set_project', 'update_scene', 'split_scene', 'load_audio_path', 'import_photo_paths', 'apply_template', 'add_fx']);

  async function handleRpc(msg) {
    const { reqId, action, params } = msg;
    let reply;
    bridge.busy++;
    pill('busy', `🤖 Agent: ${action.replace(/_/g, ' ')}…`);
    try {
      await appReady();
      // Never act on a half-restored project: wait for the startup restore to finish first
      await Promise.race([bridge.helloDone, sleep(120000)]);
      const fn = H[action];
      if (!fn) throw new Error(`unknown action "${action}"`);
      const result = await fn(params || {});
      reply = { reqId, ok: true, result };
    } catch (e) {
      reply = { reqId, ok: false, error: e && e.message ? e.message : String(e) };
    }
    bridge.busy--;
    pill('connected', '🤖 Agent Bridge: Connected');
    try {
      await fetch('/api/bridge/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reply) });
    } catch (e) { /* server went away */ }
    if (reply.ok && MUTATING.has(action)) pushState(true);
  }

  // On page load, restore the project the agent (or a previous session) left on the server.
  // Add ?fresh=1 to the URL to start from the built-in demo instead.
  async function onHello(data) {
    bridge.clientId = data.clientId;
    const st = data.state || {};
    const fresh = new URLSearchParams(location.search).has('fresh');
    const shouldApply = st.project && Array.isArray(st.project.scenes) && st.project.scenes.length && !fresh
      && (!bridge.restoredOnce || (st.source === 'server' && st.updatedAt > bridge.appliedServerStateAt));
    let failed = false;
    if (shouldApply) {
      try {
        await appReady();
        pill('busy', '🤖 Agent Bridge: restoring project…');
        await applyProject(st.project, { snapToBeats: false });
        bridge.appliedServerStateAt = st.updatedAt;
      } catch (e) {
        failed = true;
        console.warn('[bridge] could not restore project:', e);
      }
    }
    bridge.restoredOnce = true;
    // After a failed restore, do not overwrite the server's copy with whatever this tab shows;
    // the next successful agent mutation pushes state again.
    bridge.holdPush = failed;
    pill('connected', failed ? '🤖 Agent Bridge: Connected (restore failed)' : '🤖 Agent Bridge: Connected');
    if (!failed) pushState(true);
  }

  function resetHelloGate() {
    bridge.helloDone = new Promise((resolve) => { bridge.resolveHello = resolve; });
  }
  resetHelloGate();

  function connect() {
    if (bridge.es) try { bridge.es.close(); } catch (e) { /* ignore */ }
    pill('connecting', '🤖 Agent Bridge: Connecting…');
    const es = new EventSource('/api/bridge/events');
    bridge.es = es;
    es.addEventListener('hello', (e) => {
      bridge.connected = true;
      onHello(JSON.parse(e.data)).finally(() => bridge.resolveHello());
    });
    es.addEventListener('rpc', (e) => handleRpc(JSON.parse(e.data)));
    es.onerror = () => {
      if (bridge.connected) resetHelloGate();   // RPCs after a reconnect wait for the new hello
      bridge.connected = false;
      pill('offline', '🤖 Agent Bridge: Reconnecting…');
      if (es.readyState === EventSource.CLOSED) setTimeout(connect, 2000);
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    if (location.protocol === 'file:') {
      pill('offline', '🤖 Agent Bridge: Off (open via node server.js)');
      return;
    }
    connect();
    setInterval(() => { if (bridge.connected && !bridge.busy) pushState(false); }, 4000);
  });
})();
