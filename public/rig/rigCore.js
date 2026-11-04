// rigCore.js — Math, 2-bone analytic IK, springs & rig dimensions for the Sticky Hoodie skeletal rig.
//
// Conventions (used by every rig module):
//   * "Local rig space" = character units (~1 unit ≈ 1px of the original 358px sprite).
//     Origin is the ground point between the feet, +x = the direction the character FACES,
//     +y = DOWN (canvas convention). The renderer mirrors the whole rig for left-facing.
//   * Bone angle θ is measured from STRAIGHT DOWN. Direction vector = (sin θ, cos θ).
//     θ > 0 swings the bone forward (+x), θ < 0 swings it backward.
//   * Body-relative coordinates (lat, z, up): lat = character's lateral axis (+lat = character's LEFT,
//     which is screen-right in the front view), z = forward (toward the viewer in the front view),
//     up = height above the pelvis. `projectBody` converts them to local rig space for any view turn.
(function () {
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  const dir = (theta) => ({ x: Math.sin(theta), y: Math.cos(theta) });
  const angleOf = (dx, dy) => Math.atan2(dx, dy);
  const add = (p, v, s = 1) => ({ x: p.x + v.x * s, y: p.y + v.y * s });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  const rotate = (p, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  };
  // Transform a point from a frame (origin + canvas rotation) into its parent space.
  const xform = (origin, angle, local) => add(origin, rotate(local, angle));
  const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;
  // Frame-rate independent exponential damping toward a target.
  const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
  const dampAngle = (cur, target, rate, dt) => angleLerp(cur, target, 1 - Math.exp(-rate * dt));

  // Damped spring "settle" curve: 0 → 1 with overshoot. t in seconds.
  const springEase = (t, freq = 13, decay = 7) => {
    if (t <= 0) return 0;
    return 1 - Math.exp(-decay * t) * Math.cos(freq * t);
  };

  // Deterministic hash noise (stable across frames & exports)
  const hash1 = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const smoothNoise = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
  };

  /**
   * Analytic 2-bone IK (law of cosines).
   * root:   joint 1 (shoulder / hip)
   * target: desired end effector (wrist / ankle)
   * l1, l2: bone lengths
   * hint:   optional point the middle joint (elbow / knee) should bend toward.
   * bend:   fallback bend sign (+1 / -1) if no hint is given.
   * Returns absolute bone angles (θ-from-down convention) and joint positions.
   */
  function solveTwoBoneIK(root, target, l1, l2, hint = null, bend = 1) {
    const dx = target.x - root.x;
    const dy = target.y - root.y;
    const d = Math.hypot(dx, dy);
    const minD = Math.abs(l1 - l2) + 0.5;
    const maxD = l1 + l2 - 0.05;
    const dc = clamp(d, minD, maxD);
    const base = d > 1e-4 ? Math.atan2(dx, dy) : 0;
    const cosA = clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1);
    const a = Math.acos(cosA);

    const solve = (sign) => {
      const upper = base + sign * a;
      const mid = { x: root.x + Math.sin(upper) * l1, y: root.y + Math.cos(upper) * l1 };
      const end = { x: root.x + Math.sin(base) * dc, y: root.y + Math.cos(base) * dc };
      const lower = Math.atan2(end.x - mid.x, end.y - mid.y);
      return { upper, lower, mid, end, reached: d <= maxD + 0.01 };
    };

    if (hint) {
      const s1 = solve(1);
      const s2 = solve(-1);
      return dist(s1.mid, hint) <= dist(s2.mid, hint) ? s1 : s2;
    }
    return solve(bend >= 0 ? 1 : -1);
  }

  // Forward kinematics for a 2-bone chain with absolute angles.
  function fk2(root, upper, lower, l1, l2) {
    const mid = add(root, dir(upper), l1);
    const end = add(mid, dir(lower), l2);
    return { mid, end };
  }

  // Semi-implicit spring-damper (1D) — used for hood bounce, hem sway, talk beats, etc.
  class Spring1D {
    constructor(stiffness = 140, damping = 14, value = 0) {
      this.k = stiffness;
      this.c = damping;
      this.x = value;
      this.v = 0;
    }
    step(target, dt) {
      const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        const a = this.k * (target - this.x) - this.c * this.v;
        this.v += a * h;
        this.x += this.v * h;
      }
      return this.x;
    }
    impulse(v) { this.v += v; }
    reset(value = 0) { this.x = value; this.v = 0; }
  }

  // Rig proportions (local units). Tuned to the reference sheet: big round head,
  // oversized hoodie that ends just below the hips, baggy joggers, chunky sneakers.
  const RIG_DIMS = {
    spriteHeight: 358,       // matches v1 sprite metadata so scale/position stay consistent
    pelvisHeight: 152,       // ground → pelvis in neutral stance (= thigh + shin + ankleH)
    hipHalf: 15,
    thigh: 74,
    shin: 68,
    ankleH: 10,              // ankle joint above the shoe sole
    footBack: 9,             // heel behind ankle
    footFront: 27,           // toe in front of ankle
    spine: 100,              // pelvis → neck base
    shoulderUp: 88,          // shoulder height above pelvis
    shoulderHalf: 40,
    upperArm: 56,
    forearm: 52,
    neckLen: 8,
    headUp: 134,             // head centre above pelvis (neck base 100 + 34) — head sits on the hood
    headRx: 34,
    headRy: 36,
  };

  // Torso cross-section profile: (up above pelvis, half width, half depth, front bulge, back bulge)
  const TORSO_PROFILE = [
    { up: -17, w: 41, d: 26, fb: 2, bb: 0 },   // hem bottom (ribbed band)
    { up: -7,  w: 43, d: 27, fb: 3, bb: 0 },   // hem band top
    { up: 4,   w: 49, d: 31, fb: 7, bb: 1 },   // baggy blousing over the band
    { up: 30,  w: 48, d: 30, fb: 8, bb: 2 },   // kangaroo-pocket belly
    { up: 58,  w: 47, d: 28, fb: 4, bb: 4 },
    { up: 78,  w: 46, d: 26, fb: 2, bb: 6 },   // upper back hunch
    { up: 90,  w: 41, d: 22, fb: 0, bb: 5 },   // dropped shoulders
    { up: 98,  w: 27, d: 18, fb: 0, bb: 2 },   // neckline / hood base
  ];

  /**
   * Project body-relative (lat, z, up) into local rig space.
   * body: { pelvis:{x,y}, lean, phi } where phi = turn angle (0 front … π/2 side profile).
   */
  function projectBody(body, lat, z, up) {
    const c = Math.cos(body.phi);
    const s = Math.sin(body.phi);
    const lx = lat * c + z * s;
    return xform(body.pelvis, body.lean, { x: lx, y: -up });
  }
  // Depth toward the viewer (+ = nearer). Used to decide layering.
  function depthOf(phi, lat, z) {
    return -lat * Math.sin(phi) + z * Math.cos(phi);
  }

  window.RigCore = {
    TAU, DEG, clamp, lerp, smoothstep, easeInOut, easeOutBack, dir, angleOf, add, sub, dist, lerpPt,
    rotate, xform, wrapAngle, angleLerp, damp, dampAngle, springEase, hash1, smoothNoise,
    solveTwoBoneIK, fk2, Spring1D, RIG_DIMS, TORSO_PROFILE, projectBody, depthOf,
  };
})();
