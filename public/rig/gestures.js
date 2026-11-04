// gestures.js — Hand states, action/gesture presets and the audio-reactive talking controller.
//
// Each preset returns IK goals in body-relative coordinates (see rigCore.js `projectBody`):
//   lat  (+ = character's left / screen-right in front view), z (forward), up (above pelvis).
// Arms are written with an "outward" lateral value `o` so every preset is symmetric:
//   front (near) arm = character's RIGHT arm → lat = -o
//   back  (far)  arm = character's LEFT  arm → lat = +o
(function () {
  const { clamp, lerp, smoothNoise, Spring1D, projectBody } = window.RigCore;

  window.HAND_STATES = [
    { id: 'relaxed', name: 'Relaxed' },
    { id: 'open_palm', name: 'Open Palm' },
    { id: 'pointing', name: 'Pointing' },
    { id: 'fist', name: 'Fist' },
    { id: 'holding_prop', name: 'Holding Prop' },
    { id: 'in_pocket', name: 'In Pocket' },
  ];

  window.GESTURE_PRESETS = [
    { id: 'pocket',       name: 'Hands in Pocket',  icon: '🧥', key: 'chill default' },
    { id: 'idle',         name: 'Relaxed Arms',     icon: '🧍' },
    { id: 'talking',      name: 'Talking (Audio)',  icon: '🗣️' },
    { id: 'explain',      name: 'Explain / Palms',  icon: '🤲' },
    { id: 'point_screen', name: 'Point at Screen',  icon: '👉' },
    { id: 'point_viewer', name: 'Point at Viewer',  icon: '🫵' },
    { id: 'crossed',      name: 'Crossed Arms',     icon: '🙅' },
    { id: 'facepalm',     name: 'Facepalm',         icon: '🤦' },
    { id: 'hands_head',   name: 'Hands on Head',    icon: '😱' },
    { id: 'shrug',        name: 'Shrug',            icon: '🤷' },
    { id: 'wave',         name: 'Wave Hello',       icon: '👋' },
    { id: 'typing',       name: 'Sit & Type',       icon: '⌨️' },
  ];

  window.PROP_LIST = [
    { id: 'none', name: 'No Prop', icon: '∅' },
    { id: 'phone', name: 'Smartphone', icon: '📱' },
    { id: 'mug', name: 'Coffee Mug', icon: '☕' },
    { id: 'mic', name: 'Microphone', icon: '🎤' },
    { id: 'controller', name: 'Controller', icon: '🎮' },
    { id: 'book', name: 'Book', icon: '📖' },
  ];

  const SIDE = { front: -1, back: 1 };

  // Build one arm goal. o/z/up = wrist, eo/ez/eu = elbow hint (all outward-lateral convention).
  function armGoal(arm, spec) {
    const s = SIDE[arm];
    return {
      wrist: { lat: s * spec.o, z: spec.z, up: spec.up },
      elbow: { lat: s * (spec.eo ?? spec.o + 22), z: spec.ez ?? -14, up: spec.eu ?? spec.up + 20 },
      hand: spec.hand || 'relaxed',
      handRel: spec.handRel ?? 0,   // wrist bend relative to the forearm (radians, + = curl into the elbow bend)
      // optional absolute hand angle (θ convention). `handOut` is the same but mirrored per arm so that
      // positive values always point the fingers OUTWARD (away from the body centre) in the front view.
      handAbs: spec.handOut !== undefined ? s * spec.handOut : (spec.handAbs ?? null),
      reach: spec.reach ?? 1,        // foreshortening multiplier for bone lengths (pointing at camera)
      handScale: spec.handScale ?? 1, // perspective: a hand reaching toward the camera draws bigger
      frontLayer: !!spec.frontLayer, // force the far arm to render in front of the torso
    };
  }

  // Wrist poses for holding each prop in front of the body.
  const PROP_HOLD = {
    phone:      { o: 14, z: 44, up: 76, eo: 30, ez: -6, eu: 46, handRel: -0.5 },
    mug:        { o: 18, z: 42, up: 64, eo: 32, ez: -8, eu: 40, handRel: -1.1 },
    mic:        { o: 10, z: 38, up: 108, eo: 34, ez: -4, eu: 66, handRel: -0.9 },
    controller: { o: 12, z: 42, up: 58, eo: 34, ez: -6, eu: 38, handRel: -0.9 },
    book:       { o: 16, z: 40, up: 70, eo: 32, ez: -6, eu: 44, handRel: -0.6 },
  };

  class GestureController {
    constructor() {
      this.beat = { front: new Spring1D(170, 13), back: new Spring1D(170, 13) };
      this.beatTarget = { front: 0, back: 0 };
      this.spread = { front: new Spring1D(120, 12), back: new Spring1D(120, 12) };
      this.spreadTarget = { front: 0, back: 0 };
      this.energy = 0;
      this.lastOpen = 0;
      this.quietTime = 1;
      this.armed = true;
      this.beatCount = 0;
    }

    // Audio-reactive syllable detection: a rising edge of the mouth envelope (with hysteresis so each
    // syllable re-arms only after the envelope dips) = word stress → kick a gesture "beat" on
    // alternating hands, both hands on loud peaks.
    updateAudio(dt, audio) {
      const open = audio ? (audio.mouthOpen || 0) : 0;
      this.energy = lerp(this.energy, open, 1 - Math.exp(-6 * dt));
      this.quietTime += dt; // time since the last beat
      if (open < 0.2) this.armed = true;
      if (this.armed && open > 0.3 && this.quietTime > 0.16) {
        this.armed = false;
        this.beatCount++;
        const strong = open > 0.62;
        const amp = 0.6 + ((this.beatCount * 37) % 10) / 22;
        const which = this.beatCount % 3 === 0 || strong ? 'both' : (this.beatCount % 2 ? 'front' : 'back');
        ['front', 'back'].forEach((arm) => {
          if (which === 'both' || which === arm) {
            this.beatTarget[arm] = Math.max(this.beatTarget[arm], amp * (which === 'both' ? 0.8 : 1));
            this.spreadTarget[arm] = (((this.beatCount * 53) % 7) / 7) * 1.0;
          }
        });
        this.quietTime = 0;
      }
      this.lastOpen = open;
      ['front', 'back'].forEach((arm) => {
        this.beatTarget[arm] *= Math.exp(-2.6 * dt);
        this.spreadTarget[arm] *= Math.exp(-1.4 * dt);
        this.beat[arm].step(this.beatTarget[arm], dt);
        this.spread[arm].step(this.spreadTarget[arm], dt);
      });
    }

    /**
     * Compute the upper-body goal for a gesture.
     * opts: { t (seconds), prop, turn }
     * Returns { front, back, headTilt, headNod, lean, shoulderLift, sit, desk, walkArms, usesFront }
     */
    compute(id, opts) {
      const t = opts.t || 0;
      const out = {
        front: null, back: null,
        headTilt: 0, headNod: 0, lean: 0, shoulderLift: 0,
        sit: false, desk: false, walkArms: 'keep', usesFront: false, bothHands: false,
      };
      const breath = Math.sin(t * 2.4);

      switch (id) {
        case 'idle': {
          out.front = armGoal('front', { o: 47, z: 3, up: -16 + breath, eo: 52, ez: -8, eu: 34, hand: 'relaxed', handRel: 0.12 });
          out.back = armGoal('back', { o: 47, z: 3, up: -16 + breath, eo: 52, ez: -8, eu: 34, hand: 'relaxed', handRel: 0.12 });
          out.walkArms = 'swing';
          break;
        }
        case 'talking': {
          const bf = this.beat.front.x, bb = this.beat.back.x;
          const sf = this.spread.front.x, sb = this.spread.back.x;
          const idleSway = smoothNoise(t * 0.7) * 3;
          out.front = armGoal('front', {
            o: 30 + sf * 16, z: 30 + bf * 6, up: 20 + bf * 34 + idleSway, eo: 50, ez: -10, eu: 40,
            hand: bf > 0.28 ? 'open_palm' : 'relaxed', handRel: -0.25 - bf * 0.7,
          });
          out.back = armGoal('back', {
            o: 30 + sb * 16, z: 30 + bb * 6, up: 18 + bb * 34 - idleSway, eo: 50, ez: -10, eu: 40,
            hand: bb > 0.28 ? 'open_palm' : 'relaxed', handRel: -0.25 - bb * 0.7, frontLayer: true,
          });
          out.headNod = -this.energy * 0.06 + (bf + bb) * 0.03;
          out.headTilt = smoothNoise(t * 0.5 + 9) * 0.05;
          out.lean = this.energy * 0.04;
          out.bothHands = true;
          break;
        }
        case 'explain': {
          const bob = Math.sin(t * 2.2) * 4;
          const e = this.energy;
          out.front = armGoal('front', { o: 86 + e * 8, z: 30, up: 46 + bob + e * 10, eo: 44, ez: -8, eu: 28, hand: 'open_palm', handOut: 2.25 });
          out.back = armGoal('back', { o: 86 + e * 8, z: 30, up: 46 - bob + e * 10, eo: 44, ez: -8, eu: 28, hand: 'open_palm', handOut: 2.25, frontLayer: true });
          out.headNod = -0.04;
          out.bothHands = true;
          break;
        }
        case 'point_screen': {
          const jab = Math.max(0, Math.sin(t * 3.1)) * 5;
          out.front = armGoal('front', { o: 128 + jab, z: 12, up: 104, eo: 80, ez: -6, eu: 104, hand: 'pointing', handRel: 0.0 });
          out.back = armGoal('back', { o: 44, z: 2, up: 8, eo: 70, ez: -18, eu: 44, hand: 'fist', handRel: 0.6 });
          out.headTilt = -0.08;
          out.lean = -0.03;
          out.usesFront = true;
          break;
        }
        case 'point_viewer': {
          const jab = Math.max(0, Math.sin(t * 2.6)) * 4;
          out.front = armGoal('front', { o: 16, z: 70 + jab, up: 76 + jab * 0.5, eo: 40, ez: 20, eu: 56, hand: 'pointing', handOut: -2.75, reach: 0.6, handScale: 1.55 });
          out.back = armGoal('back', { o: 47, z: 3, up: -14, eo: 52, ez: -8, eu: 34, hand: 'relaxed', handRel: 0.1 });
          out.lean = 0.05;
          out.headNod = 0.03;
          out.usesFront = true;
          break;
        }
        case 'crossed': {
          out.back = armGoal('back', { o: -26, z: 30, up: 60 + breath * 0.8, eo: 50, ez: 6, eu: 46, hand: 'fist', handRel: -0.2, frontLayer: true });
          out.front = armGoal('front', { o: -28, z: 36, up: 66 + breath * 0.8, eo: 52, ez: 8, eu: 52, hand: 'fist', handRel: -0.2 });
          out.lean = -0.04;
          out.headTilt = 0.06;
          out.bothHands = true;
          break;
        }
        case 'facepalm': {
          const rub = Math.sin(t * 1.4) * 3;
          out.front = armGoal('front', { o: 2 + rub, z: 40, up: 116, eo: 34, ez: 26, eu: 70, hand: 'open_palm', handOut: -(Math.PI - 0.15) });
          out.back = armGoal('back', { o: 46, z: 4, up: -12, eo: 52, ez: -8, eu: 34, hand: 'relaxed', handRel: 0.1 });
          out.headNod = 0.16;
          out.headTilt = 0.12;
          out.lean = 0.07;
          out.usesFront = true;
          break;
        }
        case 'hands_head': {
          const shake = Math.sin(t * 5.5) * 2.5;
          out.front = armGoal('front', { o: 30, z: 8, up: 150 + shake, eo: 66, ez: -4, eu: 144, hand: 'open_palm', handOut: -Math.PI * 0.82 });
          out.back = armGoal('back', { o: 30, z: 8, up: 150 - shake, eo: 66, ez: -4, eu: 144, hand: 'open_palm', handOut: -Math.PI * 0.82, frontLayer: true });
          out.headNod = -0.05;
          out.shoulderLift = 6;
          out.usesFront = true;
          out.bothHands = true;
          break;
        }
        case 'shrug': {
          const pulse = Math.max(0, Math.sin(t * 2.0)) * 5;
          out.front = armGoal('front', { o: 92 + pulse, z: 20, up: 60 + pulse, eo: 46, ez: -6, eu: 36, hand: 'open_palm', handOut: 2.0 });
          out.back = armGoal('back', { o: 92 + pulse, z: 20, up: 60 + pulse, eo: 46, ez: -6, eu: 36, hand: 'open_palm', handOut: 2.0, frontLayer: true });
          out.shoulderLift = 8 + pulse * 0.8;
          out.headTilt = 0.14;
          out.lean = -0.03;
          out.bothHands = true;
          break;
        }
        case 'wave': {
          const w = Math.sin(t * 9.0);
          out.front = armGoal('front', { o: 72 + w * 14, z: 10, up: 168 - Math.abs(w) * 4, eo: 76, ez: -4, eu: 98, hand: 'open_palm', handRel: w * 0.25 });
          out.back = armGoal('back', { o: 10, z: 16, up: 12, eo: 44, ez: -12, eu: 40, hand: 'in_pocket', handRel: 0.4 });
          out.headTilt = -0.07;
          out.usesFront = true;
          break;
        }
        case 'typing': {
          const tf = Math.abs(Math.sin(t * 17.0)) * 4;
          const tb = Math.abs(Math.sin(t * 17.0 + 1.7)) * 4;
          out.front = armGoal('front', { o: 12, z: 76, up: 36 + tf, eo: 30, ez: 20, eu: 24, hand: 'relaxed', handAbs: Math.PI / 2 - 0.22 });
          out.back = armGoal('back', { o: 12, z: 70, up: 37 + tb, eo: 30, ez: 18, eu: 24, hand: 'relaxed', handAbs: Math.PI / 2 - 0.22 });
          out.lean = 0.16;
          out.headNod = 0.12;
          out.sit = true;
          out.desk = true;
          out.bothHands = true;
          break;
        }
        case 'pocket':
        default: {
          out.front = armGoal('front', { o: 12, z: 18, up: 12 + breath * 0.6, eo: 52, ez: -12, eu: 46, hand: 'in_pocket', handRel: 0.5 });
          out.back = armGoal('back', { o: 12, z: 18, up: 12 + breath * 0.6, eo: 52, ez: -12, eu: 46, hand: 'in_pocket', handRel: 0.5 });
          out.walkArms = 'keep';
          break;
        }
      }

      // Prop handling: hold it in the free hand (front unless the gesture needs the front hand).
      const prop = opts.prop || 'none';
      if (prop !== 'none' && PROP_HOLD[prop] && id !== 'typing') {
        const holdArm = out.usesFront ? 'back' : 'front';
        const spec = { ...PROP_HOLD[prop], hand: 'holding_prop' };
        spec.up += Math.sin(t * 2.4) * 1.2;
        out[holdArm] = armGoal(holdArm, { ...spec, frontLayer: holdArm === 'back' });
        out.propArm = holdArm;
        if (prop === 'controller' && !out.usesFront) {
          out.back = armGoal('back', { ...PROP_HOLD.controller, o: -2, z: 46, up: 58, hand: 'fist', frontLayer: true });
        }
        if (prop === 'phone' && !out.usesFront) out.headNod = Math.max(out.headNod, 0.12);
        out.walkArms = 'keep';
      } else {
        out.propArm = null;
      }
      return out;
    }

    // Resolve a goal into local rig-space points.
    static resolveGoal(goal, body) {
      return {
        wrist: projectBody(body, goal.wrist.lat, goal.wrist.z, goal.wrist.up),
        elbowHint: projectBody(body, goal.elbow.lat, goal.elbow.z, goal.elbow.up),
        wristZ: goal.wrist.z,
      };
    }
  }

  window.GestureController = GestureController;
  window.RIG_PROP_HOLD = PROP_HOLD;
})();
