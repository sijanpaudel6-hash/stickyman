// templates.js — 1-click "Viral Silent Film" storyboards + the photo auto-builder's scene factory.
// Each template is a list of shots with relative weights; the builder stretches them over the music
// length and snaps every cut to the nearest detected beat.
(function () {
  let seq = 0;
  const uid = () => `sc_${Date.now().toString(36)}_${seq++}`;

  // Shared scene factory for silent-film shots
  window.makeSilentScene = function makeSilentScene(o = {}) {
    const rig = window.defaultRigSettings({ view: 'front', gesture: 'pocket', ...(o.rig || {}) });
    return {
      id: uid(),
      title: o.title || 'Shot',
      start: 0,
      end: 1,
      emotion: o.emotion || 'tired',
      pose: 'rig',
      motion: o.motion || 'breathe',
      background: o.background || 'streetlight',
      camera: o.camera || 'static',
      atmosphere: o.atmosphere || 'dust',
      x: o.x ?? 0.5,
      y: o.y ?? 0.56,
      scale: o.scale ?? 1,
      flipX: false,
      subtitle: o.subtitle || '',
      rig,
      cards: o.cards || [],
      transitionSfx: 'none',
      transition: { type: 'dissolve', duration: 1.2, ...(o.transition || {}) },
      kenBurns: o.kenBurns || 'push_in',
      foreground: o.foreground || 'none',
      light: window.defaultLightSettings(o.light || {}),
      ambient: o.ambient || 'none',
      ambientVolume: o.ambientVolume ?? 0.6,
      silentMouth: o.silentMouth || 'closed',
      fxDutch: !!o.fxDutch,
      fxSpotlight: !!o.fxSpotlight,
      weight: o.weight ?? 1,
      fx: o.fx || [],          // [{ kind, type, at (seconds into shot), duration? }]
    };
  };

  /**
   * Lay shots over [0, total], snapping cuts to beats. Returns { scenes, fxEvents }.
   */
  window.layoutSilentTimeline = function layoutSilentTimeline(shots, total, analysis) {
    const sum = shots.reduce((a, s) => a + (s.weight || 1), 0) || 1;
    let acc = 0;
    const cuts = [0];
    shots.forEach((s, i) => {
      acc += s.weight || 1;
      if (i < shots.length - 1) {
        let t = (acc / sum) * total;
        const b = window.MusicAnalysis && window.MusicAnalysis.nearestBeat(analysis, t, Math.min(0.7, total / shots.length / 4));
        if (b) t = b.time;
        cuts.push(Number(t.toFixed(2)));
      }
    });
    cuts.push(Number(total.toFixed(2)));
    const fxEvents = [];
    shots.forEach((s, i) => {
      s.start = cuts[i];
      s.end = cuts[i + 1];
      (s.fx || []).forEach((f, k) => {
        const time = Math.min(s.end - 0.05, s.start + (f.at || 0));
        fxEvents.push({ id: `fx_${s.id}_${k}`, kind: f.kind, type: f.type, time: Number(time.toFixed(2)), duration: f.duration, intensity: f.intensity ?? 1, dir: f.dir });
      });
      delete s.fx;
      delete s.weight;
    });
    fxEvents.sort((a, b) => a.time - b.time);
    return { scenes: shots, fxEvents };
  };

  const S = window.makeSilentScene;

  window.SILENT_TEMPLATES = [
    {
      id: 'loneliness_3am',
      name: '3 AM Loneliness',
      icon: '🌙',
      fadeOut: 2.2,
      shots: () => [
        S({ title: 'The Glow', background: 'cozy_night', emotion: 'tired', rig: { gesture: 'check_phone_dark', view: 'front' },
          ambient: 'clock_ticking', ambientVolume: 0.55, kenBurns: 'push_in', transition: { type: 'fade_black', duration: 1.6 },
          subtitle: '3:07 AM.', light: { rim: 0.65 }, fx: [{ kind: 'sfx', type: 'phone_vibrate', at: 0.9 }] }),
        S({ title: 'Rain Walk', background: 'rainy_window', atmosphere: 'rain', emotion: 'tired', x: 0.22,
          rig: { gesture: 'pocket', view: 'three_quarter', hood: true, speed: 0.55, travel: 'translate' },
          ambient: 'rain_window', ambientVolume: 0.75, foreground: 'rain_streaks', kenBurns: 'drift_right',
          transition: { type: 'dissolve', duration: 1.4 }, subtitle: 'Walking just to feel something.' }),
        S({ title: 'The Curb', background: 'streetlight', emotion: 'crying', silentMouth: 'quiver',
          rig: { gesture: 'sit_curb_hug_knees', view: 'three_quarter', hood: true }, ambient: 'rain_window', ambientVolume: 0.45,
          foreground: 'bokeh', kenBurns: 'push_in', transition: { type: 'dissolve', duration: 1.2 }, light: { rim: 0.8 },
          subtitle: "Nobody's coming. And that's okay." }),
        S({ title: 'Dawn', background: 'rooftop_dusk', emotion: 'neutral', rig: { gesture: 'look_back_horizon', view: 'back', hood: false, wind: 0.6 },
          ambient: 'night_wind', ambientVolume: 0.5, kenBurns: 'pull_out', transition: { type: 'fade_white', duration: 1.6 },
          subtitle: 'But the sun still came up.', light: { rim: 0.75, side: 'back' } }),
      ],
    },
    {
      id: 'social_anxiety',
      name: 'Social Anxiety (Invisible in the Crowd)',
      icon: '👥',
      fadeOut: 2.0,
      shots: () => [
        S({ title: 'The Corner', background: 'dark_spotlight', emotion: 'tired', rig: { gesture: 'slouch_lonely', view: 'three_quarter', hood: true },
          ambient: 'crowd_muffle', ambientVolume: 0.85, fxSpotlight: true, kenBurns: 'breathing', foreground: 'bokeh',
          transition: { type: 'fade_black', duration: 1.2 }, subtitle: 'Everyone is talking. Nobody sees me.' }),
        S({ title: 'Too Loud', background: 'dark_spotlight', emotion: 'shocked', silentMouth: 'quiver', motion: 'shake',
          rig: { gesture: 'hands_head', view: 'front', hood: true }, ambient: 'heartbeat', ambientVolume: 0.95, fxDutch: true,
          kenBurns: 'push_in', transition: { type: 'cut', duration: 0 }, subtitle: 'Too loud. Too close.',
          fx: [{ kind: 'camera', type: 'shake', at: 0.2, duration: 0.8 }, { kind: 'camera', type: 'snap_zoom', at: 0.2, duration: 1.6 }] }),
        S({ title: 'Outside', background: 'streetlight', emotion: 'tired', x: 0.25,
          rig: { gesture: 'pocket', view: 'three_quarter', hood: false, speed: 0.5, travel: 'translate' }, ambient: 'night_wind', ambientVolume: 0.6,
          kenBurns: 'drift_right', transition: { type: 'fade_black', duration: 1.6 }, subtitle: 'The door closes. The noise stops.',
          fx: [{ kind: 'sfx', type: 'door_close_echo', at: 0.1 }] }),
        S({ title: 'Relief', background: 'rooftop_dusk', emotion: 'neutral', silentMouth: 'sigh',
          rig: { gesture: 'heavy_sigh', view: 'three_quarter', hood: false, wind: 0.3, foley: true }, ambient: 'night_wind', ambientVolume: 0.5,
          kenBurns: 'pull_out', transition: { type: 'dissolve', duration: 1.5 }, subtitle: 'Breathe.' }),
      ],
    },
    {
      id: 'burnout',
      name: 'Emptiness / Burnout',
      icon: '🕯️',
      fadeOut: 2.4,
      shots: () => [
        S({ title: 'The Grind', background: 'classroom', emotion: 'tired', rig: { gesture: 'typing', view: 'side' }, weight: 1.1,
          ambient: 'clock_ticking', ambientVolume: 0.5, kenBurns: 'drift_left', transition: { type: 'fade_black', duration: 1.0 },
          subtitle: 'Day 214.', fx: [{ kind: 'sfx', type: 'typing', at: 0.6 }, { kind: 'sfx', type: 'typing', at: 2.2 }] }),
        S({ title: 'Empty Stare', background: 'cozy_night', emotion: 'deadpan', rig: { gesture: 'slouch_lonely', view: 'front' },
          ambient: 'clock_ticking', ambientVolume: 0.75, kenBurns: 'push_in', transition: { type: 'dissolve', duration: 1.2 },
          subtitle: 'When did I stop feeling anything?' }),
        S({ title: 'Rain', background: 'rainy_window', atmosphere: 'rain', emotion: 'tired', weight: 1.2, x: 0.2,
          rig: { gesture: 'pocket', view: 'side', hood: true, speed: 0.45, travel: 'translate' }, ambient: 'rain_window', ambientVolume: 0.75,
          foreground: 'rain_streaks', kenBurns: 'drift_right', transition: { type: 'fade_black', duration: 2.0 },
          subtitle: 'Just keep walking.' }),
      ],
    },
    {
      id: 'quiet_discipline',
      name: 'Quiet Discipline (Nobody Watching)',
      icon: '🌄',
      fadeOut: 2.5,
      shots: () => [
        S({ title: 'Wake Up', background: 'cozy_night', emotion: 'tired', silentMouth: 'sigh', rig: { gesture: 'sit_curb_hug_knees', view: 'three_quarter' },
          ambient: 'clock_ticking', ambientVolume: 0.5, kenBurns: 'push_in', transition: { type: 'fade_black', duration: 1.4 },
          subtitle: "5:00 AM. Nobody's watching." }),
        S({ title: 'Hood Up', background: 'streetlight', emotion: 'neutral', rig: { gesture: 'pull_hood_up', view: 'front' }, weight: 0.8,
          ambient: 'night_wind', ambientVolume: 0.5, kenBurns: 'breathing', transition: { type: 'dissolve', duration: 1.0 },
          subtitle: 'Do it anyway.' }),
        S({ title: 'Slow Jog', background: 'streetlight', emotion: 'neutral', rig: { gesture: 'pocket', view: 'side', hood: true, speed: 1.2 },
          ambient: 'night_wind', ambientVolume: 0.4, kenBurns: 'drift_left', transition: { type: 'dissolve', duration: 1.0 } }),
        S({ title: 'Sprint into Sunrise', background: 'rooftop_dusk', emotion: 'happy', camera: 'zoom_in', weight: 1.3,
          rig: { gesture: 'pocket', view: 'side', hood: true, speed: 2.0, wind: 0.4 }, ambient: 'night_wind', ambientVolume: 0.35,
          kenBurns: 'push_in', transition: { type: 'fade_white', duration: 0.8 }, light: { rim: 0.85, side: 'right' },
          subtitle: "Nobody's watching. That's the point." }),
      ],
    },
  ];

  // Shot recipes the photo auto-builder cycles through (one per uploaded photo)
  window.AUTO_BUILD_SHOTS = [
    { title: 'Phone Glow', emotion: 'tired', rig: { gesture: 'check_phone_dark', view: 'front' }, kenBurns: 'push_in' },
    { title: 'Walk', emotion: 'tired', x: 0.25, rig: { gesture: 'pocket', view: 'three_quarter', hood: true, speed: 0.5, travel: 'translate' }, kenBurns: 'drift_right' },
    { title: 'Empty Stare', emotion: 'deadpan', rig: { gesture: 'slouch_lonely', view: 'three_quarter' }, kenBurns: 'push_in' },
    { title: 'Horizon', emotion: 'neutral', rig: { gesture: 'look_back_horizon', view: 'back', wind: 0.5 }, kenBurns: 'pull_out', light: { side: 'back' } },
    { title: 'Alone', emotion: 'crying', silentMouth: 'quiver', rig: { gesture: 'sit_curb_hug_knees', view: 'three_quarter', hood: true }, kenBurns: 'breathing' },
    { title: 'Sigh', emotion: 'neutral', silentMouth: 'sigh', rig: { gesture: 'heavy_sigh', view: 'front' }, kenBurns: 'drift_left' },
  ];
})();
