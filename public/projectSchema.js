// projectSchema.js — The agent-facing ("flat") project format and its mapping to the studio's internal
// scene objects. UMD: loaded by the browser (window.StickyProject) AND by Node (require) so the MCP
// server, CLI, server-side offline edits and the browser bridge all share one source of truth.
//
// Flat scene keys (what AI agents send / receive):
//   title start end emotion pose view gesture handLeft handRight prop walkSpeed walkDir walkInPlace hoodUp
//   wind silentMouth background kenBurns foreground transitionType transitionDur transitionSfx ambientBed
//   ambientVol lightMatch x y scale flipX spineLean headTilt headNod ikPins subtitle captionStyle
//   dutchScene spotlightScene motion camera atmosphere foley cloth
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StickyProject = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const IDS = {
    emotions: ['neutral', 'happy', 'tired', 'crying', 'angry', 'shocked', 'skeptical', 'confused', 'excited', 'deadpan'],
    gestures: ['pocket', 'idle', 'talking', 'explain', 'point_screen', 'point_viewer', 'crossed', 'facepalm', 'hands_head',
      'shrug', 'wave', 'typing', 'slouch_lonely', 'heavy_sigh', 'check_phone_dark', 'sit_curb_hug_knees', 'look_back_horizon', 'pull_hood_up'],
    poses: ['rig', 'front', 'bust', 'side', 'back'],
    views: ['front', 'threeQuarter', 'side', 'back'],
    handStates: ['auto', 'relaxed', 'open_palm', 'pointing', 'fist', 'holding_prop', 'in_pocket'],
    props: ['none', 'phone', 'mug', 'mic', 'controller', 'book'],
    silentMouths: ['closed', 'sigh', 'quiver'],
    kenBurns: ['none', 'push_in', 'pull_out', 'drift_left', 'drift_right', 'breathing'],
    foregrounds: ['none', 'bokeh', 'rain_streaks', 'window_reflection'],
    transitions: ['cut', 'dissolve', 'fade_black', 'fade_white'],
    ambientBeds: ['none', 'rain_window', 'night_wind', 'vinyl_crackle', 'clock_ticking', 'heartbeat', 'crowd_muffle'],
    cameraFx: ['snap_zoom', 'dutch_tilt', 'shake', 'spotlight'],
    sfx: ['whoosh', 'pop', 'vine_boom', 'record_scratch', 'shutter', 'typing', 'footstep_wet', 'heavy_sigh_breath', 'phone_vibrate', 'door_close_echo'],
    aspectRatios: ['16:9', '16:9-letterbox', '9:16'],
    backgrounds: ['paper_sketch', 'cozy_night', 'rainy_window', 'streetlight', 'classroom', 'dark_spotlight', 'rooftop_dusk', 'green_screen'],
    motions: ['talk_bounce', 'breathe', 'walk', 'shake', 'float', 'none'],
    cameras: ['static', 'zoom_in', 'zoom_out', 'pan_right', 'handheld'],
    atmospheres: ['dust', 'rain', 'none'],
    cardKinds: ['image', 'meme', 'post', 'note'],
    captionModes: ['pop', 'cinematic', 'karaoke', 'classic', 'off'],
    templates: ['loneliness_3am', 'social_anxiety', 'burnout', 'discipline'],
    modes: ['silent', 'voiceover'],
  };

  const norm = (v) => String(v ?? '').trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();

  const ALIASES = {
    view: { front: 'front', three_quarter: 'three_quarter', threequarter: 'three_quarter', '3/4': 'three_quarter', '3_4': 'three_quarter', quarter: 'three_quarter', side: 'side', profile: 'side', side_profile: 'side', back: 'back', back_hood: 'back' },
    transition: { cut: 'cut', instant: 'cut', none: 'cut', dissolve: 'dissolve', cross_dissolve: 'dissolve', crossfade: 'dissolve', cross_fade: 'dissolve', fade_black: 'fade_black', fade_through_black: 'fade_black', dip_to_black: 'fade_black', fade_white: 'fade_white', fade_through_white: 'fade_white', dip_to_white: 'fade_white' },
    kenBurns: { none: 'none', static: 'none', push_in: 'push_in', slow_push_in: 'push_in', zoom_in: 'push_in', pull_out: 'pull_out', slow_pull_out: 'pull_out', zoom_out: 'pull_out', drift_left: 'drift_left', drift_right: 'drift_right', breathing: 'breathing', breathing_float: 'breathing', float: 'breathing' },
    foreground: { none: 'none', bokeh: 'bokeh', foreground_bokeh: 'bokeh', rain: 'rain_streaks', rain_streaks: 'rain_streaks', window: 'window_reflection', window_reflection: 'window_reflection', windowpane: 'window_reflection', glass: 'window_reflection' },
    ambient: { none: 'none', rain: 'rain_window', rain_window: 'rain_window', wind: 'night_wind', night_wind: 'night_wind', vinyl: 'vinyl_crackle', vinyl_crackle: 'vinyl_crackle', clock: 'clock_ticking', clock_ticking: 'clock_ticking', heartbeat: 'heartbeat', heart: 'heartbeat', crowd: 'crowd_muffle', crowd_muffle: 'crowd_muffle' },
    silentMouth: { closed: 'closed', default: 'closed', sigh: 'sigh', slow_heavy_sigh: 'sigh', heavy_sigh: 'sigh', quiver: 'quiver', quivering: 'quiver', quivering_lip: 'quiver' },
    template: { loneliness_3am: 'loneliness_3am', '3am': 'loneliness_3am', loneliness: 'loneliness_3am', social_anxiety: 'social_anxiety', anxiety: 'social_anxiety', burnout: 'burnout', emptiness: 'burnout', discipline: 'quiet_discipline', quiet_discipline: 'quiet_discipline' },
    hand: { left: 'back', right: 'front' },
  };

  // Internal ↔ public names for FX
  const CAMERA_IN = { snap_zoom: 'snap_zoom', zoom: 'snap_zoom', dutch_tilt: 'dutch', dutch: 'dutch', shake: 'shake', camera_shake: 'shake', impact_shake: 'shake', spotlight: 'spotlight', spotlight_dim: 'spotlight' };
  const CAMERA_OUT = { snap_zoom: 'snap_zoom', dutch: 'dutch_tilt', shake: 'shake', spotlight: 'spotlight' };
  const SFX_IN = { whoosh: 'whoosh', pop: 'pop', bubble: 'pop', vine_boom: 'boom', boom: 'boom', bass_drop: 'boom', record_scratch: 'scratch', scratch: 'scratch', shutter: 'shutter', camera_shutter: 'shutter', typing: 'typing', keyboard_typing: 'typing', footstep_wet: 'footstep_wet', footstep: 'footstep', heavy_sigh_breath: 'heavy_sigh_breath', sigh: 'heavy_sigh_breath', phone_vibrate: 'phone_vibrate', vibrate: 'phone_vibrate', door_close_echo: 'door_close_echo', door: 'door_close_echo' };
  const SFX_OUT = { boom: 'vine_boom', scratch: 'record_scratch' };
  const CAMERA_DUR = { snap_zoom: 1.4, dutch: 1.8, shake: 0.7, spotlight: 2.6 };

  const ASPECT_IN = { '16:9': '16:9', '16x9': '16:9', widescreen: '16:9', youtube: '16:9', '16:9-letterbox': '16:9_cinema', '16:9_letterbox': '16:9_cinema', '16:9_cinema': '16:9_cinema', letterbox: '16:9_cinema', cinema: '16:9_cinema', '2.35:1': '16:9_cinema', '9:16': '9:16', '9x16': '9:16', vertical: '9:16', shorts: '9:16', reels: '9:16', tiktok: '9:16' };
  const ASPECT_OUT = { '16:9': '16:9', '16:9_cinema': '16:9-letterbox', '9:16': '9:16' };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const unit = (v) => { const n = num(v); return Number.isFinite(n) ? clamp(n > 1 ? n / 100 : n, 0, 1) : NaN; };
  const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

  function normAspect(a) { return ASPECT_IN[String(a ?? '').trim().toLowerCase()] || null; }
  function aspectOut(a) { return ASPECT_OUT[a] || '16:9'; }
  function normTemplate(t) { return ALIASES.template[norm(t)] || null; }

  function normFx(type, kindHint) {
    const k = norm(type);
    if (kindHint !== 'sfx' && CAMERA_IN[k]) return { kind: 'camera', type: CAMERA_IN[k] };
    if (kindHint !== 'camera' && SFX_IN[k]) return { kind: 'sfx', type: SFX_IN[k] };
    return null;
  }

  function defaultRig(o = {}) {
    return { view: 'front', gesture: 'pocket', handFront: 'auto', handBack: 'auto', prop: 'none', speed: 0, direction: 'right', travel: 'in_place', lean: 0, headTilt: 0, headNod: 0, cloth: true, ik: {}, hood: undefined, wind: 0, ...o };
  }

  let seq = 0;
  function newId(prefix = 'sc') { seq += 1; return `${prefix}_${Date.now().toString(36)}_${seq}`; }

  // Internal scene skeleton (matches app.js / templates.js shape)
  function defaultScene(o = {}) {
    return {
      id: o.id || newId('sc'),
      title: 'Scene',
      start: 0,
      end: 4,
      emotion: 'neutral',
      pose: 'rig',
      motion: 'breathe',
      background: 'cozy_night',
      camera: 'static',
      atmosphere: 'dust',
      x: 0.5,
      y: 0.56,
      scale: 1,
      flipX: false,
      subtitle: '',
      rig: defaultRig(),
      cards: [],
      transitionSfx: 'none',
      transition: { type: 'cut', duration: 1 },
      kenBurns: 'none',
      foreground: 'none',
      light: { tint: 0, rim: 0, exposure: 0, side: 'auto' },
      ambient: 'none',
      ambientVolume: 0.6,
      silentMouth: 'closed',
      fxDutch: false,
      fxSpotlight: false,
      ...o,
    };
  }

  const LIGHT_ON = { tint: 0.35, rim: 0.55, exposure: 0.5, side: 'auto' };

  /**
   * Apply flat agent keys onto an internal scene (mutates). ctx options:
   *   resolveBackground(value) → internal background id or null (browser: imported photos by bgId/path)
   *   onCaptionStyle(style) → receives a caption style patch (it is project-wide)
   * Returns { warnings: [] }.
   */
  function applySceneUpdate(scene, u, ctx = {}) {
    const warnings = [];
    if (!u || typeof u !== 'object') return { warnings: ['update must be an object'] };
    scene.rig = scene.rig || defaultRig();
    const rig = scene.rig;
    const enumSet = (key, value, list, aliasMap, setter) => {
      const v = aliasMap ? aliasMap[norm(value)] : list.find((x) => norm(x) === norm(value));
      if (v && (!list || list.includes(v) || aliasMap)) setter(v);
      else warnings.push(`${key}: unknown value "${value}" (valid: ${list.join(', ')})`);
    };
    const numSet = (key, value, lo, hi, setter) => {
      const n = num(value);
      if (Number.isFinite(n)) setter(clamp(n, lo, hi));
      else warnings.push(`${key}: expected a number, got ${JSON.stringify(value)}`);
    };
    const unitSet = (key, value, setter) => {
      const n = unit(value);
      if (Number.isFinite(n)) setter(n);
      else warnings.push(`${key}: expected 0..1 (or 0..100), got ${JSON.stringify(value)}`);
    };

    for (const [key, value] of Object.entries(u)) {
      if (value === undefined) continue;
      switch (key) {
        case 'id': case 'index': case 'duration': case 'weight': case 'backgroundName': break;
        case 'title': scene.title = String(value); break;
        case 'subtitle': case 'caption': scene.subtitle = String(value ?? ''); break;
        case 'start': numSet(key, value, 0, 36000, (n) => { scene.start = n; }); break;
        case 'end': numSet(key, value, 0, 36000, (n) => { scene.end = n; }); break;
        case 'emotion': enumSet(key, value, IDS.emotions, null, (v) => { scene.emotion = v; }); break;
        case 'pose': enumSet(key, value, IDS.poses, null, (v) => { scene.pose = v; }); break;
        case 'view': enumSet(key, value, IDS.views, ALIASES.view, (v) => { rig.view = v; if (scene.pose !== 'rig') scene.pose = 'rig'; }); break;
        case 'gesture': enumSet(key, value, IDS.gestures, null, (v) => { rig.gesture = v; if (scene.pose !== 'rig') scene.pose = 'rig'; }); break;
        case 'handLeft': enumSet(key, value, IDS.handStates, null, (v) => { rig.handBack = v; }); break;
        case 'handRight': enumSet(key, value, IDS.handStates, null, (v) => { rig.handFront = v; }); break;
        case 'prop': enumSet(key, value === null ? 'none' : value, IDS.props, null, (v) => { rig.prop = v; }); break;
        case 'walkSpeed': numSet(key, value, 0, 2.5, (n) => { rig.speed = Math.round(n * 100) / 100; }); break;
        case 'walkDir': enumSet(key, value, ['left', 'right'], null, (v) => { rig.direction = v; }); break;
        case 'walkInPlace': rig.travel = value ? 'in_place' : 'translate'; break;
        case 'hoodUp': rig.hood = value === null ? undefined : !!value; break;
        case 'wind': unitSet(key, value, (n) => { rig.wind = n; }); break;
        case 'cloth': rig.cloth = !!value; break;
        case 'foley': rig.foley = value === null ? undefined : !!value; break;
        case 'silentMouth': enumSet(key, value, IDS.silentMouths, ALIASES.silentMouth, (v) => { scene.silentMouth = v; }); break;
        case 'background': {
          const v = String(value);
          const builtin = IDS.backgrounds.find((b) => b === norm(v));
          const resolved = builtin || (ctx.resolveBackground ? ctx.resolveBackground(v) : null);
          if (resolved) scene.background = resolved;
          else if (ctx.allowUnresolvedBackground) scene.background = v;
          else warnings.push(`background: "${v}" is neither a built-in background (${IDS.backgrounds.join(', ')}) nor an imported photo (bgId or file path)`);
          break;
        }
        case 'kenBurns': enumSet(key, value, IDS.kenBurns, ALIASES.kenBurns, (v) => { scene.kenBurns = v; }); break;
        case 'foreground': enumSet(key, value, IDS.foregrounds, ALIASES.foreground, (v) => { scene.foreground = v; }); break;
        case 'transitionType': case 'transition': {
          if (key === 'transition' && value && typeof value === 'object') {
            if (value.type !== undefined) applySceneUpdate(scene, { transitionType: value.type }, ctx).warnings.forEach((w) => warnings.push(w));
            if (value.duration !== undefined) applySceneUpdate(scene, { transitionDur: value.duration }, ctx).warnings.forEach((w) => warnings.push(w));
            break;
          }
          enumSet(key, value, IDS.transitions, ALIASES.transition, (v) => { scene.transition = { duration: 1, ...(scene.transition || {}), type: v }; });
          break;
        }
        case 'transitionDur': numSet(key, value, 0, 2, (n) => { scene.transition = { type: 'cut', ...(scene.transition || {}), duration: n }; }); break;
        case 'transitionSfx': {
          if (value === null || norm(value) === 'none') { scene.transitionSfx = 'none'; break; }
          const f = normFx(value, 'sfx');
          if (f) scene.transitionSfx = f.type;
          else warnings.push(`transitionSfx: unknown SFX "${value}" (valid: ${IDS.sfx.join(', ')})`);
          break;
        }
        case 'ambientBed': case 'ambient': enumSet(key, value === null ? 'none' : value, IDS.ambientBeds, ALIASES.ambient, (v) => { scene.ambient = v; }); break;
        case 'ambientVol': case 'ambientVolume': unitSet(key, value, (n) => { scene.ambientVolume = n; }); break;
        case 'lightMatch': {
          if (value === true) scene.light = { ...LIGHT_ON };
          else if (value === false || value === null) scene.light = { tint: 0, rim: 0, exposure: 0, side: 'auto' };
          else if (typeof value === 'number' || typeof value === 'string') {
            const n = unit(value);
            if (Number.isFinite(n)) scene.light = { tint: Math.min(1, LIGHT_ON.tint * n * 2), rim: Math.min(1, LIGHT_ON.rim * n * 2), exposure: Math.min(1, LIGHT_ON.exposure * n * 2), side: 'auto' };
            else warnings.push(`lightMatch: expected true/false, 0..1 or {tint, rim, exposure, side}`);
          } else if (typeof value === 'object') {
            // A partial object on a scene with light-match OFF switches it on with the recommended defaults
            const cur = scene.light || { tint: 0, rim: 0, exposure: 0, side: 'auto' };
            const off = !(cur.tint > 0 || cur.rim > 0 || cur.exposure > 0);
            const L = { ...(off ? LIGHT_ON : cur) };
            ['tint', 'rim', 'exposure'].forEach((k) => { if (value[k] !== undefined) { const n = unit(value[k]); if (Number.isFinite(n)) L[k] = n; else warnings.push(`lightMatch.${k}: expected 0..1`); } });
            if (value.side !== undefined) {
              if (['auto', 'left', 'right', 'back'].includes(value.side)) L.side = value.side;
              else warnings.push('lightMatch.side: expected auto|left|right|back');
            }
            scene.light = L;
          }
          break;
        }
        case 'x': numSet(key, value, -0.3, 1.3, (n) => { scene.x = n; }); break;
        case 'y': numSet(key, value, -0.3, 1.5, (n) => { scene.y = n; }); break;
        case 'scale': numSet(key, value, 0.2, 4, (n) => { scene.scale = n; }); break;
        case 'flipX': scene.flipX = !!value; break;
        case 'spineLean': numSet(key, value, -40, 40, (n) => { rig.lean = n; }); break;
        case 'headTilt': numSet(key, value, -45, 45, (n) => { rig.headTilt = n; }); break;
        case 'headNod': numSet(key, value, -40, 40, (n) => { rig.headNod = n; }); break;
        case 'ikPins': {
          if (!value) { rig.ik = {}; break; }
          const map = { rightHand: 'frontHand', frontHand: 'frontHand', leftHand: 'backHand', backHand: 'backHand', rightFoot: 'frontFoot', frontFoot: 'frontFoot', leftFoot: 'backFoot', backFoot: 'backFoot', head: 'head' };
          const ik = {};
          Object.entries(value).forEach(([k, p]) => {
            const kk = map[k];
            if (!kk) { warnings.push(`ikPins: unknown effector "${k}" (rightHand, leftHand, rightFoot, leftFoot, head)`); return; }
            if (p === null) return;
            if (p && Number.isFinite(num(p.x)) && Number.isFinite(num(p.y))) ik[kk] = { x: num(p.x), y: num(p.y) };
            else warnings.push(`ikPins.${k}: expected {x, y} in rig units (origin = ground between feet, +x = facing, y up is negative)`);
          });
          rig.ik = ik;
          break;
        }
        case 'captionStyle': {
          if (ctx.onCaptionStyle) ctx.onCaptionStyle(typeof value === 'string' ? { mode: value } : value);
          break;
        }
        case 'dutchScene': scene.fxDutch = !!value; break;
        case 'spotlightScene': scene.fxSpotlight = !!value; break;
        case 'motion': enumSet(key, value, IDS.motions, null, (v) => { scene.motion = v; }); break;
        case 'camera': enumSet(key, value, IDS.cameras, null, (v) => { scene.camera = v; }); break;
        case 'atmosphere': enumSet(key, value, IDS.atmospheres, null, (v) => { scene.atmosphere = v; }); break;
        case 'cards': case 'mediaCards': break; // handled at project level
        default: warnings.push(`unknown scene key "${key}" (ignored)`);
      }
    }
    return { warnings };
  }

  function internalToFlat(sc, index, bgInfo) {
    const rig = sc.rig || defaultRig();
    const L = sc.light || { tint: 0, rim: 0, exposure: 0, side: 'auto' };
    const flat = {
      index,
      id: sc.id,
      title: sc.title,
      start: r3(sc.start),
      end: r3(sc.end),
      emotion: sc.emotion,
      pose: sc.pose,
      view: rig.view === 'three_quarter' ? 'threeQuarter' : rig.view,
      gesture: rig.gesture,
      handLeft: rig.handBack || 'auto',
      handRight: rig.handFront || 'auto',
      prop: rig.prop || 'none',
      walkSpeed: rig.speed || 0,
      walkDir: rig.direction || 'right',
      walkInPlace: (rig.travel || 'in_place') === 'in_place',
      hoodUp: rig.hood === undefined ? rig.view === 'back' : !!rig.hood,
      wind: r3(rig.wind || 0),
      silentMouth: sc.silentMouth || 'closed',
      background: sc.background,
      kenBurns: sc.kenBurns || 'none',
      foreground: sc.foreground || 'none',
      transitionType: (sc.transition && sc.transition.type) || 'cut',
      transitionDur: r3((sc.transition && sc.transition.duration) ?? 1),
      transitionSfx: SFX_OUT[sc.transitionSfx] || sc.transitionSfx || 'none',
      ambientBed: sc.ambient || 'none',
      ambientVol: r3(sc.ambientVolume ?? 0.6),
      lightMatch: { tint: r3(L.tint || 0), rim: r3(L.rim || 0), exposure: r3(L.exposure || 0), side: L.side || 'auto' },
      x: r3(sc.x ?? 0.5),
      y: r3(sc.y ?? 0.55),
      scale: r3(sc.scale ?? 1),
      flipX: !!sc.flipX,
      spineLean: rig.lean || 0,
      headTilt: rig.headTilt || 0,
      headNod: rig.headNod || 0,
      ikPins: Object.fromEntries(Object.entries(rig.ik || {}).map(([k, p]) => [{ frontHand: 'rightHand', backHand: 'leftHand', frontFoot: 'rightFoot', backFoot: 'leftFoot', head: 'head' }[k] || k, p])),
      subtitle: sc.subtitle || '',
      dutchScene: !!sc.fxDutch,
      spotlightScene: !!sc.fxSpotlight,
      motion: sc.motion,
      camera: sc.camera,
      atmosphere: sc.atmosphere,
    };
    if (rig.foley !== undefined) flat.foley = rig.foley;
    if (bgInfo && bgInfo[sc.background]) flat.backgroundName = bgInfo[sc.background].name;
    return flat;
  }

  function fxToFlat(ev) {
    const out = { id: ev.id, kind: ev.kind, timeSec: r3(ev.time) };
    if (ev.kind === 'camera') {
      out.type = CAMERA_OUT[ev.type] || ev.type;
      out.duration = r3(ev.duration ?? CAMERA_DUR[ev.type] ?? 1);
      out.intensity = ev.intensity ?? 1;
      if (ev.dir) out.dir = ev.dir;
    } else {
      out.type = SFX_OUT[ev.type] || ev.type;
      if (ev.volume !== undefined) out.volume = ev.volume;
    }
    return out;
  }

  // Flat FX marker → internal fxEvent (or { error })
  function flatToFx(m) {
    if (!m || typeof m !== 'object') return { error: 'fx marker must be an object' };
    const f = normFx(m.type, m.kind);
    if (!f) return { error: `unknown fx type "${m.type}" (camera: ${IDS.cameraFx.join(', ')}; sfx: ${IDS.sfx.join(', ')})` };
    const t = num(m.timeSec ?? m.time);
    if (!Number.isFinite(t) || t < 0) return { error: `fx "${m.type}" needs timeSec >= 0` };
    const ev = { id: m.id || newId('fx'), kind: f.kind, type: f.type, time: Math.round(t * 100) / 100 };
    if (f.kind === 'camera') {
      ev.duration = clamp(Number.isFinite(num(m.duration)) ? num(m.duration) : CAMERA_DUR[f.type], 0.1, 20);
      ev.intensity = clamp(Number.isFinite(num(m.intensity)) ? num(m.intensity) : 1, 0, 3);
      if (f.type === 'dutch') ev.dir = num(m.dir) < 0 ? -1 : 1;
    } else if (Number.isFinite(num(m.volume))) {
      ev.volume = clamp(num(m.volume), 0, 3);
    }
    return { ev };
  }

  function cardToFlat(card, sceneIndex, sceneId) {
    return {
      id: card.id, sceneIndex, sceneId, kind: card.kind, text: card.text || '', title: card.title,
      side: card.side || 'auto', appear: r3(card.appear || 0), hold: r3(card.hold || 0), size: r3(card.size || 0.34),
      mediaId: card.mediaId || undefined, imagePath: card.imagePath || undefined,
    };
  }

  function flatToCard(c) {
    const kind = IDS.cardKinds.includes(c.kind) ? c.kind : 'note';
    return {
      id: c.id || newId('card'), kind, text: String(c.text ?? ''), title: c.title,
      side: ['auto', 'left', 'right'].includes(c.side) ? c.side : 'auto',
      appear: Math.max(0, num(c.appear) || 0), hold: Math.max(0, num(c.hold) || 0),
      size: clamp(num(c.size) || (kind === 'note' ? 0.3 : 0.34), 0.15, 0.6),
      mediaId: c.mediaId || c.bgId || undefined, imagePath: c.imagePath || undefined,
    };
  }

  function nearestBeat(beats, t, maxDist = 0.35) {
    if (!Array.isArray(beats) || !beats.length) return null;
    let best = null, bd = Infinity;
    for (const b of beats) {
      const bt = typeof b === 'number' ? b : b.time;
      const d = Math.abs(bt - t);
      if (d < bd) { bd = d; best = bt; }
    }
    return bd <= maxDist ? best : null;
  }

  /**
   * Fill in start/end for flat scenes. Scenes may give explicit start/end, a `duration`, a relative
   * `weight`, or nothing (evenly spread over totalDuration). Optional beat snapping of the cuts.
   */
  function layoutScenes(scenes, totalDuration, beats, snapToBeats) {
    const n = scenes.length;
    if (!n) return scenes;
    const allTimed = scenes.every((s) => Number.isFinite(num(s.start)) && Number.isFinite(num(s.end)));
    if (allTimed) {
      scenes.forEach((s) => { s.start = num(s.start); s.end = num(s.end); });
    } else {
      const total = totalDuration > 0 ? totalDuration : n * 4;
      const fixed = scenes.reduce((a, s) => a + (Number.isFinite(num(s.duration)) ? num(s.duration) : 0), 0);
      const flexible = scenes.filter((s) => !Number.isFinite(num(s.duration)));
      const wsum = flexible.reduce((a, s) => a + (Number.isFinite(num(s.weight)) ? num(s.weight) : 1), 0) || 1;
      const remain = Math.max(0, total - fixed);
      let t = 0;
      scenes.forEach((s) => {
        const d = Number.isFinite(num(s.duration)) ? num(s.duration) : (remain * (Number.isFinite(num(s.weight)) ? num(s.weight) : 1)) / wsum;
        s.start = t;
        t += d;
        s.end = t;
      });
    }
    if (snapToBeats && beats && beats.length) {
      for (let i = 1; i < n; i++) {
        const avg = (scenes[n - 1].end - scenes[0].start) / n;
        const b = nearestBeat(beats, scenes[i].start, Math.min(0.7, avg / 4));
        if (b !== null && b > scenes[i - 1].start + 0.3) scenes[i].start = b;
      }
    }
    for (let i = 0; i < n; i++) {
      scenes[i].start = Math.round(scenes[i].start * 100) / 100;
      if (i < n - 1) scenes[i].end = scenes[i + 1].start;
      scenes[i].end = Math.round(scenes[i].end * 100) / 100;
    }
    scenes[0].start = 0;
    return scenes;
  }

  // Keep the timeline contiguous after a single scene's start/end changed
  function retime(scenes, index, changed) {
    const s = scenes[index];
    if (!s) return;
    if (changed.start && index > 0) scenes[index - 1].end = s.start;
    if (changed.end && index < scenes.length - 1) scenes[index + 1].start = s.end;
    if (index === 0) s.start = 0;
  }

  function findScene(scenes, ref) {
    if (ref === undefined || ref === null) return -1;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
      const i = Number(ref);
      return i >= 0 && i < scenes.length ? i : -1;
    }
    return scenes.findIndex((s) => s.id === ref || s.title === ref);
  }

  // ---- Server-side (offline) editing of the stored flat project, used when no browser is connected ----
  function offlineSetProject(project, patch) {
    const p = { ...(project || {}) };
    const warnings = [];
    ['mode', 'fadeOutEnd', 'masterAmbientVol', 'captionStyle', 'totalDuration'].forEach((k) => { if (patch[k] !== undefined) p[k] = patch[k]; });
    if (patch.aspectRatio !== undefined) {
      const a = normAspect(patch.aspectRatio);
      if (a) p.aspectRatio = aspectOut(a); else warnings.push(`aspectRatio: unknown "${patch.aspectRatio}"`);
    }
    if (Array.isArray(patch.scenes)) {
      const total = num(patch.totalDuration) || num(p.totalDuration) || (p.audio && p.audio.duration) || 0;
      const scenes = patch.scenes.map((s) => {
        const internal = defaultScene();
        const r = applySceneUpdate(internal, s, { allowUnresolvedBackground: true });
        r.warnings.forEach((w) => warnings.push(w));
        if (s.start !== undefined) internal.start = num(s.start);
        if (s.end !== undefined) internal.end = num(s.end);
        return { internal, src: s };
      });
      const timing = layoutScenes(patch.scenes.map((s) => ({ ...s })), total, p.audio && p.audio.beats, patch.snapToBeats !== false);
      p.scenes = scenes.map(({ internal }, i) => {
        internal.start = timing[i].start;
        internal.end = timing[i].end;
        return internalToFlat(internal, i);
      });
      if (!p.totalDuration && p.scenes.length) p.totalDuration = p.scenes[p.scenes.length - 1].end;
    }
    if (Array.isArray(patch.fxMarkers)) {
      p.fxMarkers = [];
      patch.fxMarkers.forEach((m) => { const r = flatToFx(m); if (r.error) warnings.push(r.error); else p.fxMarkers.push(fxToFlat(r.ev)); });
    }
    if (Array.isArray(patch.mediaCards)) p.mediaCards = patch.mediaCards.map((c) => ({ ...cardToFlat(flatToCard(c), c.sceneIndex ?? 0, c.sceneId) }));
    return { project: p, warnings };
  }

  function offlineUpdateScene(project, ref, updates) {
    const p = { ...(project || {}), scenes: [...((project && project.scenes) || [])] };
    const i = findScene(p.scenes, ref);
    if (i < 0) return { error: `scene "${ref}" not found (${p.scenes.length} scenes)` };
    const internal = defaultScene({ id: p.scenes[i].id });
    applySceneUpdate(internal, p.scenes[i], { allowUnresolvedBackground: true });
    internal.start = p.scenes[i].start;
    internal.end = p.scenes[i].end;
    const r = applySceneUpdate(internal, updates, { allowUnresolvedBackground: true });
    const flat = internalToFlat(internal, i);
    p.scenes[i] = flat;
    retime(p.scenes, i, { start: updates.start !== undefined, end: updates.end !== undefined });
    return { project: p, scene: flat, warnings: r.warnings };
  }

  return {
    IDS, ALIASES, norm, normAspect, aspectOut, normTemplate, normFx, defaultRig, defaultScene, newId,
    applySceneUpdate, internalToFlat, fxToFlat, flatToFx, cardToFlat, flatToCard, nearestBeat, layoutScenes,
    retime, findScene, offlineSetProject, offlineUpdateScene, CAMERA_DUR,
  };
});
