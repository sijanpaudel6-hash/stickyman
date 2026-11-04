// locomotion.js — Procedural walk / jog / run gait engine with continuous speed blending (0.0 – 2.5x)
//
// Gait model (per leg, phase φ advancing 2π per full stride cycle; the far leg runs at φ + π):
//   Hip / thigh swing   : sin(φ) · strideAngle                    (+ = forward)
//   Knee flex           : max(0, cos(φ)) · kneeFlex               → only while the thigh swings FORWARD
//                         (d/dφ sin φ = cos φ > 0), i.e. the recovery swing. Equivalent to the classic
//                         max(0, -cos(φ)) form when φ is measured from heel-strike instead of mid-swing.
//   Ankle roll          : heel-strike (toes up) → flat → heel-off/toe-push (toes down) → swing dorsiflex
//   Arms                : counter-swing sin(φ + π) with a lagging forearm (phase-delayed elbow flex)
//   Torso bounce        : |sin(φ)| · bounceAmp  (double frequency; dips at double-support)
//   Run (speed ≥ ~1.1)  : forward lean up to 16°, 75°–95° elbow pump, flight phase |sin φ| lift,
//                         bigger knee lift and toe-down swing.
(function () {
  const { TAU, DEG, clamp, lerp, smoothstep, damp, RIG_DIMS } = window.RigCore;

  class LocomotionController {
    constructor() {
      this.phase = 0;
      this.speed = 0;          // smoothed speed (what the body actually does)
      this.targetSpeed = 0;
      this.distance = 0;       // integrated ground distance (local units) for translate mode
      this.jumpT = -1;         // seconds since jump started (-1 = inactive)
      this.lastJumpLanded = false;
    }

    reset(distance = 0) {
      this.distance = distance;
    }

    triggerJump() {
      if (this.jumpT < 0 || this.jumpT > 0.82) this.jumpT = 0;
    }

    update(dt, targetSpeed) {
      this.targetSpeed = clamp(targetSpeed, 0, 2.5);
      // Speed eases toward the target so speed = 0 smoothly damps into the idle pose.
      this.speed = damp(this.speed, this.targetSpeed, 3.0, dt);
      if (this.speed < 0.004 && this.targetSpeed === 0) this.speed = 0;

      const p = this.params();
      this.phase = (this.phase + TAU * p.freq * dt) % (TAU * 1000);
      this.distance += p.groundSpeed * dt;

      if (this.jumpT >= 0) {
        this.jumpT += dt;
        if (this.jumpT > 0.9) this.jumpT = -1;
      }
      return p;
    }

    params() {
      const s = this.speed;
      const walkW = smoothstep(0.015, 0.2, s);
      const runW = smoothstep(1.05, 1.45, s);
      const sw = Math.min(s, 1);
      const sr = clamp((s - 1) / 1.5, 0, 1);

      const freq = lerp(0.55 + 0.45 * sw, 1.25 + 0.6 * sr, runW);              // stride cycles / second
      const stride = lerp(0.1 + 0.32 * sw, 0.5 + 0.16 * sr, runW);             // hip swing amplitude (rad)
      const kneeFlex = lerp(0.3 + 0.6 * sw, 1.55 + 0.4 * sr, runW);            // max knee bend (rad)
      const legLen = RIG_DIMS.thigh + RIG_DIMS.shin;
      // One cycle = two steps of length ≈ 2·L·sin(stride) → no foot sliding.
      const groundSpeed = 4 * legLen * Math.sin(stride) * freq * walkW * lerp(1, 1.18, runW);
      return { s, walkW, runW, sw, sr, freq, stride, kneeFlex, groundSpeed };
    }

    // Ankle (foot world angle, + = toes down) for a leg at phase φ.
    footRoll(phi, runW) {
      const pm = ((phi % TAU) + TAU) % TAU;
      const heelStrike = lerp(-0.3, -0.12, runW);
      const toeOff = lerp(0.55, 0.85, runW);
      if (pm > Math.PI / 2 && pm < (3 * Math.PI) / 2) {
        // Stance: thigh moving backward under the body
        const u = (pm - Math.PI / 2) / Math.PI;
        if (u < 0.16) return lerp(heelStrike, 0, u / 0.16);   // heel → flat (heel-to-toe roll)
        if (u < 0.62) return 0;                                // foot flat on ground
        return lerp(0, toeOff, smoothstep(0.62, 1, u));        // heel lifts, push off the toes
      }
      // Swing: from toe-off back to the next heel strike
      const u = (((pm - (3 * Math.PI) / 2) % TAU) + TAU) % TAU / Math.PI;
      const mid = lerp(0.08, 0.45, runW);
      if (u < 0.45) return lerp(toeOff, mid, smoothstep(0, 0.45, u));
      return lerp(mid, heelStrike, smoothstep(0.45, 1, u));
    }

    leg(phi, p) {
      const swing = Math.sin(phi);
      const thigh = swing * p.stride + p.runW * 0.24 * Math.max(0, swing); // stronger knee lift when running
      const recovery = Math.max(0, Math.cos(phi));                         // forward recovery swing only
      const knee = recovery * p.kneeFlex + 0.05 * p.walkW + p.runW * 0.22 * Math.max(0, -Math.cos(phi));
      const foot = this.footRoll(phi, p.runW) * p.walkW;
      return { thigh: thigh * p.walkW, knee: knee * p.walkW, foot };
    }

    arm(phi, p) {
      // phi here is already the arm phase (= leg phase + π  → counter-swing)
      const walkSwing = 0.34 * p.sw;
      const runSwing = 0.72 + 0.12 * p.sr;
      const swingAmp = lerp(walkSwing, runSwing, p.runW);
      const upper = Math.sin(phi) * swingAmp + p.runW * 0.12;
      // Forearm follows through with a phase lag (secondary motion)
      const lag = Math.sin(phi - 0.9);
      const walkFlex = 0.2 + 0.24 * (0.5 + 0.5 * lag) * p.sw;
      const runFlex = (82 * DEG) + 0.12 * Math.sin(phi - 0.5) + 0.06 * p.sr;   // ~75°–95° pump
      const flex = lerp(walkFlex, runFlex, p.runW);
      return { upper: upper * p.walkW, flex: flex * p.walkW + 0.08 * (1 - p.walkW) };
    }

    /** Full locomotion output for the current frame. */
    evaluate() {
      const p = this.params();
      const phi = this.phase;
      const legs = { front: this.leg(phi, p), back: this.leg(phi + Math.PI, p) };
      const arms = { front: this.arm(phi + Math.PI, p), back: this.arm(phi, p) };

      const walkLean = 0.045 * p.sw;
      const runLean = 16 * DEG * clamp((p.s - 0.9) / 1.6, 0, 1);
      const lean = lerp(walkLean, runLean, p.runW) * p.walkW;

      const bounceAmp = lerp(4.5 * p.sw, 3, p.runW);
      const torsoBob = Math.abs(Math.sin(phi)) * bounceAmp * p.walkW;     // double-frequency bounce
      const flightAmp = 16 + 10 * p.sr;
      const flightLift = Math.abs(Math.sin(phi)) * flightAmp * p.runW;    // both feet leave the ground
      const headNod = -0.035 * Math.cos(2 * phi) * p.walkW;
      const handState = p.runW > 0.5 ? 'fist' : 'relaxed';

      return { ...p, phase: phi, legs, arms, lean, torsoBob, flightLift, headNod, handState, jump: this.jumpState() };
    }

    // Jump: anticipation crouch → launch → airborne tuck → landing squash.
    jumpState() {
      const t = this.jumpT;
      if (t < 0) return { active: false, crouch: 0, lift: 0, tuck: 0, armsUp: 0, squash: 0 };
      const crouchEnd = 0.16, airEnd = 0.66, landEnd = 0.9;
      if (t < crouchEnd) {
        const u = t / crouchEnd;
        return { active: true, crouch: Math.sin(u * Math.PI / 2), lift: 0, tuck: 0, armsUp: -0.4 * u, squash: 0.06 * u };
      }
      if (t < airEnd) {
        const u = (t - crouchEnd) / (airEnd - crouchEnd);
        const lift = 4 * 68 * u * (1 - u);
        return { active: true, crouch: Math.max(0, 1 - u * 5), lift, tuck: Math.sin(u * Math.PI), armsUp: Math.sin(u * Math.PI), squash: -0.05 * Math.sin(u * Math.PI) };
      }
      const u = (t - airEnd) / (landEnd - airEnd);
      const c = Math.sin(Math.min(1, u) * Math.PI) * 0.8;
      return { active: true, crouch: c, lift: 0, tuck: 0, armsUp: 0, squash: 0.08 * c, landing: true };
    }
  }

  window.LocomotionController = LocomotionController;
})();
