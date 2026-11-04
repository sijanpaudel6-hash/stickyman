// clothPhysics.js — Secondary motion: Verlet hoodie drawstrings + spring-damper hood & hem.
//
// Simulated in LOCAL rig space. Anchors (the drawstring eyelets on the collar) are pinned to the
// animated skeleton each step, so torso bounce / lean / shake automatically drags the strings.
// Whole-character translation (walking across the screen, camera-independent root motion) is fed in as
// an inertial pseudo-force (−rootAcceleration), so strings trail behind when the character starts,
// stops, runs or jumps.
(function () {
  const { clamp, Spring1D } = window.RigCore;

  class VerletRope {
    constructor(segments = 6, segLen = 6.6) {
      this.n = segments + 1;
      this.segLen = segLen;
      this.pts = Array.from({ length: this.n }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
      this.ready = false;
    }

    reset(anchor) {
      this.pts.forEach((p, i) => {
        p.x = p.px = anchor.x;
        p.y = p.py = anchor.y + i * this.segLen;
      });
      this.ready = true;
    }

    step(h, anchor, accel, opts) {
      if (!this.ready) this.reset(anchor);
      const damping = opts.damping ?? 0.985;
      const pts = this.pts;
      // Integrate (Verlet)
      for (let i = 1; i < this.n; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * damping;
        const vy = (p.y - p.py) * damping;
        p.px = p.x;
        p.py = p.y;
        p.x += vx + accel.x * h * h;
        p.y += vy + accel.y * h * h;
      }
      // Pin root
      pts[0].px = pts[0].x;
      pts[0].py = pts[0].y;
      pts[0].x = anchor.x;
      pts[0].y = anchor.y;
      // Satisfy distance constraints
      for (let iter = 0; iter < 8; iter++) {
        for (let i = 0; i < this.n - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const diff = (d - this.segLen) / d;
          if (i === 0) {
            b.x -= dx * diff;
            b.y -= dy * diff;
          } else {
            a.x += dx * diff * 0.5;
            a.y += dy * diff * 0.5;
            b.x -= dx * diff * 0.5;
            b.y -= dy * diff * 0.5;
          }
        }
        // Keep the strings resting ON the hoodie front instead of passing into the chest (profile views)
        if (opts.minX !== undefined) {
          for (let i = 1; i < this.n; i++) {
            const limit = opts.minX(pts[i].y);
            if (pts[i].x < limit) pts[i].x = limit;
          }
        }
      }
    }
  }

  class ClothPhysics {
    constructor() {
      this.ropes = { left: new VerletRope(6, 6.4), right: new VerletRope(6, 6.4) };
      this.hem = new Spring1D(90, 9);      // horizontal hem / hoodie-body sway
      this.hood = new Spring1D(150, 10);   // hood bounce (vertical)
      this.enabled = true;
      this.accumulator = 0;
    }

    reset() {
      this.ropes.left.ready = false;
      this.ropes.right.ready = false;
      this.hem.reset();
      this.hood.reset();
    }

    /**
     * dt: frame delta; anchors: {left:{x,y}, right:{x,y}} local; rootAccel: local units/s²;
     * opts: { minX(y)→x | undefined, strength }
     */
    update(dt, anchors, rootAccel, opts = {}) {
      const strength = opts.strength ?? 1;
      const gravity = 1150;
      const ax = clamp(-rootAccel.x * 0.85 * strength, -9000, 9000);
      const ay = clamp(gravity - rootAccel.y * 0.85 * strength, -6000, 9000);
      const h = 1 / 120;
      this.accumulator = Math.min(this.accumulator + dt, 0.1);
      while (this.accumulator >= h) {
        this.ropes.left.step(h, anchors.left, { x: ax, y: ay }, { minX: opts.minX });
        this.ropes.right.step(h, anchors.right, { x: ax, y: ay }, { minX: opts.minX });
        this.accumulator -= h;
      }
      this.hem.step(clamp(-rootAccel.x * 0.0035 * strength, -7, 7), dt);
      this.hood.step(clamp(-rootAccel.y * 0.003 * strength, -6, 6), dt);
    }

    points(side) {
      return this.ropes[side].pts;
    }
  }

  window.ClothPhysics = ClothPhysics;
  window.VerletRope = VerletRope;
})();
