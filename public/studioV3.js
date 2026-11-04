// studioV3.js — Silent Film Engine UI: Voiceover/Silent mode toggle, aspect ratio, silent-film templates,
// photo batch auto-builder, transitions, Ken Burns, foreground, light match, silent acting, ambience.
(function () {
  const $ = (id) => document.getElementById(id);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

  window.installStudioV3 = function installStudioV3(app) {
    const sel = () => app.getSelectedScene();
    const fill = (id, list, label = (x) => `${x.icon ? x.icon + ' ' : ''}${x.name}`) => {
      const s = $(id);
      list.forEach((x) => s.appendChild(new Option(label(x), x.id)));
      return s;
    };

    // ---------- Topbar ----------
    document.querySelectorAll('[data-film-mode]').forEach((b) => {
      b.addEventListener('click', () => app.setFilmMode(b.dataset.filmMode));
    });
    $('aspectSelect').addEventListener('change', (e) => app.setAspect(e.target.value));
    const tplSel = $('templateSelect');
    window.SILENT_TEMPLATES.forEach((t) => tplSel.appendChild(new Option(`${t.icon} ${t.name}`, t.id)));
    tplSel.addEventListener('change', (e) => {
      if (e.target.value) app.loadTemplate(e.target.value);
      e.target.value = '';
    });

    // ---------- Left panel: builder ----------
    $('btnAutoBuild').addEventListener('click', () => app.autoBuildFromPhotos());
    $('snapBeatsCheck').addEventListener('change', (e) => { app.snapToBeats = e.target.checked; });
    $('filmFadeCheck').addEventListener('change', (e) => { app.filmFadeOut = e.target.checked ? 2.2 : 0; });

    app.customPhotoIds = () => Array.from(app.bgRenderer.customMedia.keys());

    app.updatePhotoInfo = () => {
      const n = app.customPhotoIds().length;
      $('photoInfoLabel').textContent = n
        ? `📷 ${n} photo${n > 1 ? 's' : ''} / clip${n > 1 ? 's' : ''} ready for auto-build & templates.`
        : 'No photos uploaded yet — use 🖼️ Upload Photos (multi-select).';
    };
    app.updateBeatInfo = () => {
      const a = app.musicAnalysis;
      $('beatInfoLabel').textContent = a && a.beats.length
        ? `♪ ${a.beats.length} beats detected${a.bpm ? ` · ~${a.bpm} BPM` : ''} · ${app.totalDuration.toFixed(1)}s track`
        : 'No beats detected in the current track.';
    };

    // ---------- Templates & auto-build ----------
    app.applyStoryboard = (shots, opts = {}) => {
      app.pause();
      const { scenes, fxEvents } = window.layoutSilentTimeline(shots, app.totalDuration, app.musicAnalysis);
      app.scenes = scenes;
      app.fxEvents = fxEvents;
      app.filmFadeOut = opts.fadeOut ?? 2;
      $('filmFadeCheck').checked = app.filmFadeOut > 0;
      app.captionStyle = { ...app.captionStyle, mode: 'cinematic', position: 'bottom' };
      app.selectedSceneId = scenes[0].id;
      app.seek(0);
      app.renderTimelineUI();
      app.drawWaveform();
      app.syncInspectorToSelectedScene();
    };

    // opts: { usePhotos (default: checkbox), photoIds (explicit order) }
    app.loadTemplate = (id, opts = {}) => {
      const tpl = window.SILENT_TEMPLATES.find((t) => t.id === id);
      if (!tpl) return null;
      app.ensureAudioContext();
      app.setFilmMode('silent');
      const shots = tpl.shots();
      const photos = opts.photoIds && opts.photoIds.length ? opts.photoIds : app.customPhotoIds();
      const usePhotos = opts.usePhotos ?? $('templatePhotosCheck').checked;
      if (usePhotos && photos.length) {
        shots.forEach((s, i) => { s.background = photos[i % photos.length]; });
      }
      app.applyStoryboard(shots, { fadeOut: tpl.fadeOut });
      return tpl;
    };

    // ids: optional subset/order of photo background ids (default: every uploaded photo)
    app.autoBuildFromPhotos = (ids) => {
      const photos = Array.isArray(ids) && ids.length ? ids : app.customPhotoIds();
      if (!photos.length) {
        alert('Upload one or more photos first (🖼️ Upload Photos supports multi-select).');
        return;
      }
      const base = sel() || {};
      const recipes = window.AUTO_BUILD_SHOTS;
      const shots = photos.map((id, i) => window.makeSilentScene({
        ...recipes[i % recipes.length],
        background: id,
        atmosphere: 'none',
        ambient: base.ambient || 'none',
        ambientVolume: base.ambientVolume ?? 0.6,
        transition: i === 0 ? { type: 'fade_black', duration: 1.5 } : { type: 'dissolve', duration: 1.2 },
      }));
      app.applyStoryboard(shots, { fadeOut: 2.2 });
    };

    // ---------- Inspector: Silent Film & Cinematic ----------
    fill('transitionTypeSelect', window.TRANSITION_TYPES);
    fill('kenBurnsSelect', window.KEN_BURNS_MODES);
    fill('foregroundSelect', window.FOREGROUND_MODES);
    fill('silentMouthSelect', window.SILENT_MOUTHS);
    fill('ambientSelect', window.AMBIENT_BEDS);

    const sceneTransition = (sc) => {
      if (!sc.transition) sc.transition = { type: 'cut', duration: 1.0 };
      return sc.transition;
    };
    $('transitionTypeSelect').addEventListener('change', (e) => {
      const sc = sel();
      if (!sc) return;
      sceneTransition(sc).type = e.target.value;
      app.renderTimelineUI();
    });
    $('transitionDurSlider').addEventListener('input', (e) => {
      const sc = sel();
      if (!sc) return;
      sceneTransition(sc).duration = parseFloat(e.target.value);
      $('transitionDurVal').textContent = `${parseFloat(e.target.value).toFixed(1)}s`;
    });
    $('kenBurnsSelect').addEventListener('change', (e) => { const sc = sel(); if (sc) sc.kenBurns = e.target.value; });
    $('foregroundSelect').addEventListener('change', (e) => { const sc = sel(); if (sc) sc.foreground = e.target.value; });

    const lightOf = (sc) => {
      if (!sc.light) sc.light = { tint: 0, rim: 0, exposure: 0, side: 'auto' };
      return sc.light;
    };
    [['lightTintSlider', 'lightTintVal', 'tint'], ['lightRimSlider', 'lightRimVal', 'rim'], ['lightExpSlider', 'lightExpVal', 'exposure']]
      .forEach(([sid, vid, key]) => {
        $(sid).addEventListener('input', (e) => {
          const sc = sel();
          if (!sc) return;
          lightOf(sc)[key] = parseFloat(e.target.value) / 100;
          $(vid).textContent = `${e.target.value}%`;
        });
      });
    $('lightSideSelect').addEventListener('change', (e) => { const sc = sel(); if (sc) lightOf(sc).side = e.target.value; });
    $('btnLightAuto').addEventListener('click', () => {
      const sc = sel();
      if (!sc) return;
      const L = app.bgRenderer.getLighting(sc.background, 0);
      // Darker photos need more exposure match; strongly lit photos get a stronger rim
      sc.light = window.defaultLightSettings({
        tint: 0.35,
        rim: Math.round(Math.min(0.9, 0.4 + L.keyLum * 0.45) * 100) / 100,
        exposure: L.lum < 0.3 ? 0.6 : 0.4,
        side: 'auto',
      });
      app.syncV2Inspector();
    });

    $('silentMouthSelect').addEventListener('change', (e) => { const sc = sel(); if (sc) sc.silentMouth = e.target.value; });
    $('hoodUpCheck').addEventListener('change', (e) => {
      const sc = sel();
      if (!sc) return;
      if (!sc.rig) sc.rig = window.defaultRigSettings();
      sc.rig.hood = e.target.checked;
    });
    $('windSlider').addEventListener('input', (e) => {
      const sc = sel();
      if (!sc || !sc.rig) return;
      sc.rig.wind = parseFloat(e.target.value) / 100;
      $('windVal').textContent = `${e.target.value}%`;
    });
    $('foleyCheck').addEventListener('change', (e) => {
      const sc = sel();
      if (!sc || !sc.rig) return;
      sc.rig.foley = e.target.checked;
    });

    $('ambientSelect').addEventListener('change', (e) => {
      const sc = sel();
      if (!sc) return;
      sc.ambient = e.target.value;
      app.ensureAudioContext();
    });
    $('ambientVolSlider').addEventListener('input', (e) => {
      const sc = sel();
      if (!sc) return;
      sc.ambientVolume = parseFloat(e.target.value) / 100;
      $('ambientVolVal').textContent = `${e.target.value}%`;
    });
    $('ambientMasterSlider').addEventListener('input', (e) => {
      app.ambientMaster = parseFloat(e.target.value) / 100;
      app.ambient.setMasterVolume(app.ambientMaster);
      $('ambientMasterVal').textContent = `${e.target.value}%`;
    });
    $('ambientPreviewCheck').addEventListener('change', (e) => {
      app.ensureAudioContext();
      app.ambientPreview = e.target.checked;
    });
    $('musicReactSlider').addEventListener('input', (e) => {
      app.musicReactivity = parseFloat(e.target.value) / 100;
      $('musicReactVal').textContent = `${e.target.value}%`;
    });

    // Silent-acting presets suggest a view that reads best (e.g. horizon gaze → back view)
    document.querySelectorAll('.gesture-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = window.GESTURE_PRESETS.find((g) => g.id === b.dataset.gesture);
        const sc = sel();
        if (!preset || !sc || !sc.rig) return;
        if (preset.preferView && sc.rig.view === 'front') {
          sc.rig.view = preset.preferView;
          app.syncV2Inspector();
        }
      });
    });

    // ---------- Sync ----------
    const syncV3 = () => {
      const sc = sel();
      if (!sc) return;
      const tr = sc.transition || { type: 'cut', duration: 1 };
      $('transitionTypeSelect').value = tr.type;
      $('transitionDurSlider').value = tr.duration ?? 1;
      $('transitionDurVal').textContent = `${(tr.duration ?? 1).toFixed(1)}s`;
      $('kenBurnsSelect').value = sc.kenBurns || 'none';
      $('foregroundSelect').value = sc.foreground || 'none';
      const L = sc.light || { tint: 0, rim: 0, exposure: 0, side: 'auto' };
      $('lightTintSlider').value = Math.round((L.tint || 0) * 100);
      $('lightTintVal').textContent = pct(L.tint || 0);
      $('lightRimSlider').value = Math.round((L.rim || 0) * 100);
      $('lightRimVal').textContent = pct(L.rim || 0);
      $('lightExpSlider').value = Math.round((L.exposure || 0) * 100);
      $('lightExpVal').textContent = pct(L.exposure || 0);
      $('lightSideSelect').value = L.side || 'auto';
      const lit = app.bgRenderer.getLighting(sc.background, 0);
      $('lightSwatches').innerHTML = lit
        ? `Sky <span class="sw" style="background:${rgb(lit.top)}"></span> Ground <span class="sw" style="background:${rgb(lit.bottom)}"></span> Key <span class="sw" style="background:${rgb(lit.key)}"></span> ${lit.lightX < -0.15 ? '◀ light' : lit.lightX > 0.15 ? 'light ▶' : 'even light'}`
        : '';
      $('silentMouthSelect').value = sc.silentMouth || 'closed';
      const r = sc.rig || {};
      $('hoodUpCheck').checked = window.RigCharacter.hoodFor(r) > 0.5;
      $('windSlider').value = Math.round((r.wind || 0) * 100);
      $('windVal').textContent = pct(r.wind || 0);
      $('foleyCheck').checked = r.foley ?? (app.filmMode === 'silent');
      $('ambientSelect').value = sc.ambient || 'none';
      $('ambientVolSlider').value = Math.round((sc.ambientVolume ?? 0.6) * 100);
      $('ambientVolVal').textContent = pct(sc.ambientVolume ?? 0.6);
      $('snapBeatsCheck').checked = app.snapToBeats;
      $('filmFadeCheck').checked = app.filmFadeOut > 0;
      app.updateBeatInfo();
      app.updatePhotoInfo();
    };
    const prevSync = app.syncV2Inspector;
    app.syncV2Inspector = () => {
      if (prevSync) prevSync();
      syncV3();
    };
    syncV3();
  };
})();
