// studioV2.js — Studio UI controls for v2: rig view/gesture/hand/prop pickers, FK sliders, IK gizmo toggle,
// walk/run speed + direction, camera punch & SFX triggers, PiP media cards, animated captions,
// FX timeline track (drag to retime) and JSON project save/load.
(function () {
  const $ = (id) => document.getElementById(id);
  const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  window.installStudioV2 = function installStudioV2(app) {
    const sel = () => app.getSelectedScene();
    const rigOf = () => {
      const sc = sel();
      if (!sc) return null;
      if (!sc.rig) sc.rig = window.defaultRigSettings();
      return sc.rig;
    };
    const refresh = () => {
      app.syncV2Inspector();
      app.renderTimelineUI();
    };
    let pendingCardImage = null;

    // ---------- Build pickers ----------
    const viewRow = $('rigViewRow');
    window.RIG_VIEWS.forEach((v) => {
      const b = el('button', 'chip', v.name);
      b.dataset.view = v.id;
      b.addEventListener('click', () => {
        const r = rigOf();
        if (!r) return;
        r.view = v.id;
        refresh();
      });
      viewRow.appendChild(b);
    });

    const gestureGrid = $('gestureGrid');
    window.GESTURE_PRESETS.forEach((g) => {
      const b = el('button', 'gesture-btn', `<span>${g.icon}</span><span>${g.name}</span>`);
      b.dataset.gesture = g.id;
      b.title = g.name;
      b.addEventListener('click', () => {
        const r = rigOf();
        if (!r) return;
        r.gesture = g.id;
        refresh();
      });
      gestureGrid.appendChild(b);
    });

    [['handFrontSelect', 'handFront'], ['handBackSelect', 'handBack']].forEach(([id, key]) => {
      const s = $(id);
      s.appendChild(new Option('Auto (from gesture)', 'auto'));
      window.HAND_STATES.forEach((h) => s.appendChild(new Option(h.name, h.id)));
      s.addEventListener('change', () => {
        const r = rigOf();
        if (r) r[key] = s.value;
      });
    });

    const propGrid = $('propGrid');
    window.PROP_LIST.forEach((p) => {
      const b = el('button', 'prop-btn', `<span>${p.icon}</span><span>${p.name.split(' ')[0]}</span>`);
      b.dataset.prop = p.id;
      b.title = p.name;
      b.addEventListener('click', () => {
        const r = rigOf();
        if (!r) return;
        r.prop = p.id;
        refresh();
      });
      propGrid.appendChild(b);
    });

    // FK sliders
    [['rigLeanSlider', 'rigLeanVal', 'lean'], ['rigTiltSlider', 'rigTiltVal', 'headTilt'], ['rigNodSlider', 'rigNodVal', 'headNod']]
      .forEach(([sid, vid, key]) => {
        $(sid).addEventListener('input', (e) => {
          const r = rigOf();
          if (!r) return;
          r[key] = parseFloat(e.target.value);
          $(vid).textContent = `${r[key]}°`;
        });
      });
    $('btnResetPose').addEventListener('click', () => {
      const r = rigOf();
      if (!r) return;
      r.lean = 0;
      r.headTilt = 0;
      r.headNod = 0;
      r.ik = {};
      app.syncV2Inspector();
    });

    // IK
    $('ikGizmoCheck').addEventListener('change', (e) => { app.showGizmos = e.target.checked; });
    $('btnClearIk').addEventListener('click', () => {
      const r = rigOf();
      if (!r) return;
      r.ik = {};
      app.syncV2Inspector();
    });
    $('btnSwitchToRig').addEventListener('click', () => {
      const sc = sel();
      if (!sc) return;
      sc.pose = 'rig';
      if (!sc.rig) sc.rig = window.defaultRigSettings();
      if (sc.y > 0.6) sc.y = 0.55;
      app.syncInspectorToSelectedScene();
      app.renderTimelineUI();
    });

    // Locomotion
    const speedLabel = (v) => {
      if (v <= 0.02) return ['IDLE', ''];
      if (v <= 1.0) return ['WALK', 'walk'];
      if (v <= 1.6) return ['JOG', 'run'];
      return ['RUN', 'run'];
    };
    const updateSpeedUI = (v) => {
      $('rigSpeedVal').textContent = `${v.toFixed(2)}x`;
      const [label, cls] = speedLabel(v);
      const badge = $('speedBadge');
      badge.textContent = label;
      badge.className = `speed-badge ${cls}`;
    };
    $('rigSpeedSlider').addEventListener('input', (e) => {
      const r = rigOf();
      if (!r) return;
      r.speed = parseFloat(e.target.value);
      updateSpeedUI(r.speed);
    });
    $('rigSpeedSlider').addEventListener('change', () => app.renderTimelineUI());
    document.querySelectorAll('[data-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = rigOf();
        if (!r) return;
        r.direction = b.dataset.dir;
        app.syncV2Inspector();
      });
    });
    $('rigTravelSelect').addEventListener('change', (e) => {
      const r = rigOf();
      if (!r) return;
      r.travel = e.target.value;
      app.resetTravel = true;
    });
    $('btnJump').addEventListener('click', () => app.rig.loco.triggerJump());
    $('clothCheck').addEventListener('change', (e) => {
      const r = rigOf();
      if (r) r.cloth = e.target.checked;
    });

    // ---------- Camera FX & SFX ----------
    app.addFxEvent = (kind, type, extra = {}) => {
      const ev = { id: uid('fx'), kind, type, time: Number(app.currentTime.toFixed(2)), ...extra };
      if (kind === 'camera') {
        const def = window.CAMERA_FX_TYPES.find((c) => c.id === type);
        ev.duration = def ? def.duration : 1;
        ev.intensity = 1;
        if (type === 'dutch') ev.dir = Math.random() < 0.5 ? -1 : 1;
      }
      app.fxEvents.push(ev);
      app.fxEvents.sort((a, b) => a.time - b.time);
      app.renderFxTrack();
      if (kind === 'sfx') app.sfx.play(type);
      return ev;
    };

    const camGrid = $('cameraFxGrid');
    window.CAMERA_FX_TYPES.forEach((c) => {
      const b = el('button', 'fx-btn', `<span>${c.icon}</span><span>${c.name}</span>`);
      b.title = `${c.hint} — adds at the playhead`;
      b.addEventListener('click', () => {
        app.addFxEvent('camera', c.id);
        if (c.id === 'shake' && !$('sfxPreviewOnly').checked) app.sfx.play('boom', { volume: 0.6 });
      });
      camGrid.appendChild(b);
    });
    $('sceneDutchCheck').addEventListener('change', (e) => { const sc = sel(); if (sc) sc.fxDutch = e.target.checked; });
    $('sceneSpotCheck').addEventListener('change', (e) => { const sc = sel(); if (sc) sc.fxSpotlight = e.target.checked; });

    const sfxGrid = $('sfxGrid');
    window.SFX_LIST.forEach((x) => {
      const b = el('button', 'fx-btn', `<span>${x.icon}</span><span>${x.name}</span>`);
      b.title = 'Click: add at playhead (+ preview). Shift-click: preview only.';
      b.addEventListener('click', (e) => {
        app.ensureAudioContext();
        if (e.shiftKey || $('sfxPreviewOnly').checked) app.sfx.play(x.id);
        else app.addFxEvent('sfx', x.id);
      });
      sfxGrid.appendChild(b);
    });
    const trSel = $('sceneTransitionSfx');
    trSel.appendChild(new Option('None', 'none'));
    window.SFX_LIST.forEach((x) => trSel.appendChild(new Option(`${x.icon} ${x.name}`, x.id)));
    trSel.addEventListener('change', (e) => {
      const sc = sel();
      if (!sc) return;
      sc.transitionSfx = e.target.value;
      app.renderFxTrack();
      if (e.target.value !== 'none') { app.ensureAudioContext(); app.sfx.play(e.target.value); }
    });
    $('sfxVolumeSlider').addEventListener('input', (e) => { app.ensureAudioContext(); app.sfx.setVolume(parseFloat(e.target.value)); });

    // ---------- Media cards ----------
    const kindSel = $('cardKindSelect');
    window.CARD_KINDS.forEach((k) => kindSel.appendChild(new Option(k.name, k.id)));
    const cardInput = $('cardImageInput');
    $('btnCardImage').addEventListener('click', () => cardInput.click());
    cardInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const id = uid('media');
          app.mediaLibrary.set(id, { img, name: file.name, src: reader.result });
          pendingCardImage = id;
          $('cardImageLabel').textContent = file.name;
          if (kindSel.value === 'note' || kindSel.value === 'post') {
            if (kindSel.value === 'note') kindSel.value = 'image';
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
      cardInput.value = '';
    });
    $('btnAddCard').addEventListener('click', () => {
      const sc = sel();
      if (!sc) return;
      sc.cards = sc.cards || [];
      const appear = Math.max(0, parseFloat($('cardAppearInput').value) || 0);
      sc.cards.push({
        id: uid('card'),
        kind: kindSel.value,
        text: $('cardTextInput').value.trim(),
        mediaId: pendingCardImage,
        side: $('cardSideSelect').value,
        appear: Math.min(appear, Math.max(0, sc.end - sc.start - 0.2)),
        hold: Math.max(0, parseFloat($('cardHoldInput').value) || 0),
        size: kindSel.value === 'note' ? 0.3 : 0.34,
      });
      app.ensureAudioContext();
      app.sfx.play('pop');
      // Park the playhead just after the pop-in so the new card is visible while paused
      app.seek(Math.min(sc.end - 0.05, sc.start + appear + 0.6));
      refresh();
    });

    function renderCardList() {
      const sc = sel();
      const list = $('cardList');
      list.innerHTML = '';
      (sc?.cards || []).forEach((card) => {
        const kind = window.CARD_KINDS.find((k) => k.id === card.kind);
        const media = card.mediaId ? app.mediaLibrary.get(card.mediaId) : null;
        const row = el('div', 'card-item');
        row.innerHTML = `<span>${kind ? kind.name.split(' ')[0] : card.kind} @ ${(card.appear || 0).toFixed(1)}s — ${card.text || (media ? media.name : '(no text)')}</span>`;
        const del = el('button', 'btn btn-sm btn-danger', '✕');
        del.addEventListener('click', () => {
          sc.cards = sc.cards.filter((c) => c.id !== card.id);
          refresh();
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }

    // ---------- Captions ----------
    const capMode = $('captionModeSelect');
    window.CAPTION_MODES.forEach((m) => capMode.appendChild(new Option(m.name, m.id)));
    capMode.addEventListener('change', (e) => { app.captionStyle.mode = e.target.value; });
    $('captionColorInput').addEventListener('input', (e) => { app.captionStyle.highlight = e.target.value; });
    $('captionPosSelect').addEventListener('change', (e) => { app.captionStyle.position = e.target.value; });
    $('captionChunkSlider').addEventListener('input', (e) => {
      app.captionStyle.chunk = parseInt(e.target.value, 10);
      $('captionChunkVal').textContent = e.target.value;
    });
    $('captionSizeSlider').addEventListener('input', (e) => {
      app.captionStyle.size = parseInt(e.target.value, 10);
      $('captionSizeVal').textContent = e.target.value;
    });
    $('captionUpperCheck').addEventListener('change', (e) => { app.captionStyle.uppercase = e.target.checked; });
    $('captionBounceCheck').addEventListener('change', (e) => { app.captionStyle.bounce = e.target.checked; });

    // ---------- Inspector sync ----------
    app.syncV2Inspector = () => {
      const sc = sel();
      if (!sc) return;
      const isRig = sc.pose === 'rig';
      $('rigDisabledHint').style.display = isRig ? 'none' : 'flex';
      $('rigControls').style.display = isRig ? 'block' : 'none';
      const r = sc.rig || window.defaultRigSettings();

      document.querySelectorAll('#rigViewRow .chip').forEach((b) => b.classList.toggle('active', b.dataset.view === r.view));
      document.querySelectorAll('.gesture-btn').forEach((b) => b.classList.toggle('active', b.dataset.gesture === r.gesture));
      document.querySelectorAll('.prop-btn').forEach((b) => b.classList.toggle('active', b.dataset.prop === (r.prop || 'none')));
      document.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('active', b.dataset.dir === r.direction));
      $('handFrontSelect').value = r.handFront || 'auto';
      $('handBackSelect').value = r.handBack || 'auto';
      $('rigLeanSlider').value = r.lean || 0;
      $('rigLeanVal').textContent = `${r.lean || 0}°`;
      $('rigTiltSlider').value = r.headTilt || 0;
      $('rigTiltVal').textContent = `${r.headTilt || 0}°`;
      $('rigNodSlider').value = r.headNod || 0;
      $('rigNodVal').textContent = `${r.headNod || 0}°`;
      $('rigSpeedSlider').value = r.speed || 0;
      updateSpeedUI(r.speed || 0);
      $('rigTravelSelect').value = r.travel || 'in_place';
      $('clothCheck').checked = r.cloth !== false;
      $('ikGizmoCheck').checked = app.showGizmos;
      const pins = Object.keys(r.ik || {});
      $('ikPinsLabel').textContent = pins.length ? `📌 Pinned: ${pins.join(', ')}` : 'No IK pins on this scene';

      $('sceneDutchCheck').checked = !!sc.fxDutch;
      $('sceneSpotCheck').checked = !!sc.fxSpotlight;
      $('sceneTransitionSfx').value = sc.transitionSfx || 'none';

      capMode.value = app.captionStyle.mode;
      $('captionColorInput').value = app.captionStyle.highlight;
      $('captionPosSelect').value = app.captionStyle.position;
      $('captionChunkSlider').value = app.captionStyle.chunk;
      $('captionChunkVal').textContent = app.captionStyle.chunk;
      $('captionSizeSlider').value = app.captionStyle.size;
      $('captionSizeVal').textContent = app.captionStyle.size;
      $('captionUpperCheck').checked = !!app.captionStyle.uppercase;
      $('captionBounceCheck').checked = app.captionStyle.bounce !== false;
      renderCardList();
    };

    // ---------- FX timeline track ----------
    app.renderFxTrack = () => {
      const track = $('fxTrack');
      if (!track) return;
      track.innerHTML = '';
      const total = app.totalDuration;
      const pct = (t) => `${Math.max(0, Math.min(100, (t / total) * 100))}%`;

      // Read-only markers: scene transitions & card pops
      app.scenes.forEach((sc) => {
        if (sc.transitionSfx && sc.transitionSfx !== 'none') {
          const x = window.SFX_LIST.find((s) => s.id === sc.transitionSfx);
          const m = el('div', 'fx-marker transition', `${x ? x.icon : '🔊'}`);
          m.style.left = pct(sc.start);
          m.title = `Scene transition SFX: ${x ? x.name : sc.transitionSfx} (edit in inspector)`;
          track.appendChild(m);
        }
        (sc.cards || []).forEach((card) => {
          const m = el('div', 'fx-marker card', '🖼️');
          m.style.left = pct(sc.start + (card.appear || 0));
          m.title = `Media card: ${card.kind} ${card.text ? '— ' + card.text : ''}`;
          track.appendChild(m);
        });
      });

      app.fxEvents.forEach((ev) => {
        const isCam = ev.kind === 'camera';
        const def = isCam ? window.CAMERA_FX_TYPES.find((c) => c.id === ev.type) : window.SFX_LIST.find((s) => s.id === ev.type);
        const m = el('div', `fx-marker ${isCam ? 'camera' : 'sfx'}`, `${def ? def.icon : '•'}${isCam ? ` ${def ? def.name : ev.type}` : ''}`);
        m.style.left = pct(ev.time);
        if (isCam) m.style.width = `${Math.max(1.2, (ev.duration / total) * 100)}%`;
        m.title = `${def ? def.name : ev.type} @ ${ev.time.toFixed(2)}s — drag to retime, double-click or right-click to delete`;
        m.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const rect = track.getBoundingClientRect();
          app.draggingFx = { ev, el: m, rect, grabOffset: (e.clientX - rect.left) / rect.width * total - ev.time, moved: false };
        });
        const remove = (e) => {
          e.preventDefault();
          e.stopPropagation();
          app.fxEvents = app.fxEvents.filter((x) => x.id !== ev.id);
          app.renderFxTrack();
        };
        m.addEventListener('dblclick', remove);
        m.addEventListener('contextmenu', remove);
        track.appendChild(m);
      });
    };

    window.addEventListener('mousemove', (e) => {
      const d = app.draggingFx;
      if (!d) return;
      const t = ((e.clientX - d.rect.left) / d.rect.width) * app.totalDuration - d.grabOffset;
      d.ev.time = Number(Math.max(0, Math.min(app.totalDuration - 0.05, t)).toFixed(2));
      d.el.style.left = `${(d.ev.time / app.totalDuration) * 100}%`;
      d.moved = true;
    });
    window.addEventListener('mouseup', () => {
      const d = app.draggingFx;
      if (!d) return;
      app.draggingFx = null;
      if (!d.moved) app.seek(d.ev.time);
      app.fxEvents.sort((a, b) => a.time - b.time);
      app.renderFxTrack();
    });
    $('fxTrack').addEventListener('mousedown', (e) => {
      if (e.target.id !== 'fxTrack') return;
      const rect = e.currentTarget.getBoundingClientRect();
      app.seek(((e.clientX - rect.left) / rect.width) * app.totalDuration);
    });

    // ---------- Project save / load ----------
    $('btnSaveProject').addEventListener('click', () => {
      const usedMedia = new Set();
      app.scenes.forEach((sc) => (sc.cards || []).forEach((c) => c.mediaId && usedMedia.add(c.mediaId)));
      const media = {};
      usedMedia.forEach((id) => {
        const m = app.mediaLibrary.get(id);
        if (m) media[id] = { name: m.name, src: m.src };
      });
      const project = {
        format: 'sticky-studio-project',
        version: 2,
        totalDuration: app.totalDuration,
        scenes: app.scenes,
        fxEvents: app.fxEvents,
        captionStyle: app.captionStyle,
        media,
      };
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sticky_project_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    const projInput = $('projectFileInput');
    $('btnLoadProject').addEventListener('click', () => projInput.click());
    projInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.scenes) || !data.scenes.length) throw new Error('No scenes in file');
        app.pause();
        await Promise.all(Object.entries(data.media || {}).map(([id, m]) => new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { app.mediaLibrary.set(id, { img, name: m.name, src: m.src }); resolve(); };
          img.onerror = resolve;
          img.src = m.src;
        })));
        data.scenes.forEach((sc) => {
          if (sc.pose === 'rig' && !sc.rig) sc.rig = window.defaultRigSettings();
          if (sc.rig) sc.rig = window.defaultRigSettings(sc.rig);
          sc.cards = sc.cards || [];
        });
        app.scenes = data.scenes;
        app.fxEvents = Array.isArray(data.fxEvents) ? data.fxEvents : [];
        app.captionStyle = { ...window.defaultCaptionStyle(), ...(data.captionStyle || {}) };
        const lastEnd = app.scenes[app.scenes.length - 1].end;
        app.totalDuration = Math.max(data.totalDuration || 0, lastEnd, app.audioBuffer ? app.audioBuffer.duration : 0);
        app.selectedSceneId = app.scenes[0].id;
        app.seek(0);
        app.renderTimelineUI();
        app.drawWaveform();
        app.syncInspectorToSelectedScene();
      } catch (err) {
        alert(`Could not load project: ${err.message}`);
      }
      projInput.value = '';
    });
  };
})();
