// cameraFx.js — Punchy retention camera: Snap Zoom, Dutch Tilt, Impact Shake, Spotlight Dimming.
// Events live on the global FX timeline: { id, kind:'camera', type, time, duration, intensity, dir }.
(function () {
  const { clamp, smoothstep, springEase, smoothNoise, DEG } = window.RigCore;

  window.CAMERA_FX_TYPES = [
    { id: 'snap_zoom', name: 'Snap Zoom', icon: '🔍', duration: 1.4, hint: 'Punchline 1.0x → 1.25x spring zoom on the face' },
    { id: 'dutch', name: 'Dutch Tilt', icon: '📐', duration: 1.8, hint: 'Uneasy tilted horizon' },
    { id: 'shake', name: 'Impact Shake', icon: '💥', duration: 0.7, hint: 'Decaying camera shake' },
    { id: 'spotlight', name: 'Spotlight', icon: '🔦', duration: 2.6, hint: 'Dim background 60%, keep character bright' },
  ];

  class CameraFxEngine {
    // Attack/release envelope. Spring attack gives the overshoot "snap".
    env(local, dur, attackFn, release = 0.3) {
      if (local < 0 || local > dur) return 0;
      const a = attackFn(local);
      const r = smoothstep(0, release, dur - local);
      return a * r;
    }

    /**
     * events: FX timeline (camera events only are used) · time: timeline seconds · scene: active scene
     * Returns { zoom, rot, tx, ty, dim, active[] }
     */
    evaluate(events, time, scene) {
      const out = { zoom: 1, rot: 0, tx: 0, ty: 0, dim: 0, active: [] };
      for (const ev of events) {
        if (ev.kind !== 'camera') continue;
        const local = time - ev.time;
        const dur = ev.duration || 1;
        if (local < 0 || local > dur) continue;
        const k = ev.intensity ?? 1;
        out.active.push(ev.type);
        switch (ev.type) {
          case 'snap_zoom': {
            const e = this.env(local, dur, (t) => springEase(t, 24, 10), 0.32);
            out.zoom *= 1 + 0.25 * k * e;
            break;
          }
          case 'dutch': {
            const e = this.env(local, dur, (t) => springEase(t, 11, 6), 0.4);
            out.rot += (ev.dir || 1) * 8 * DEG * k * e;
            break;
          }
          case 'shake': {
            const amp = 17 * k * Math.exp(-local * 5.2) * smoothstep(0, 0.12, dur - local);
            out.tx += amp * smoothNoise(local * 34 + ev.time);
            out.ty += amp * 0.8 * smoothNoise(local * 39 + 17 + ev.time);
            out.rot += amp * 0.0022 * smoothNoise(local * 27 + 5);
            out.zoom *= 1 + amp * 0.0015;
            break;
          }
          case 'spotlight': {
            const e = this.env(local, dur, (t) => smoothstep(0, 0.28, t), 0.45);
            out.dim = Math.max(out.dim, 0.6 * k * e);
            break;
          }
          default:
            break;
        }
      }
      if (scene && scene.fxDutch) out.rot += 6 * DEG;
      if (scene && scene.fxSpotlight) out.dim = Math.max(out.dim, 0.6);
      return out;
    }

    // Apply to the stage context (call before the scene camera). focus = point to zoom into.
    apply(ctx, W, H, fx, focus) {
      const f = focus || { x: W / 2, y: H / 2 };
      // Zoom compensation so rotated frames never reveal the canvas edge
      const rotComp = 1 + Math.abs(fx.rot) * 1.25;
      ctx.translate(W / 2 + fx.tx, H / 2 + fx.ty);
      ctx.rotate(fx.rot);
      ctx.scale(rotComp, rotComp);
      ctx.translate(-W / 2, -H / 2);
      if (fx.zoom !== 1) {
        // Move the zoom pivot toward the face so punchlines land on the expression
        const px = clamp(f.x, W * 0.2, W * 0.8);
        const py = clamp(f.y, H * 0.2, H * 0.8);
        ctx.translate(px, py);
        ctx.scale(fx.zoom, fx.zoom);
        ctx.translate(-px, -py);
      }
    }

    // Dim everything drawn so far except a soft pool of light around the character.
    drawSpotlight(ctx, W, H, dim, center, radius) {
      if (dim <= 0.001) return;
      const c = center || { x: W / 2, y: H / 2 };
      const r = radius || W * 0.2;
      ctx.save();
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.55, c.x, c.y, r * 1.9);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.35, `rgba(0,0,0,${(dim * 0.55).toFixed(3)})`);
      g.addColorStop(1, `rgba(0,0,0,${dim.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(-W, -H, W * 3, H * 3);
      // Faint warm light cone from above
      const cone = ctx.createLinearGradient(c.x, c.y - H, c.x, c.y + r);
      cone.addColorStop(0, `rgba(255, 244, 210, ${(0.10 * dim).toFixed(3)})`);
      cone.addColorStop(1, 'rgba(255, 244, 210, 0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.35, c.y - H);
      ctx.lineTo(c.x + r * 0.35, c.y - H);
      ctx.lineTo(c.x + r * 1.1, c.y + r * 1.2);
      ctx.lineTo(c.x - r * 1.1, c.y + r * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  window.CameraFxEngine = CameraFxEngine;
})();
