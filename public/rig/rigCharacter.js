// rigCharacter.js — Hierarchical 2D skeletal rig + IK/FK limb renderer for the Sticky Hoodie character.
//
// Draw order (back → front):
//   ground shadow → [back arm, when it is behind the torso] → back leg → front leg → (stool)
//   → torso_hoodie_base (+ kangaroo pocket, hem, hood back) → drawstrings → neck/head (+ face) or hood-up
//   → (desk) → [back arm, when in front] → front arm (+ prop) → hoodie_kangaroo_pocket_overlay (over hands
//   that are "in_pocket") → IK gizmos.
//
// Bones: back_arm_upper → back_arm_lower → back_hand, left/right_leg_upper → _lower → _shoe,
//        torso_hoodie_base (spine lean + breathing squash/stretch), head_neck (tilt / nod / turn),
//        front_arm_upper → front_arm_lower → front_hand.
(function () {
  const {
    DEG, clamp, lerp, smoothstep, easeInOut, dir, add, sub, dist, rotate, xform, wrapAngle, angleLerp,
    damp, dampAngle, smoothNoise, solveTwoBoneIK, fk2, RIG_DIMS: D, TORSO_PROFILE, projectBody,
  } = window.RigCore;

  const PAL = {
    hoodie: '#7d7970', hoodieFar: '#6c6860', hoodieShade: '#5c5851', hoodieShadeFar: '#4f4b45',
    hoodieInk: '#1a1917', rib: '#74706a', pocket: '#77736a', hoodInside: '#2e2c29',
    pants: '#1c1b19', pantsFar: '#141412', pantsInk: '#0d0d0c', pantsFold: '#2f2d2a',
    shoe: '#2b2a28', shoeFar: '#21201e', shoeInk: '#0d0d0c', midsole: '#c6c1b5', midsoleFar: '#a8a398', laces: '#d8d3c6',
    skin: '#08080a', skinRim: '#26262c', string: '#ece7da', aglet: '#9d988d',
  };

  const VIEW_TURN = { front: 0, three_quarter: 0.55, side: 1, back: 0 };

  window.RIG_VIEWS = [
    { id: 'front', name: 'Front' },
    { id: 'three_quarter', name: '3/4 View' },
    { id: 'side', name: 'Side Profile' },
    { id: 'back', name: 'Back (Hood Up)' },
  ];

  window.defaultRigSettings = function defaultRigSettings(overrides = {}) {
    return {
      view: 'front',
      gesture: 'pocket',
      handFront: 'auto',
      handBack: 'auto',
      prop: 'none',
      speed: 0,
      direction: 'right',
      travel: 'in_place',
      lean: 0,
      headTilt: 0,
      headNod: 0,
      cloth: true,
      ik: {},
      hood: undefined,      // v3: hood up on every view (undefined = auto: up only in the back view)
      wind: 0,              // v3: 0..1 wind strength through hem / drawstrings / hood
      ...overrides,
    };
  };

  // ---------- Drawing helpers ----------
  function capsulePath(ctx, a, b, ra, rb, bulge = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-3;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const ang = Math.atan2(dy, dx);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rm = (ra + rb) / 2;
    const cOff = 2 * (rm + bulge) - rm;
    ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
    ctx.quadraticCurveTo(mx + nx * cOff, my + ny * cOff, b.x + nx * rb, b.y + ny * rb);
    ctx.arc(b.x, b.y, rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
    ctx.quadraticCurveTo(mx - nx * cOff, my - ny * cOff, a.x - nx * ra, a.y - ny * ra);
    ctx.arc(a.x, a.y, ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
    ctx.closePath();
  }

  // Two-pass ink technique: stroke every segment thick in ink, then fill the union on top.
  // Result: one continuous silhouette with rounded joint caps and no seams/gaps at the joints.
  function drawChain(ctx, segs, style) {
    if (!segs.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    segs.forEach((s) => capsulePath(ctx, s.a, s.b, s.ra, s.rb, s.bulge || 0));
    ctx.lineWidth = style.inkW * 2;
    ctx.strokeStyle = style.ink;
    ctx.stroke();
    ctx.fillStyle = style.fill;
    ctx.fill();
    if (style.shade) {
      // Form shading: one soft stroke hugging the shadow-side edge of every segment.
      // A single stroke() call paints the union once, so overlaps at the joints never double up.
      ctx.clip();
      ctx.beginPath();
      const sideSign = style.shadeSide || 1;
      segs.forEach((s) => {
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * sideSign, ny = (dx / len) * sideSign;
        const k = 0.95;
        ctx.moveTo(s.a.x + nx * s.ra * k, s.a.y + ny * s.ra * k);
        ctx.quadraticCurveTo(
          (s.a.x + s.b.x) / 2 + nx * ((s.ra + s.rb) / 2 + (s.bulge || 0) * 2) * k,
          (s.a.y + s.b.y) / 2 + ny * ((s.ra + s.rb) / 2 + (s.bulge || 0) * 2) * k,
          s.b.x + nx * s.rb * k, s.b.y + ny * s.rb * k);
      });
      ctx.lineWidth = (segs[0].ra || 12) * 0.75;
      ctx.lineCap = 'round';
      ctx.strokeStyle = style.shade;
      ctx.stroke();
    }
    ctx.restore();
  }

  function smoothClosedPath(ctx, pts) {
    const n = pts.length;
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  }

  function strokeCurve(ctx, pts, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) ctx.lineTo(pts[1].x, pts[1].y);
    else if (pts.length === 3) ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    else ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- The rig ----------
  class RigCharacter {
    constructor(charRenderer) {
      this.face = charRenderer;
      this.gestures = new window.GestureController();
      this.loco = new window.LocomotionController();
      this.cloth = new window.ClothPhysics();

      this.turn = 0;
      this.facing = 1;
      this.sitW = 0;
      this.armLocoW = { front: 0, back: 0 };
      this.gestureKey = null;
      this.gestureBlend = 1;
      this.armSnapshot = null;
      this.lastArms = null;
      this.goalSmooth = { lean: 0, headTilt: 0, headNod: 0, shoulderLift: 0 };

      this.sceneId = null;
      this.root = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, init: false };
      this.S = 1;
      this.J = null;           // last solved joints (local space)
      this.matrix = null;      // local → canvas pixel transform of the last draw
      this.effectors = {};
      this.hoverKey = null;
      this.dragKey = null;
      this.time = 0;
      // v3
      this.events = [];          // per-frame foley events: { type: 'footstep' | 'land' | 'sigh', ... }
      this.breathPhase = 0;
      this.hoodAmt = 0;
      this.sitPose = null;
      this.lastContacts = 0;
      this.lastLandings = 0;
      this.lastSighCycle = undefined;
      this.lastFrame = -10;
      this.lastUsedFrame = -10;
    }

    // Hood state for a scene: explicit toggle wins, otherwise up only in the back view.
    static hoodFor(rig) {
      if (rig.hood === true) return 1;
      if (rig.hood === false) return 0;
      return rig.view === 'back' ? 1 : 0;
    }

    // ===== Simulation =====
    update(dt, p) {
      const { scene, W, H } = p;
      const rig = scene.rig || (scene.rig = window.defaultRigSettings());
      this.time = p.time;
      const t = p.time;
      const audio = p.audio || { mouthOpen: 0 };
      this.events = [];

      // A "hard cut" (new background or camera view) snaps the pose; splitting a scene inside the
      // same shot (same background & view) keeps the smooth gesture/turn blending. A rig that was idle
      // last frame (re-used from the pool for a transition) also snaps.
      let hardCut = false;
      if (p.frame !== undefined) {
        if (p.frame - this.lastFrame > 1) hardCut = true;
        this.lastFrame = p.frame;
        this.lastUsedFrame = p.frame;
      }
      if (scene.id !== this.sceneId) {
        const prev = this.prevShot;
        hardCut = !prev || prev.background !== scene.background || prev.view !== rig.view;
        this.sceneId = scene.id;
        this.loco.reset(0);
        this.root.init = false;
      }
      this.prevShot = { background: scene.background, view: rig.view };
      if (p.resetTravel) this.loco.reset(0);

      // Facing
      const newFacing = (rig.direction === 'left' ? -1 : 1) * (scene.flipX ? -1 : 1);
      if (newFacing !== this.facing) {
        this.facing = newFacing;
        this.cloth.reset();
      }

      // Gesture
      this.gestures.updateAudio(dt, audio);
      const gKey = `${rig.gesture}|${rig.prop}`;
      if (gKey !== this.gestureKey) {
        if (this.gestureKey !== null && this.lastArms) {
          this.armSnapshot = JSON.parse(JSON.stringify(this.lastArms));
          this.gestureBlend = 0;
        }
        this.gestureKey = gKey;
      }
      this.gestureBlend = hardCut ? 1 : Math.min(1, this.gestureBlend + dt / 0.35);
      const goal = this.gestures.compute(rig.gesture, { t, prop: rig.prop, sceneT: p.sceneTime });
      if (goal.sit) this.sitPose = goal.sit;

      // Locomotion
      let targetSpeed = rig.speed || 0;
      if (scene.motion === 'walk' && targetSpeed === 0) targetSpeed = 0.8;
      if (goal.sit) targetSpeed = 0;
      this.loco.update(dt, targetSpeed);
      const L = this.loco.evaluate();

      // View / turn (walking forces a 3/4-profile so the gait reads clearly)
      let turnTarget = VIEW_TURN[rig.view] ?? 0;
      const backView = rig.view === 'back' && L.walkW < 0.5 && !goal.sit;
      if (!backView) turnTarget = lerp(turnTarget, Math.max(turnTarget, 0.8), L.walkW);
      if (goal.minTurn) turnTarget = Math.max(turnTarget, goal.minTurn);
      this.turn = hardCut ? (backView ? 0 : turnTarget) : damp(this.turn, backView ? 0 : turnTarget, 9, dt);
      this.backView = backView;
      this.sitW = hardCut ? (goal.sit ? 1 : 0) : damp(this.sitW, goal.sit ? 1 : 0, 7, dt);
      if (hardCut) {
        this.loco.speed = this.loco.targetSpeed;
        this.cloth.reset();
      }

      // Hood (per-scene toggle on every view, or animated by the "Pull Hood Up" action)
      const hoodTarget = goal.hood !== undefined ? goal.hood : RigCharacter.hoodFor(rig);
      this.hoodAmt = hardCut || goal.hood !== undefined ? hoodTarget : damp(this.hoodAmt, hoodTarget, 10, dt);

      // Breathing: per-gesture rate & depth, deepened subtly by the music in Silent Film Mode
      const music = audio.musicEnergy || 0;
      const beat = audio.beatPulse || 0;
      this.breathPhase += dt * (goal.breathRate || 2.4) * (1 + music * 0.15);
      this.breathValue = scene.motion === 'none' ? 0
        : (goal.breathOverride !== undefined ? goal.breathOverride
          : Math.sin(this.breathPhase) * (goal.breathDepth || 1) * (1 + music * 0.6));
      // Music micro-rhythm: tiny head-nod on beats while walking or "listening"
      const listening = ['idle', 'pocket', 'look_back_horizon', 'slouch_lonely', 'check_phone_dark'].includes(rig.gesture);
      this.musicNod = beat * (L.walkW > 0.3 || listening ? 0.035 : 0.012);

      // Foley events (consumed by the app while playing)
      if (this.loco.contacts !== this.lastContacts) {
        if (!goal.sit && !L.jump.active) this.events.push({ type: 'footstep', speed: this.loco.speed, leg: this.loco.lastContactLeg });
        this.lastContacts = this.loco.contacts;
      }
      if (this.loco.landings !== this.lastLandings) {
        this.events.push({ type: 'land' });
        this.lastLandings = this.loco.landings;
      }
      if (goal.sighCycle !== undefined) {
        if (this.lastSighCycle !== undefined && goal.sighCycle !== this.lastSighCycle && !hardCut) this.events.push({ type: 'sigh' });
        this.lastSighCycle = goal.sighCycle;
      } else {
        this.lastSighCycle = undefined;
      }

      // Smooth gesture-level scalars
      const gs = this.goalSmooth;
      if (hardCut) Object.assign(gs, { lean: goal.lean, headTilt: goal.headTilt, headNod: goal.headNod, shoulderLift: goal.shoulderLift });
      gs.lean = damp(gs.lean, goal.lean, 6, dt);
      gs.headTilt = damp(gs.headTilt, goal.headTilt, 6, dt);
      gs.headNod = damp(gs.headNod, goal.headNod, 6, dt);
      gs.shoulderLift = damp(gs.shoulderLift, goal.shoulderLift, 8, dt);

      // Arms follow the gait when the gesture allows it (pocket keeps hands in while walking; running pumps)
      ['front', 'back'].forEach((arm) => {
        const holding = goal.propArm === arm;
        const swing = !holding && (goal.walkArms === 'swing' || (L.runW > 0.5 && rig.gesture === 'pocket'));
        this.armLocoW[arm] = hardCut ? (swing ? L.walkW : 0) : damp(this.armLocoW[arm], swing ? L.walkW : 0, 6, dt);
      });

      // Root placement in screen space
      const framing = (window.STUDIO_FRAMING && window.STUDIO_FRAMING.charScale) || 1;
      const defaultScale = ((H * 0.76) / D.spriteHeight) * framing;
      this.S = defaultScale * (scene.scale ?? 1);
      const S = this.S;
      const baseX = (scene.x ?? 0.5) * W;
      const centerY = (scene.y ?? 0.55) * H;
      let rootX = baseX;
      if (rig.travel === 'translate') {
        const margin = 90 * S;
        const span = W + margin * 2;
        const raw = baseX + this.facing * this.loco.distance * S + margin;
        rootX = ((raw % span) + span) % span - margin;
      }
      let rootY = centerY + (D.spriteHeight / 2) * S;
      // Legacy "Body Action" modifiers
      let jitterX = 0, jitterY = 0, floatY = 0;
      if (scene.motion === 'shake') {
        jitterX = Math.sin(t * 42) * 3.2;
        jitterY = Math.cos(t * 37) * 1.8;
      } else if (scene.motion === 'float') {
        floatY = -(Math.sin(t * 1.8) * 14 + 18);
      }
      this.rootWorld = { x: rootX, y: rootY, jitterX, jitterY, floatY };

      // Inertial acceleration of the root for cloth (in local units, facing-corrected)
      const wx = rootX + jitterX * S, wy = rootY + (jitterY + floatY) * S;
      const r = this.root;
      if (!r.init || Math.abs(wx - r.x) > W * 0.4 || dt <= 0) {
        Object.assign(r, { x: wx, y: wy, vx: 0, vy: 0, ax: 0, ay: 0, init: true });
      } else {
        const vx = (wx - r.x) / dt, vy = (wy - r.y) / dt;
        const ax = (vx - r.vx) / dt, ay = (vy - r.vy) / dt;
        r.ax = damp(r.ax, ax, 25, dt);
        r.ay = damp(r.ay, ay, 25, dt);
        Object.assign(r, { x: wx, y: wy, vx, vy });
      }

      // Solve skeleton
      this.J = this.solve(rig, goal, L, t, audio, scene, dt);

      // Secondary physics
      const J = this.J;
      const accelLocal = { x: (r.ax / S) * this.facing, y: r.ay / S };
      const frontX = J.stringAnchors.left.x;
      const profile = Math.sin(J.phi) > 0.55;
      // Wind blows screen-left → screen-right; convert to the (possibly mirrored) local frame
      const windAmt = Math.max(rig.wind || 0, goal.wind || 0);
      const gust = 0.65 + 0.35 * smoothNoise(t * 0.6 + 3);
      this.cloth.update(dt, J.stringAnchors, accelLocal, {
        strength: rig.cloth === false ? 0 : 1,
        minX: profile ? (() => frontX - 3) : undefined,
        wind: windAmt * gust * this.facing,
      });
      if (rig.cloth === false) this.cloth.reset();
    }

    solve(rig, goal, L, t, audio, scene, dt) {
      const phi = this.turn * Math.PI / 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const br = this.breathValue || 0;
      const talkLift = scene.motion === 'talk_bounce' ? (audio.mouthOpen || 0) : 0;
      const jump = L.jump;

      // ---- Legs (FK from gait, pelvis at origin) ----
      const hipLat = { front: -D.hipHalf, back: D.hipHalf };
      const legFK = {};
      let lowest = -1e9;
      ['front', 'back'].forEach((leg) => {
        const g = L.legs[leg];
        const hip = { x: hipLat[leg] * c + (leg === 'front' ? 2 : -2) * s, y: 0 };
        const spread = (leg === 'front' ? -1 : 1) * 0.035 * c * (1 - L.walkW);
        let thigh = g.thigh + spread + jump.tuck * 0.75;
        let shin = thigh - g.knee - jump.tuck * 1.3 + spread * 0.4;
        const k = fk2(hip, thigh, shin, D.thigh, D.shin);
        const footA = g.foot * s - jump.tuck * 0.3 * s;
        const heel = add(k.end, rotate({ x: -D.footBack, y: D.ankleH }, footA));
        const toe = add(k.end, rotate({ x: D.footFront, y: D.ankleH }, footA));
        lowest = Math.max(lowest, heel.y, toe.y);
        legFK[leg] = { hip, thigh, shin, knee: k.mid, ankle: k.end, foot: footA };
      });
      let pelvisY = -lowest;                           // ground snap: lowest sole touches y = 0
      pelvisY -= L.flightLift;                         // run flight phase
      pelvisY += jump.crouch * 24 - jump.lift;         // jump anticipation / airborne
      const pelvis = { x: 0, y: pelvisY };

      // Re-plant feet during crouch/landing using IK (feet stay on the ground while the pelvis drops)
      const legs = {};
      ['front', 'back'].forEach((leg) => {
        const f = legFK[leg];
        const hipW = add(pelvis, f.hip);
        let knee = add(pelvis, f.knee), ankle = add(pelvis, f.ankle), thigh = f.thigh, shin = f.shin, foot = f.foot;
        if (jump.crouch > 0.001 && jump.lift < 1) {
          const target = { x: ankle.x, y: Math.min(-D.ankleH, ankle.y + jump.crouch * 24) };
          const ik = solveTwoBoneIK(hipW, target, D.thigh, D.shin, add(hipW, { x: 60 * s + 1, y: 40 }));
          thigh = ik.upper; shin = ik.lower; knee = ik.mid; ankle = ik.end;
        }
        legs[leg] = { hip: hipW, knee, ankle, thigh, shin, foot };
      });

      // ---- Sitting (desk stool, curb / floor) — blended IK pose ----
      let pel = pelvis;
      const sp = this.sitPose;
      if (this.sitW > 0.001 && sp) {
        const sitPelvis = sp.pelvis;
        pel = { x: lerp(pelvis.x, sitPelvis.x, this.sitW), y: lerp(pelvis.y, sitPelvis.y, this.sitW) };
        ['front', 'back'].forEach((leg) => {
          const hipW = { x: pel.x + legs[leg].hip.x - pelvis.x, y: pel.y };
          const ankleT = sp.ankles[leg];
          const ik = solveTwoBoneIK(hipW, ankleT, D.thigh, D.shin, add(hipW, sp.kneeHint));
          const L0 = legs[leg];
          const thigh = angleLerp(L0.thigh, ik.upper, this.sitW);
          const shin = angleLerp(L0.shin, ik.lower, this.sitW);
          const k = fk2(hipW, thigh, shin, D.thigh, D.shin);
          legs[leg] = { hip: hipW, knee: k.mid, ankle: k.end, thigh, shin, foot: L0.foot * (1 - this.sitW) };
        });
      }

      // ---- Manual foot IK pins ----
      const ik = rig.ik || {};
      [['front', 'frontFoot'], ['back', 'backFoot']].forEach(([leg, key]) => {
        const pin = ik[key];
        if (!pin) return;
        const hipW = legs[leg].hip;
        const sol = solveTwoBoneIK(hipW, pin, D.thigh, D.shin, add(hipW, { x: 70 * (s > 0.3 ? 1 : 0.4), y: 30 }));
        legs[leg] = { ...legs[leg], thigh: sol.upper, shin: sol.lower, knee: sol.mid, ankle: sol.end, foot: 0 };
      });

      // ---- Spine / torso ----
      let lean = (rig.lean || 0) * DEG + this.goalSmooth.lean + L.lean + talkLift * 0.03 - jump.crouch * -0.12;
      let headTilt = (rig.headTilt || 0) * DEG + this.goalSmooth.headTilt;
      let headNod = (rig.headNod || 0) * DEG + this.goalSmooth.headNod + L.headNod + talkLift * 0.05 * Math.sin(t * 9.5)
        + (this.musicNod || 0);
      const torsoOrigin = { x: pel.x, y: pel.y + L.torsoBob * 0.6 - talkLift * 3.5 };

      if (ik.head) {
        const leanH = Math.atan2(ik.head.x - torsoOrigin.x, -(ik.head.y - torsoOrigin.y));
        lean = clamp(leanH, -0.6, 0.6);
        const neckTmp = xform(torsoOrigin, lean, { x: 0, y: -D.spine });
        headTilt = clamp(Math.atan2(ik.head.x - neckTmp.x, -(ik.head.y - neckTmp.y)) - lean, -0.7, 0.7);
      }

      const body = { pelvis: torsoOrigin, lean, phi };
      const lift = this.goalSmooth.shoulderLift + br * 0.8;
      const neck = projectBody(body, 0, 0, D.spine + lift * 0.5);
      const headAngle = lean + headTilt;
      const headC = add(neck, rotate({ x: 0, y: -(D.headUp - D.spine) }, headAngle));
      const shoulders = {
        front: projectBody(body, -D.shoulderHalf, 0, D.shoulderUp + lift),
        back: projectBody(body, D.shoulderHalf, 0, D.shoulderUp + lift),
      };

      // ---- Arms ----
      const arms = {};
      const handOverride = { front: rig.handFront || 'auto', back: rig.handBack || 'auto' };
      ['front', 'back'].forEach((arm) => {
        const sh = shoulders[arm];
        const g = goal[arm];
        const res = window.GestureController.resolveGoal(g, body);
        // Arms anchored to the knees (hugging knees) follow the solved leg pose
        if (g.anchor === 'knee' && this.sitW > 0.5) res.wrist = add(legs[arm].knee, g.anchorOff || { x: 0, y: 0 });
        const l1 = D.upperArm * g.reach, l2 = D.forearm * g.reach;
        const gi = solveTwoBoneIK(sh, res.wrist, l1, l2, res.elbowHint);
        let upper = gi.upper, lower = gi.lower;
        const bendSign = Math.sign(wrapAngle(lower - upper)) || 1;
        let hand = g.handAbs !== null && g.handAbs !== undefined ? g.handAbs : lower + g.handRel * bendSign;
        let reach = g.reach;
        let handScale = g.handScale || 1;

        // Locomotion swing (θ forward-positive in local space)
        const lw = this.armLocoW[arm];
        if (lw > 0.001) {
          const la = L.arms[arm];
          const lu = la.upper + jump.armsUp * 2.1;
          const ll = lu + la.flex + jump.armsUp * 0.6;
          upper = angleLerp(upper, lu, lw);
          lower = angleLerp(lower, ll, lw);
          hand = angleLerp(hand, ll + 0.1, lw);
          reach = lerp(reach, 1, lw);
          handScale = lerp(handScale, 1, lw);
        }

        // Gesture crossfade from the snapshot taken at the switch
        if (this.armSnapshot && this.gestureBlend < 1) {
          const e = easeInOut(this.gestureBlend);
          const sn = this.armSnapshot[arm];
          upper = angleLerp(sn.upper, upper, e);
          lower = angleLerp(sn.lower, lower, e);
          hand = angleLerp(sn.hand, hand, e);
          reach = lerp(sn.reach, reach, e);
          handScale = lerp(sn.handScale ?? 1, handScale, e);
        }

        let elbow = add(sh, dir(upper), D.upperArm * reach);
        let wrist = add(elbow, dir(lower), D.forearm * reach);

        // Manual hand IK pin overrides everything
        const pin = ik[arm === 'front' ? 'frontHand' : 'backHand'];
        if (pin) {
          const outward = arm === 'front' ? -1 : 1;
          const hint = projectBody(body, outward * 70, -30, D.shoulderUp - 40);
          const sol = solveTwoBoneIK(sh, pin, D.upperArm, D.forearm, hint);
          upper = sol.upper; lower = sol.lower; elbow = sol.mid; wrist = sol.end;
          hand = lower + (g.handRel || 0) * 0.3;
          reach = 1;
          handScale = 1;
        }

        let handState = g.hand;
        if (lw > 0.5) handState = L.handState;
        if (goal.propArm === arm && goal.prop && goal.prop !== 'none') handState = 'holding_prop';
        if (handOverride[arm] !== 'auto') handState = handOverride[arm];
        if (pin && handState === 'in_pocket') handState = 'relaxed';

        let layer = 'front';
        if (arm === 'back') {
          if (this.backView) layer = 'behind';
          else if (phi < 0.42) layer = 'front';
          else layer = g.frontLayer && lw < 0.5 ? 'front' : 'behind';
        } else if (this.backView) {
          layer = 'behind';
        }

        arms[arm] = {
          shoulder: sh, elbow, wrist, upper, lower, hand, reach, handScale, handState, layer,
          prop: goal.propArm === arm ? (goal.prop || 'none') : 'none',
        };
      });
      this.lastArms = {
        front: { upper: arms.front.upper, lower: arms.front.lower, hand: arms.front.hand, reach: arms.front.reach, handScale: arms.front.handScale },
        back: { upper: arms.back.upper, lower: arms.back.lower, hand: arms.back.hand, reach: arms.back.reach, handScale: arms.back.handScale },
      };

      // ---- Drawstring anchors (collar eyelets) ----
      const stringAnchors = {
        left: projectBody(body, -7, 20, 94 + lift * 0.4),
        right: projectBody(body, 7, 20, 94 + lift * 0.4),
      };

      const J = {
        phi, c, s, br, lean, headTilt, headNod, body, pelvis: torsoOrigin, legPelvis: pel, neck, headC, headAngle,
        shoulders, arms, legs, lift, stringAnchors, goal, L, airborne: Math.max(L.flightLift, jump.lift),
        squash: jump.squash || 0, hood: this.hoodAmt,
      };

      this.effectors = {
        frontHand: arms.front.wrist,
        backHand: arms.back.wrist,
        frontFoot: legs.front.ankle,
        backFoot: legs.back.ankle,
        head: headC,
      };
      return J;
    }

    // ===== Rendering =====
    draw(ctx, p) {
      const J = this.J;
      if (!J) return;
      const scene = p.scene;
      const rig = scene.rig;
      const R = this.rootWorld;
      const S = this.S;

      // Ground shadow (shrinks while airborne / floating). When the character is light-matched the app
      // draws it separately (drawShadow) so the rim light never outlines it.
      if (!p.skipShadow) this.drawShadow(ctx, scene);

      ctx.save();
      ctx.translate(R.x + R.jitterX * S, R.y + (R.jitterY + R.floatY) * S);

      ctx.scale(this.facing * S, S * (1 - J.squash));
      if (J.squash) ctx.scale(1 + J.squash * 0.6, 1);
      this.matrix = ctx.getTransform();

      const t = p.time;
      const goal = J.goal;
      const pocketHands = ['front', 'back'].filter((a) => J.arms[a].handState === 'in_pocket');
      const sitting = this.sitW > 0.5 && this.sitPose;
      const legsFront = sitting && goal.legsFront;   // knees pulled up in front of the chest

      // 1) Back arm behind the body
      if (J.arms.back.layer === 'behind') this.drawArm(ctx, J.arms.back, true, t);
      // 2) Legs (far → near)
      if (sitting && this.sitPose.stool) window.PropPainter.drawStool(ctx);
      this.drawLeg(ctx, J.legs.back, true, J);
      if (!legsFront) this.drawLeg(ctx, J.legs.front, false, J);
      // 3) Torso hoodie base (pocket, hem, hood back)
      this.drawTorso(ctx, J);
      if (legsFront) this.drawLeg(ctx, J.legs.front, false, J, true);
      // 4) Head (hood up/down on every view) + drawstrings
      if (this.backView) {
        if (J.hood > 0.5) this.drawHoodUp(ctx, J);
        else this.drawBackHead(ctx, J);
      } else {
        this.drawNeckAndHead(ctx, J, p);
        this.drawCollarFront(ctx, J);
        this.drawStrings(ctx, J);
      }
      // 5) Desk in front of legs (typing)
      if (goal.desk && sitting && this.sitPose.stool) window.PropPainter.drawDesk(ctx, t);
      // 6) Arms in front
      if (J.arms.back.layer === 'front') this.drawArm(ctx, J.arms.back, J.phi > 0.42, t);
      if (J.arms.front.layer === 'front') this.drawArm(ctx, J.arms.front, false, t);
      else this.drawArm(ctx, J.arms.front, true, t);
      // 7) Kangaroo pocket overlay ON TOP of tucked hands
      if (pocketHands.length && !this.backView && J.c > 0.18) this.drawPocket(ctx, J, true);

      // 8) IK gizmos
      if (p.showGizmos) this.drawGizmos(ctx, J, rig);
      ctx.restore();
    }

    drawShadow(ctx, scene) {
      const J = this.J;
      const R = this.rootWorld;
      if (!J || !R || scene.background === 'green_screen') return;
      const S = this.S;
      const air = clamp((J.airborne - R.floatY) / 90, 0, 0.8);
      ctx.save();
      ctx.translate(R.x + R.jitterX * S, R.y + R.jitterY * S);
      ctx.fillStyle = `rgba(0,0,0,${(0.36 * (1 - air)).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 58 * S * (1 - air * 0.5), 8 * S * (1 - air * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- Legs, pants & sneakers ----
    drawLeg(ctx, leg, far, J, skipPelvis = false) {
      const inkW = 2.1;
      this.drawShoe(ctx, leg.ankle, leg.foot, far, J);
      const shinDir = sub(leg.ankle, leg.knee);
      const sl = Math.hypot(shinDir.x, shinDir.y) || 1;
      const cuffTop = add(leg.ankle, { x: (-shinDir.x / sl) * 9, y: (-shinDir.y / sl) * 9 });
      const thighDir = dir(leg.thigh);
      const segs = [
        skipPelvis ? null : { a: { x: J.legPelvis.x + (leg.hip.x - J.legPelvis.x) * 0.4, y: leg.hip.y - 6 }, b: leg.hip, ra: 18, rb: 18 },
        { a: skipPelvis ? add(leg.hip, thighDir, 14) : leg.hip, b: leg.knee, ra: 17.5, rb: 15, bulge: 2.5 },
        { a: leg.knee, b: cuffTop, ra: 15, rb: 13.5, bulge: 2 },
      ].filter(Boolean);
      const kneeBend = wrapAngle(leg.thigh - leg.shin);
      drawChain(ctx, segs, {
        fill: far ? PAL.pantsFar : PAL.pants, ink: PAL.pantsInk, inkW,
        shade: far ? null : 'rgba(0,0,0,0.25)', shadeSide: 1,
      });
      // Bunched jogger cuff
      drawChain(ctx, [{ a: cuffTop, b: leg.ankle, ra: 12.5, rb: 11.5, bulge: 1.5 }], {
        fill: far ? PAL.pantsFar : '#201f1c', ink: PAL.pantsInk, inkW: 1.8,
      });
      // Fabric folds: knee crease on the back of the knee, bunching above the cuff
      const fold = far ? '#22211e' : PAL.pantsFold;
      const kd = dir(leg.shin);
      const kn = { x: -kd.y, y: kd.x };
      const back = kneeBend >= 0 ? -1 : 1;
      const kc = add(leg.knee, kn, back * 6);
      strokeCurve(ctx, [add(kc, kd, -6), add(kc, kn, back * 4), add(kc, kd, 7)], fold, 1.6);
      strokeCurve(ctx, [add(leg.knee, kd, 4), add(add(leg.knee, kd, 12), kn, 3), add(add(leg.knee, kd, 20), kn, -2)], fold, 1.3);
      const ab = add(cuffTop, kd, -8);
      strokeCurve(ctx, [add(ab, kn, -10), add(add(ab, kn, -2), kd, 3), add(ab, kn, 9)], fold, 1.5);
      const td = dir(leg.thigh);
      const tn = { x: -td.y, y: td.x };
      const mid = add(leg.hip, td, 30);
      strokeCurve(ctx, [add(mid, tn, -9), add(add(mid, tn, -3), td, 5), add(add(mid, tn, 6), td, 2)], fold, 1.3);
    }

    drawShoe(ctx, ankle, footAngle, far, J) {
      const prof = J.s;
      ctx.save();
      ctx.translate(ankle.x, ankle.y);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.shoeInk;
      ctx.lineWidth = 2;
      const upper = far ? PAL.shoeFar : PAL.shoe;
      const mids = far ? PAL.midsoleFar : PAL.midsole;
      if (prof < 0.45) {
        // Front-facing sneaker (toe toward the viewer)
        ctx.rotate(footAngle * 0.2);
        const w = 14 + prof * 8;
        ctx.beginPath();
        ctx.moveTo(-w, 7);
        ctx.quadraticCurveTo(-w - 1, -4, -7, -6);
        ctx.lineTo(7, -6);
        ctx.quadraticCurveTo(w + 1, -4, w, 7);
        ctx.closePath();
        ctx.fillStyle = upper;
        ctx.fill();
        ctx.stroke();
        // midsole
        ctx.beginPath();
        ctx.roundRect(-w - 1.5, 6, w * 2 + 3, 5.5, 2.5);
        ctx.fillStyle = mids;
        ctx.fill();
        ctx.stroke();
        // laces & tongue
        ctx.strokeStyle = PAL.laces;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-4, -3 + i * 2.8);
          ctx.lineTo(4, -2 + i * 2.8);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(0, 8, w * 0.65, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else {
        // Profile sneaker, rolls at the ankle joint
        ctx.rotate(footAngle);
        ctx.scale(clamp(prof, 0.55, 1), 1);
        ctx.beginPath();
        ctx.moveTo(-8, -4);
        ctx.quadraticCurveTo(-12, -1, -11, 6);
        ctx.lineTo(-10, 10);
        ctx.lineTo(26, 10);
        ctx.quadraticCurveTo(32, 9, 31, 4);
        ctx.quadraticCurveTo(30, 0, 23, -1);
        ctx.quadraticCurveTo(12, -2, 6, -7);
        ctx.lineTo(-2, -7);
        ctx.closePath();
        ctx.fillStyle = upper;
        ctx.fill();
        ctx.stroke();
        // Midsole band + tread
        ctx.beginPath();
        ctx.moveTo(-11, 6);
        ctx.lineTo(29, 6);
        ctx.quadraticCurveTo(32, 8, 29, 10.5);
        ctx.lineTo(-10, 10.5);
        ctx.quadraticCurveTo(-12, 8, -11, 6);
        ctx.closePath();
        ctx.fillStyle = mids;
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        for (let x = -6; x < 27; x += 5) {
          ctx.beginPath();
          ctx.moveTo(x, 10.3);
          ctx.lineTo(x + 1.5, 8.2);
          ctx.stroke();
        }
        // Toe cap
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(23, 6);
        ctx.quadraticCurveTo(20, 1, 25, -0.5);
        ctx.stroke();
        // Laces
        ctx.strokeStyle = PAL.laces;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const x = 7 + i * 4.5;
          const y = -5.4 + i * 1.7;
          ctx.beginPath();
          ctx.moveTo(x - 1.5, y - 1.6);
          ctx.lineTo(x + 2.5, y + 1.2);
          ctx.stroke();
        }
        // Collar
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-7, -3);
        ctx.quadraticCurveTo(-1, 0, 4, -5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- Torso / hoodie ----
    torsoOutline(J) {
      const c = J.c, s = J.s;
      const hem = this.cloth.hem.x;
      const right = [], left = [];
      TORSO_PROFILE.forEach((lv) => {
        let up = lv.up;
        if (up > 0) up *= 1 + J.br * 0.01;
        if (up >= 78) up += J.lift;
        const half = Math.sqrt((lv.w * c) ** 2 + (lv.d * s) ** 2);
        const sway = hem * clamp(1 - (lv.up + 17) / 70, 0, 1);
        const fe = half + lv.fb * s;
        const be = half + lv.bb * s;
        right.push({ x: fe + sway, y: -up });
        left.unshift({ x: -be + sway, y: -up });
      });
      // Gentle convex hem bottom
      const bottom = { x: (right[0].x + left[left.length - 1].x) / 2, y: right[0].y + 3 };
      return [bottom, ...right, ...left];
    }

    drawTorso(ctx, J) {
      ctx.save();
      ctx.translate(J.pelvis.x, J.pelvis.y);
      ctx.rotate(J.lean);
      const pts = this.torsoOutline(J);
      const maxX = Math.max(...pts.map((p) => p.x));
      const minX = Math.min(...pts.map((p) => p.x));

      // Hood bunched behind the neck (drawn first so the torso shoulders overlap it)
      if (!this.backView && (J.hood || 0) < 0.5) this.drawHoodBack(ctx, J);

      ctx.beginPath();
      smoothClosedPath(ctx, pts);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.fillStyle = PAL.hoodie;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Soft side shading (form): both sides in front view, back side when turned
      const g = ctx.createLinearGradient(minX, 0, maxX, 0);
      g.addColorStop(0, 'rgba(46, 43, 38, 0.55)');
      g.addColorStop(0.22, 'rgba(46, 43, 38, 0)');
      g.addColorStop(lerp(0.78, 0.92, J.s), 'rgba(46, 43, 38, 0)');
      g.addColorStop(1, `rgba(46, 43, 38, ${lerp(0.4, 0.15, J.s).toFixed(2)})`);
      ctx.fillStyle = g;
      ctx.fillRect(minX - 2, -130, maxX - minX + 4, 160);
      // Ribbed hem band
      const hemTop = -7;
      ctx.fillStyle = PAL.rib;
      ctx.fillRect(minX - 2, -hemTop, maxX - minX + 4, 20);
      ctx.strokeStyle = 'rgba(40, 38, 34, 0.35)';
      ctx.lineWidth = 1;
      for (let x = minX + 4; x < maxX; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, 18);
        ctx.stroke();
      }
      // Fold lines (blousing above the hem, armpit drag folds)
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      const folds = [
        [[minX + 8, -2], [minX + 16, -8], [minX + 26, -3]],
        [[maxX - 30, -2], [maxX - 20, -9], [maxX - 9, -3]],
        [[minX + 6, -66], [minX + 13, -58], [minX + 12, -44]],
        [[maxX - 6, -66], [maxX - 13, -58], [maxX - 12, -44]],
        [[-6 + J.s * 10, -4], [2 + J.s * 10, -10], [10 + J.s * 10, -5]],
      ];
      folds.forEach((f) => {
        ctx.beginPath();
        ctx.moveTo(f[0][0], f[0][1]);
        ctx.quadraticCurveTo(f[1][0], f[1][1], f[2][0], f[2][1]);
        ctx.stroke();
      });
      ctx.restore();
      // Outline + hem seam
      ctx.beginPath();
      smoothClosedPath(ctx, pts);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(minX + 3, 7);
      ctx.quadraticCurveTo((minX + maxX) / 2, 9, maxX - 3, 7);
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.restore();

      if (!this.backView && J.c > 0.18) this.drawPocket(ctx, J, false);
      if (this.backView) this.drawBackDetails(ctx, J);
    }

    pocketPoints(J) {
      const c = J.c, s = J.s;
      const surf = (lat) => 30 * Math.sqrt(Math.max(0, 1 - (lat / 49) ** 2)) + 6;
      const P = (lat, up) => projectBody(J.body, lat, surf(lat), up);
      return {
        outline: [P(-21, 46), P(21, 46), P(30, 22), P(33, 8), P(31, 2), P(-31, 2), P(-33, 8), P(-30, 22)],
        openL: [P(-21, 46), P(-27, 30), P(-33, 9)],
        openR: [P(21, 46), P(27, 30), P(33, 9)],
        stitch: [P(-18, 42), P(18, 42)],
        visibleL: -c * 1 + s * 0.2 < 0.95,
        c, s,
      };
    }

    drawPocket(ctx, J, overlay) {
      const pp = this.pocketPoints(J);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pp.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = PAL.pocket;
      ctx.fill();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // Pocket shading at the bottom + opening shadows
      ctx.save();
      ctx.clip();
      const top = pp.outline[0].y, bot = pp.outline[4].y;
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(30,28,25,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(-80, top - 2, 200, bot - top + 4);
      ctx.restore();
      // Side openings (thick ink) with inner dark lip
      [pp.openL, pp.openR].forEach((o) => {
        ctx.beginPath();
        ctx.moveTo(o[0].x, o[0].y);
        ctx.quadraticCurveTo(o[1].x, o[1].y, o[2].x, o[2].y);
        ctx.strokeStyle = '#2b2925';
        ctx.lineWidth = 4.2;
        ctx.stroke();
        ctx.strokeStyle = PAL.hoodieInk;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      });
      // Top stitch line
      ctx.setLineDash([2.5, 3]);
      ctx.strokeStyle = 'rgba(40,38,34,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pp.stitch[0].x, pp.stitch[0].y);
      ctx.lineTo(pp.stitch[1].x, pp.stitch[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (overlay) {
        // Fabric bulge where the hands are tucked
        ctx.strokeStyle = PAL.hoodieShade;
        ctx.lineWidth = 1.5;
        const m = projectBody(J.body, 0, 36, 22);
        ctx.beginPath();
        ctx.moveTo(m.x - 14, m.y + 6);
        ctx.quadraticCurveTo(m.x - 4, m.y - 1, m.x + 2, m.y + 8);
        ctx.moveTo(m.x + 6, m.y + 4);
        ctx.quadraticCurveTo(m.x + 12, m.y - 2, m.x + 18, m.y + 6);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawHoodBack(ctx, J) {
      // In torso-local space (ctx already translated/rotated to pelvis frame)
      const s = J.s, c = J.c;
      const up = 104 + J.lift + this.cloth.hood.x;
      const cx = -16 * s;
      const w = lerp(37, 26, s);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.ellipse(cx, -up, w, 21 + s * 6, -0.2 * s, 0, Math.PI * 2);
      ctx.fillStyle = PAL.hoodieFar;
      ctx.fill();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      // Hood interior (dark) visible around the neck
      ctx.beginPath();
      ctx.ellipse(cx + 8 * s, -up + 3, w * 0.62, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = PAL.hoodInside;
      ctx.fill();
      // Fold strokes
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.85, -up + 4);
      ctx.quadraticCurveTo(cx - w * 0.7, -up - 10, cx - w * 0.4, -up - 16);
      ctx.moveTo(cx + w * 0.85 * c, -up + 4);
      ctx.quadraticCurveTo(cx + w * 0.7 * c, -up - 10, cx + w * 0.4 * c, -up - 16);
      ctx.stroke();
      ctx.restore();
    }

    drawCollarFront(ctx, J) {
      // Front opening of the hood: two flaps crossing at the neckline
      const s = J.s, c = J.c;
      const P = (lat, z, up) => projectBody(J.body, lat, z, up + J.lift);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const flap = (sgn) => {
        const a = P(sgn * 27, 6, 99);
        const b = P(sgn * 12, 20, 103);
        const tip = P(-sgn * 3, 22, 90);
        const inner = P(sgn * 6, 18, 95);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(b.x, b.y, tip.x, tip.y);
        ctx.quadraticCurveTo(inner.x, inner.y, P(sgn * 22, 4, 92).x, P(sgn * 22, 4, 92).y);
        ctx.closePath();
        ctx.fillStyle = PAL.hoodie;
        ctx.fill();
        ctx.strokeStyle = PAL.hoodieInk;
        ctx.lineWidth = 2.1;
        ctx.stroke();
      };
      if (c > 0.2) {
        flap(1);
        flap(-1);
      } else {
        // Profile: a single rounded collar edge in front of the neck
        const a = P(0, 22, 102), b = P(0, 30, 92), d = P(0, 14, 88);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(b.x + 4, b.y, d.x, d.y);
        ctx.strokeStyle = PAL.hoodieInk;
        ctx.lineWidth = 2.1;
        ctx.stroke();
      }
      // Eyelets
      ctx.fillStyle = '#2b2925';
      [J.stringAnchors.left, J.stringAnchors.right].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    drawStrings(ctx, J) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ['left', 'right'].forEach((side) => {
        const pts = this.cloth.points(side);
        if (!this.cloth.ropes[side].ready) return;
        const path = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        };
        path();
        ctx.strokeStyle = 'rgba(20,19,17,0.85)';
        ctx.lineWidth = 3.8;
        ctx.stroke();
        path();
        ctx.strokeStyle = PAL.string;
        ctx.lineWidth = 2.1;
        ctx.stroke();
        // Aglet
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        const d = sub(b, a);
        const l = Math.hypot(d.x, d.y) || 1;
        const e = add(b, { x: d.x / l, y: d.y / l }, 4.5);
        ctx.strokeStyle = '#1a1917';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.strokeStyle = PAL.aglet;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      });
      ctx.restore();
    }

    drawNeckAndHead(ctx, J, p) {
      const R = D.headRx, Ry = D.headRy;
      const hood = J.hood || 0;
      // Neck
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.skin;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(J.neck.x, J.neck.y + 6);
      const nTop = add(J.neck, rotate({ x: 0, y: -18 }, J.headAngle));
      ctx.lineTo(nTop.x, nTop.y);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(J.headC.x, J.headC.y);
      ctx.rotate(J.headAngle);
      // Hood shell behind the head (rises from the neck while it is being pulled up)
      if (hood > 0.02) this.drawHoodShell(ctx, hood);
      // Head sphere
      const g = ctx.createRadialGradient(-R * 0.35, -Ry * 0.4, R * 0.1, 0, 0, R * 1.05);
      g.addColorStop(0, '#1d1d22');
      g.addColorStop(0.55, '#0b0b0d');
      g.addColorStop(1, '#050506');
      ctx.beginPath();
      ctx.ellipse(0, 0, R, Ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Hood front opening framing the face
      if (hood > 0.55) this.drawHoodRim(ctx, hood);
      // Face (reuses the v1 glowing face renderer). Skipped when the light-match pass re-draws it
      // un-graded on top so the eyes keep glowing in dark photos.
      if (!p.skipFace) this.drawFace(ctx, J, p);
      ctx.restore();
    }

    hoodOutlinePath(ctx, hood) {
      const k = smoothstep(0.08, 0.86, this.turn);
      const pr = smoothstep(0, 1, hood);
      const off = (1 - pr) * 26;
      const cx = -7 * k, cy = -4 + off;
      const sc = 0.78 + 0.22 * pr;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sc, sc);
      ctx.moveTo(-38, 36);
      ctx.bezierCurveTo(-50, 6, -44, -42, -4 - 6 * k, -49);
      ctx.quadraticCurveTo(2 - 4 * k, -51, 6, -48);
      ctx.bezierCurveTo(44, -42, 50, 6, 38, 36);
      ctx.quadraticCurveTo(0, 48, -38, 36);
      ctx.closePath();
      ctx.restore();
    }

    drawHoodShell(ctx, hood) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.hoodOutlinePath(ctx, hood);
      ctx.fillStyle = PAL.hoodie;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const g = ctx.createRadialGradient(-12, -24, 6, 0, 0, 60);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(40,38,34,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(-70, -70, 140, 130);
      ctx.restore();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.restore();
    }

    drawHoodRim(ctx, hood) {
      const R = D.headRx;
      const k = smoothstep(0.08, 0.86, this.turn);
      const ox = 0.4 * R * k, oy = 3;
      const orx = lerp(30, 20, k), ory = lerp(33, 31, k);
      ctx.save();
      ctx.globalAlpha = smoothstep(0.55, 0.9, hood);
      ctx.lineJoin = 'round';
      // Ring = hood outline minus the face opening (even-odd)
      ctx.beginPath();
      this.hoodOutlinePath(ctx, hood);
      ctx.ellipse(ox, oy, orx, ory, 0, 0, Math.PI * 2);
      ctx.fillStyle = PAL.hoodie;
      ctx.fill('evenodd');
      ctx.save();
      ctx.clip('evenodd');
      // Shadowed inner lip of the hood
      ctx.strokeStyle = 'rgba(30,28,25,0.6)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(ox, oy, orx + 3, ory + 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      this.hoodOutlinePath(ctx, hood);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(ox, oy, orx, ory, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Fabric folds on the sides of the hood
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox - orx - 4, oy - 18);
      ctx.quadraticCurveTo(ox - orx - 9, oy, ox - orx - 5, oy + 20);
      if (k < 0.6) {
        ctx.moveTo(ox + orx + 4, oy - 18);
        ctx.quadraticCurveTo(ox + orx + 9, oy, ox + orx + 5, oy + 20);
      }
      ctx.moveTo(-14 - 8 * k, -38);
      ctx.quadraticCurveTo(-4 - 8 * k, -44, 8 - 8 * k, -40);
      ctx.stroke();
      ctx.restore();
    }

    drawFace(ctx, J, p) {
      if (!this.face || !this.face.ready) return;
      const R = D.headRx, Ry = D.headRy;
      const audio = p.audio || {};
      const scene = p.scene;
      const nodY = J.headNod * Ry * 0.9;
      const t = this.turn;
      if (t > 0.86) {
        ctx.save();
        ctx.translate(0, nodY);
        ctx.scale(-1, 1);
        this.face.renderSideFace(ctx, 0, 0, R, Ry, scene.emotion, audio.mouthOpen || 0, p.time);
        ctx.restore();
      } else {
        ctx.save();
        const k = smoothstep(0.08, 0.86, t);
        ctx.translate(R * 0.4 * k, nodY);
        ctx.scale(1 - 0.4 * k, 1 - Math.abs(J.headNod) * 0.15);
        if (this.facing < 0 && k < 0.05) ctx.scale(-1, 1);
        const faceMode = k > 0.05 ? 'procedural' : p.faceMode;
        this.face.renderFrontFace(ctx, 0, 0, R, Ry, scene.emotion, audio.mouthOpen || 0, audio.mouthForm || 0.5, p.time, faceMode);
        ctx.restore();
      }
    }

    // Re-draw only the glowing face, un-graded, on top of a light-matched character.
    drawFaceOverlay(ctx, p) {
      const J = this.J;
      if (!J || !this.matrix || this.backView) return;
      ctx.save();
      ctx.setTransform(this.matrix);
      ctx.translate(J.headC.x, J.headC.y);
      ctx.rotate(J.headAngle);
      this.drawFace(ctx, J, p);
      ctx.restore();
    }

    // Glowing face would wrongly sit on top of a hand covering it → the overlay pass is skipped then.
    faceOverlayAllowed(scene) {
      return !['facepalm'].includes(scene.rig?.gesture) && !(scene.rig?.prop === 'mic');
    }

    // Phone screen light: soft blue/white cone + head rim light + hoodie glow (additive)
    drawLightFX(ctx, p) {
      const J = this.J;
      if (!J || !this.matrix) return;
      const arm = ['front', 'back'].map((a) => J.arms[a]).find((a) => a.prop === 'phone' && a.handState === 'holding_prop');
      if (!arm) return;
      const I = Math.max(J.goal.phoneLight || 0, 0.35) * (0.93 + 0.07 * Math.sin(p.time * 3.1)) * (p.lightBoost ?? 1);
      const grip = add(arm.wrist, dir(arm.hand), 10);
      const r = wrapAngle(Math.PI - arm.hand) * 0.18;
      const scr = add(grip, rotate({ x: 0.5, y: -17 }, r));
      const H = J.headC;
      const R = D.headRx, Ry = D.headRy;
      ctx.save();
      ctx.setTransform(this.matrix);
      ctx.globalCompositeOperation = 'lighter';
      // Pool of light around the screen
      let g = ctx.createRadialGradient(scr.x, scr.y, 2, scr.x, scr.y, 75);
      g.addColorStop(0, `rgba(170, 205, 255, ${(0.26 * I).toFixed(3)})`);
      g.addColorStop(1, 'rgba(120, 170, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(scr.x - 80, scr.y - 80, 160, 160);
      // Directional cone toward the face
      const dv = sub(H, scr);
      const dl = Math.hypot(dv.x, dv.y) || 1;
      const d = { x: dv.x / dl, y: dv.y / dl };
      const n = { x: -d.y, y: d.x };
      const L = dl + 40;
      const far = add(scr, d, L);
      ctx.beginPath();
      ctx.moveTo(scr.x + n.x * 6, scr.y + n.y * 6);
      ctx.lineTo(scr.x - n.x * 6, scr.y - n.y * 6);
      ctx.lineTo(far.x - n.x * 56, far.y - n.y * 56);
      ctx.lineTo(far.x + n.x * 56, far.y + n.y * 56);
      ctx.closePath();
      g = ctx.createLinearGradient(scr.x, scr.y, far.x, far.y);
      g.addColorStop(0, `rgba(175, 210, 255, ${(0.17 * I).toFixed(3)})`);
      g.addColorStop(1, 'rgba(175, 210, 255, 0)');
      ctx.fillStyle = g;
      ctx.fill();
      // Hoodie upper-body glow
      g = ctx.createRadialGradient(scr.x, scr.y + 10, 4, scr.x, scr.y + 10, 125);
      g.addColorStop(0, `rgba(110, 160, 255, ${(0.1 * I).toFixed(3)})`);
      g.addColorStop(1, 'rgba(110, 160, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(scr.x - 130, scr.y - 120, 260, 260);
      // Face under-light + rim on the side of the head facing the phone
      if (!this.backView) {
        ctx.translate(H.x, H.y);
        ctx.rotate(J.headAngle);
        const q = rotate(sub(scr, H), -J.headAngle);
        ctx.beginPath();
        ctx.ellipse(0, 0, R + 1, Ry + 1, 0, 0, Math.PI * 2);
        ctx.save();
        ctx.clip();
        g = ctx.createRadialGradient(q.x, q.y, 4, q.x, q.y, Math.hypot(q.x, q.y) + R * 0.6);
        g.addColorStop(0, `rgba(130, 175, 255, ${(0.2 * I).toFixed(3)})`);
        g.addColorStop(1, 'rgba(130, 175, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(-R - 4, -Ry - 4, R * 2 + 8, Ry * 2 + 8);
        ctx.restore();
        const ql = Math.hypot(q.x, q.y) || 1;
        g = ctx.createLinearGradient((q.x / ql) * R, (q.y / ql) * Ry, (-q.x / ql) * R * 0.2, (-q.y / ql) * Ry * 0.2);
        g.addColorStop(0, `rgba(195, 225, 255, ${(0.45 * I).toFixed(3)})`);
        g.addColorStop(1, 'rgba(195, 225, 255, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, R - 1, Ry - 1, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawGizmoOverlay(ctx, rig) {
      if (!this.J || !this.matrix) return;
      ctx.save();
      ctx.setTransform(this.matrix);
      this.drawGizmos(ctx, this.J, rig);
      ctx.restore();
    }

    // Back view with the hood DOWN: back of the bare black head + hood bunched on the upper back
    drawBackHead(ctx, J) {
      const R = D.headRx, Ry = D.headRy;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.skin;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(J.neck.x, J.neck.y + 6);
      const nTop = add(J.neck, rotate({ x: 0, y: -18 }, J.headAngle));
      ctx.lineTo(nTop.x, nTop.y);
      ctx.stroke();
      ctx.translate(J.headC.x, J.headC.y);
      ctx.rotate(J.headAngle);
      const g = ctx.createRadialGradient(-R * 0.3, -Ry * 0.4, R * 0.1, 0, 0, R * 1.05);
      g.addColorStop(0, '#1b1b20');
      g.addColorStop(1, '#050506');
      ctx.beginPath();
      ctx.ellipse(0, 0, R, Ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      // Bunched hood lying on the upper back, overlapping the neck
      const c = projectBody(J.body, 0, -14, 100 + J.lift + this.cloth.hood.x);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(J.lean);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-34, 6);
      ctx.bezierCurveTo(-38, -14, -14, -22, 0, -20);
      ctx.bezierCurveTo(14, -22, 38, -14, 34, 6);
      ctx.quadraticCurveTo(0, 22, -34, 6);
      ctx.closePath();
      ctx.fillStyle = PAL.hoodie;
      ctx.fill();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-22, -6);
      ctx.quadraticCurveTo(-8, 4, 0, -2);
      ctx.moveTo(4, 2);
      ctx.quadraticCurveTo(14, 8, 24, -4);
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(-2, 0, 1, 14);
      ctx.stroke();
      ctx.restore();
    }

    drawHoodUp(ctx, J) {
      // Back view: the hood is pulled up over the head
      ctx.save();
      ctx.translate(J.headC.x, J.headC.y + 2 + this.cloth.hood.x * 0.5);
      ctx.rotate(J.headAngle);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-36, 34);
      ctx.bezierCurveTo(-48, 6, -42, -40, -4, -47);
      ctx.quadraticCurveTo(2, -49, 6, -46);
      ctx.bezierCurveTo(42, -40, 48, 6, 36, 34);
      ctx.quadraticCurveTo(0, 46, -36, 34);
      ctx.closePath();
      ctx.fillStyle = PAL.hoodie;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const g = ctx.createRadialGradient(-10, -20, 6, 0, 0, 56);
      g.addColorStop(0, 'rgba(255,255,255,0.06)');
      g.addColorStop(1, 'rgba(40,38,34,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(-60, -60, 120, 110);
      ctx.restore();
      ctx.strokeStyle = PAL.hoodieInk;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      // Centre seam + folds
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(1, -46);
      ctx.quadraticCurveTo(-2, -6, 0, 38);
      ctx.moveTo(-30, 22);
      ctx.quadraticCurveTo(-20, 14, -12, 30);
      ctx.moveTo(30, 22);
      ctx.quadraticCurveTo(20, 14, 12, 30);
      ctx.stroke();
      ctx.restore();
    }

    drawBackDetails(ctx, J) {
      // Shoulder seams on the back of the hoodie
      const P = (lat, up) => projectBody(J.body, lat, -20, up + J.lift);
      ctx.save();
      ctx.strokeStyle = PAL.hoodieShade;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      [[-1], [1]].forEach(([sg]) => {
        const a = P(sg * 38, 84), b = P(sg * 30, 62), d = P(sg * 34, 40);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(b.x, b.y, d.x, d.y);
        ctx.stroke();
      });
      ctx.restore();
    }

    // ---- Arms, sleeves & hands ----
    drawArm(ctx, arm, far, t) {
      const fill = far ? PAL.hoodieFar : PAL.hoodie;
      const shade = far ? 'rgba(30,28,25,0.35)' : 'rgba(46,43,38,0.38)';
      const reach = arm.reach;
      const dLower = dir(arm.lower);
      const cuffStart = add(arm.wrist, dLower, -9 * reach);
      const cuffEnd = add(arm.wrist, dLower, 1.5);
      const hidden = arm.handState === 'in_pocket';

      // Sleeve (shoulder → elbow → cuff) as one silhouette
      const shDir = sub(arm.elbow, arm.shoulder);
      const top = add(arm.shoulder, { x: -shDir.x, y: -shDir.y }, 0.08);
      drawChain(ctx, [
        { a: top, b: arm.elbow, ra: 15.5, rb: 13.5, bulge: 3 },
        { a: arm.elbow, b: cuffStart, ra: 13.5, rb: 12.5, bulge: 3.2 },
      ], { fill, ink: PAL.hoodieInk, inkW: 2.3, shade, shadeSide: wrapAngle(arm.lower - arm.upper) >= 0 ? -1 : 1 });

      // Prop + hand (hand before cuff so the cuff overlaps the wrist)
      if (!hidden) {
        if (arm.prop && arm.prop !== 'none') {
          ctx.save();
          const grip = add(arm.wrist, dir(arm.hand), 10);
          ctx.translate(grip.x, grip.y);
          ctx.rotate(wrapAngle(Math.PI - arm.hand) * 0.18);
          window.PropPainter.draw(ctx, arm.prop, t);
          ctx.restore();
        }
        this.drawHand(ctx, arm.wrist, arm.hand, arm.handState, far, reach, arm.handScale || 1);
      }

      // Ribbed cuff
      drawChain(ctx, [{ a: cuffStart, b: cuffEnd, ra: 10, rb: 9.2 }], { fill: far ? '#625e57' : PAL.rib, ink: PAL.hoodieInk, inkW: 2 });
      ctx.save();
      ctx.strokeStyle = 'rgba(30,28,25,0.45)';
      ctx.lineWidth = 1;
      const n = { x: -dLower.y, y: dLower.x };
      for (let i = -2; i <= 2; i++) {
        const base = add(add(cuffStart, dLower, 2.5), n, i * 3.4);
        const e = add(base, dLower, 5);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      }
      ctx.restore();

      // Sleeve folds: elbow crease on the inside of the bend, bunching above the cuff
      const bend = wrapAngle(arm.lower - arm.upper);
      const inner = bend >= 0 ? 1 : -1;
      const dU = dir(arm.upper);
      const nU = { x: -dU.y, y: dU.x };
      const ec = add(arm.elbow, nU, inner * 7);
      const foldC = far ? PAL.hoodieShadeFar : PAL.hoodieShade;
      strokeCurve(ctx, [add(ec, dU, -9), add(add(ec, nU, inner * -4), dU, -1), add(ec, dLower, 8)], foldC, 1.7);
      const cb = add(cuffStart, dLower, -8);
      strokeCurve(ctx, [add(cb, n, -9), add(add(cb, n, -2), dLower, 4), add(cb, n, 7)], foldC, 1.5);
      const mu = add(arm.shoulder, dU, 26);
      strokeCurve(ctx, [add(mu, nU, -inner * 10), add(add(mu, nU, -inner * 4), dU, 5), add(add(mu, nU, inner * 3), dU, 9)], foldC, 1.4);
    }

    drawHand(ctx, wrist, angle, state, far, reach = 1, handScale = 1) {
      ctx.save();
      ctx.translate(wrist.x, wrist.y);
      ctx.rotate(-angle);
      const sc = (0.92 + 0.08 * reach) * handScale;
      ctx.scale(sc, sc * (reach < 0.9 && handScale <= 1 ? 0.85 : 1));
      ctx.fillStyle = PAL.skin;
      ctx.strokeStyle = far ? '#000' : PAL.skinRim;
      ctx.lineWidth = 1.1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const finger = (x0, y0, ang, len, w) => {
        const tip = { x: x0 + Math.sin(ang) * len, y: y0 + Math.cos(ang) * len };
        ctx.beginPath();
        capsulePath(ctx, { x: x0, y: y0 }, tip, w / 2, w / 2 * 0.9);
        ctx.fill();
        ctx.stroke();
      };
      const palm = (w = 13, h = 13) => {
        ctx.beginPath();
        ctx.roundRect(-w / 2, -1, w, h, 5);
        ctx.fill();
        ctx.stroke();
      };
      switch (state) {
        case 'open_palm': {
          finger(5.5, 4, 0.95, 8, 4);                   // thumb
          [-0.3, -0.1, 0.1, 0.28].forEach((a, i) => finger(-4.6 + i * 3.07, 10, a, [8, 9.5, 9, 7.2][i], 4.2));
          palm(13, 13);
          ctx.fillRect(-6, 4, 12, 7);
          break;
        }
        case 'pointing': {
          finger(-3.5, 10, 0.02, 14, 3.6);              // index finger
          ctx.beginPath();
          ctx.roundRect(-6.5, -1, 13, 14, 5.5);
          ctx.fill();
          ctx.stroke();
          ctx.fillRect(-5.5, 3, 11, 8);
          finger(5, 3, 0.6, 7, 4);                      // thumb
          ctx.strokeStyle = '#26262c';
          ctx.beginPath();
          ctx.moveTo(-1, 11);
          ctx.lineTo(5, 11);
          ctx.stroke();
          break;
        }
        case 'fist': {
          ctx.beginPath();
          ctx.roundRect(-7, -1, 14, 15, 6);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = '#2a2a30';
          ctx.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-6 + i * 4, 9);
            ctx.lineTo(-4 + i * 4, 13.5);
            ctx.stroke();
          }
          finger(5.5, 2, 0.35, 7, 4.2);
          break;
        }
        case 'holding_prop': {
          palm(13, 12);
          ctx.beginPath();
          ctx.lineWidth = 5;
          ctx.strokeStyle = PAL.skin;
          ctx.arc(-1, 12, 7, -0.2, Math.PI * 0.95);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#26262c';
          ctx.stroke();
          finger(6, 4, 0.2, 9, 4);
          break;
        }
        case 'in_pocket': {
          palm(12, 8);
          break;
        }
        case 'relaxed':
        default: {
          palm(13, 13);
          ctx.beginPath();
          ctx.moveTo(-6.5, 9);
          ctx.quadraticCurveTo(-7.5, 20, -1, 21);
          ctx.quadraticCurveTo(6, 21, 5.5, 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillRect(-5.5, 6, 11, 7);
          finger(6, 3, 0.45, 8, 4);
          ctx.strokeStyle = '#26262c';
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(-3, 15);
          ctx.lineTo(-2, 19);
          ctx.moveTo(1, 15);
          ctx.lineTo(1.5, 19.5);
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }

    // ---- IK gizmos & hit testing ----
    drawGizmos(ctx, J, rig) {
      const S = this.S;
      const px = 1 / S;
      ctx.save();
      ctx.lineCap = 'round';
      const bone = (a, b) => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      ctx.strokeStyle = 'rgba(56, 220, 255, 0.85)';
      ctx.lineWidth = 2.2 * px;
      ['front', 'back'].forEach((k) => {
        const a = J.arms[k];
        bone(a.shoulder, a.elbow);
        bone(a.elbow, a.wrist);
        const l = J.legs[k];
        bone(J.legPelvis, l.hip);
        bone(l.hip, l.knee);
        bone(l.knee, l.ankle);
      });
      bone(J.pelvis, J.neck);
      bone(J.neck, J.headC);
      ctx.fillStyle = 'rgba(56, 220, 255, 0.95)';
      const joints = [J.pelvis, J.neck, J.arms.front.shoulder, J.arms.back.shoulder, J.arms.front.elbow, J.arms.back.elbow,
        J.legs.front.hip, J.legs.back.hip, J.legs.front.knee, J.legs.back.knee];
      joints.forEach((j) => {
        ctx.beginPath();
        ctx.arc(j.x, j.y, 3.5 * px, 0, Math.PI * 2);
        ctx.fill();
      });
      const ik = rig.ik || {};
      const labels = { frontHand: 'R hand', backHand: 'L hand', frontFoot: 'R foot', backFoot: 'L foot', head: 'Head' };
      Object.entries(this.effectors).forEach(([key, pt]) => {
        const pinned = !!ik[key];
        const active = key === this.hoverKey || key === this.dragKey;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (key === 'head' ? 13 : 9) * px * (active ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fillStyle = pinned ? 'rgba(251, 146, 60, 0.55)' : 'rgba(56, 220, 255, 0.18)';
        ctx.fill();
        ctx.lineWidth = 2.4 * px;
        ctx.strokeStyle = pinned ? '#fb923c' : '#38dcff';
        ctx.stroke();
        if (active || pinned) {
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.scale(this.facing, 1);
          ctx.font = `${700} ${11 * px}px system-ui, sans-serif`;
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3 * px;
          const label = labels[key] + (pinned ? ' 📌' : '');
          ctx.strokeText(label, 12 * px, -10 * px);
          ctx.fillText(label, 12 * px, -10 * px);
          ctx.restore();
        }
      });
      ctx.restore();
    }

    canvasToLocal(cx, cy) {
      if (!this.matrix) return null;
      const inv = this.matrix.inverse();
      return { x: inv.a * cx + inv.c * cy + inv.e, y: inv.b * cx + inv.d * cy + inv.f };
    }

    hitTest(cx, cy) {
      const p = this.canvasToLocal(cx, cy);
      if (!p) return null;
      let best = null, bestD = Infinity;
      const tol = 22 / Math.max(0.2, this.S);
      Object.entries(this.effectors).forEach(([key, pt]) => {
        const d = dist(p, pt);
        const r = key === 'head' ? tol * 1.4 : tol;
        if (d < r && d < bestD) {
          best = key;
          bestD = d;
        }
      });
      return best;
    }

    dragEffector(key, cx, cy, rig) {
      const p = this.canvasToLocal(cx, cy);
      if (!p) return;
      rig.ik = rig.ik || {};
      if (key === 'frontFoot' || key === 'backFoot') p.y = Math.min(p.y, -D.ankleH + 0.5);
      rig.ik[key] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    }

    // Character anchor points in pre-camera screen space (for camera focus, spotlight, cards)
    screenPoint(local) {
      const R = this.rootWorld;
      if (!R) return null;
      return {
        x: R.x + R.jitterX * this.S + this.facing * local.x * this.S,
        y: R.y + (R.jitterY + R.floatY) * this.S + local.y * this.S,
      };
    }
    headScreen() { return this.J ? this.screenPoint(this.J.headC) : null; }
    chestScreen() { return this.J ? this.screenPoint(this.J.neck) : null; }
  }

  window.RigCharacter = RigCharacter;
})();
