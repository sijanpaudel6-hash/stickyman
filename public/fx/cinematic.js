// cinematic.js — 2.5D photo cinema tools: Ken Burns drift, foreground depth overlays, letterbox bars,
// and scene transitions (cut / cross-dissolve / fade through black / fade through white).
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (t) => t * t * (3 - 2 * t);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  window.KEN_BURNS_MODES = [
    { id: 'none', name: 'Static' },
    { id: 'push_in', name: 'Slow Push In' },
    { id: 'pull_out', name: 'Slow Pull Out' },
    { id: 'drift_left', name: 'Drift Left' },
    { id: 'drift_right', name: 'Drift Right' },
    { id: 'breathing', name: 'Breathing Float' },
  ];

  window.FOREGROUND_MODES = [
    { id: 'none', name: 'None' },
    { id: 'bokeh', name: 'Foreground Bokeh' },
    { id: 'rain_streaks', name: 'Passing Rain Streaks' },
    { id: 'window_reflection', name: 'Windowpane Reflection' },
  ];

  window.TRANSITION_TYPES = [
    { id: 'cut', name: 'Cut (Instant)' },
    { id: 'dissolve', name: 'Cross-Dissolve' },
    { id: 'fade_black', name: 'Fade Through Black' },
    { id: 'fade_white', name: 'Fade Through White' },
  ];

  const KenBurns = {
    // Returns { s, tx, ty } for a scene progress (0..1). strength scales the move (parallax layers).
    transform(mode, progress, wallTime, W, H, strength = 1) {
      const p = easeIO(clamp(progress, 0, 1));
      let s = 1, tx = 0, ty = 0;
      switch (mode) {
        case 'push_in': s = 1.03 + 0.13 * p; ty = -0.012 * H * p; break;
        case 'pull_out': s = 1.16 - 0.13 * p; ty = -0.012 * H * (1 - p); break;
        case 'drift_left': s = 1.1; tx = (0.04 - 0.08 * p) * W; break;
        case 'drift_right': s = 1.1; tx = (-0.04 + 0.08 * p) * W; break;
        case 'breathing':
          s = 1.06 + 0.02 * Math.sin(wallTime * 0.5);
          tx = Math.sin(wallTime * 0.23) * 0.009 * W;
          ty = Math.cos(wallTime * 0.31) * 0.007 * H;
          break;
        default: break;
      }
      return { s: 1 + (s - 1) * strength, tx: tx * strength, ty: ty * strength };
    },
    apply(ctx, W, H, kb) {
      if (kb.s === 1 && kb.tx === 0 && kb.ty === 0) return;
      ctx.translate(W / 2 + kb.tx, H / 2 + kb.ty);
      ctx.scale(kb.s, kb.s);
      ctx.translate(-W / 2, -H / 2);
    },
  };

  // Deterministic pseudo-random
  const rnd = (i, k = 0) => {
    const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const Foreground = {
    render(ctx, W, H, mode, t, kb, pulse = 0) {
      if (!mode || mode === 'none') return;
      ctx.save();
      // Foreground moves MORE than the photo → depth parallax
      const px = -(kb ? kb.tx : 0) * 1.6;
      const py = -(kb ? kb.ty : 0) * 1.6;
      if (mode === 'bokeh') this.bokeh(ctx, W, H, t, px, py, pulse);
      else if (mode === 'rain_streaks') this.rain(ctx, W, H, t, px);
      else if (mode === 'window_reflection') this.glass(ctx, W, H, t, px);
      ctx.restore();
    },

    bokeh(ctx, W, H, t, px, py, pulse) {
      const U = Math.min(W, H);
      // Out-of-focus dark foreground silhouettes (corners)
      [[-0.05, 1.02, 0.42], [1.06, 0.98, 0.36], [0.92, 1.12, 0.3]].forEach(([x, y, r], i) => {
        const cx = x * W + px * (1 + i * 0.3), cy = y * H + py;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * U * 1.2);
        g.addColorStop(0, 'rgba(4,4,6,0.92)');
        g.addColorStop(0.55, 'rgba(4,4,6,0.6)');
        g.addColorStop(1, 'rgba(4,4,6,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });
      // Light bokeh discs
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 16; i++) {
        const r = (0.025 + rnd(i, 1) * 0.06) * U;
        const x = ((rnd(i, 2) + t * 0.004 * (0.5 + rnd(i, 3))) % 1) * W + px * 1.3;
        const y = (0.1 + rnd(i, 4) * 0.8) * H + Math.sin(t * 0.3 + i) * 6 + py;
        const warm = rnd(i, 5) > 0.45;
        const a = (0.1 + rnd(i, 6) * 0.14) * (1 + pulse * 0.8) * (0.75 + 0.25 * Math.sin(t * 0.7 + i));
        const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
        const col = warm ? '255, 205, 140' : '170, 200, 255';
        g.addColorStop(0, `rgba(${col}, ${a.toFixed(3)})`);
        g.addColorStop(0.85, `rgba(${col}, ${(a * 0.8).toFixed(3)})`);
        g.addColorStop(1, `rgba(${col}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    rain(ctx, W, H, t, px) {
      // Near-camera streaks (fast, long, soft)
      ctx.lineCap = 'round';
      for (let i = 0; i < 46; i++) {
        const speed = 1.6 + rnd(i, 1) * 1.4;
        const len = (0.12 + rnd(i, 2) * 0.18) * H;
        const x = (rnd(i, 3) * 1.2 - 0.1) * W + px * 1.5;
        const y = (((rnd(i, 4) + t * speed * 0.55) % 1.4) - 0.3) * H;
        const a = 0.05 + rnd(i, 5) * 0.12;
        const g = ctx.createLinearGradient(x, y, x - len * 0.18, y + len);
        g.addColorStop(0, 'rgba(220, 235, 255, 0)');
        g.addColorStop(0.6, `rgba(220, 235, 255, ${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(220, 235, 255, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5 + rnd(i, 6) * 2.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.18, y + len);
        ctx.stroke();
      }
      // Drops on the lens
      for (let i = 0; i < 12; i++) {
        const r = (0.008 + rnd(i, 7) * 0.016) * Math.min(W, H);
        const x = rnd(i, 8) * W;
        const y = ((rnd(i, 9) + t * 0.01 * rnd(i, 10)) % 1) * H;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.32)');
        g.addColorStop(0.7, 'rgba(200,215,235,0.08)');
        g.addColorStop(1, 'rgba(200,215,235,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    glass(ctx, W, H, t, px) {
      ctx.globalCompositeOperation = 'screen';
      // Diagonal reflection bands
      [[0.12, 0.09, 0.07], [0.58, 0.05, 0.05], [0.8, 0.13, 0.04]].forEach(([x0, w, a], i) => {
        const x = x0 * W + px * 0.6 + Math.sin(t * 0.07 + i) * 10;
        ctx.save();
        ctx.translate(x, 0);
        ctx.transform(1, 0, -0.35, 1, 0, 0);
        const g = ctx.createLinearGradient(0, 0, w * W, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(225,235,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w * W, H);
        ctx.restore();
      });
      // Faint reflected interior lamp
      const g2 = ctx.createRadialGradient(W * 0.84, H * 0.22, 4, W * 0.84, H * 0.22, W * 0.2);
      g2.addColorStop(0, 'rgba(255, 200, 140, 0.12)');
      g2.addColorStop(1, 'rgba(255, 200, 140, 0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      // Droplet trails sliding down the pane
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const x = rnd(i, 11) * W;
        const y0 = ((rnd(i, 12) + t * 0.025 * (0.3 + rnd(i, 13))) % 1.2) * H - 0.1 * H;
        const len = (0.05 + rnd(i, 14) * 0.12) * H;
        ctx.strokeStyle = 'rgba(210, 225, 245, 0.16)';
        ctx.lineWidth = 1.2 + rnd(i, 15) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y0 - len);
        ctx.quadraticCurveTo(x + 3, y0 - len * 0.5, x + Math.sin(i) * 3, y0);
        ctx.stroke();
        ctx.fillStyle = 'rgba(235, 242, 255, 0.28)';
        ctx.beginPath();
        ctx.arc(x + Math.sin(i) * 3, y0, ctx.lineWidth * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Blurred dark window mullion at the edge (close to camera)
      const gm = ctx.createLinearGradient(0, 0, W * 0.08, 0);
      gm.addColorStop(0, 'rgba(6,6,8,0.85)');
      gm.addColorStop(1, 'rgba(6,6,8,0)');
      ctx.fillStyle = gm;
      ctx.fillRect(px * 0.8 - 10, 0, W * 0.09, H);
    },
  };

  const Letterbox = {
    barHeight(W, H, ratio = 2.35) {
      return Math.max(0, (H - W / ratio) / 2);
    },
    render(ctx, W, H, ratio = 2.35) {
      const b = this.barHeight(W, H, ratio);
      if (b <= 0) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, Math.ceil(b));
      ctx.fillRect(0, H - Math.ceil(b), W, Math.ceil(b));
      ctx.restore();
    },
  };

  /**
   * Transition state at timeline time t.
   * Returns { active, outgoing (scene|null), dissolve (0..1, alpha of active over outgoing),
   *           fade (0..1 overlay amount), fadeColor, filmFade }
   * A scene's `transition` describes how it ENTERS: dissolve runs [start, start + d];
   * fades run [start − d/2, start + d/2] (dip to colour exactly at the cut).
   */
  function transitionState(scenes, idx, t, opts = {}) {
    const S = scenes[idx];
    const out = { active: S, outgoing: null, dissolve: 1, fade: 0, fadeColor: '#000' };
    if (!S) return out;
    const tr = S.transition || { type: 'cut', duration: 0 };
    const d = clamp(tr.duration ?? 1, 0, 2);
    if (d > 0.01) {
      if (tr.type === 'dissolve') {
        if (idx > 0 && t < S.start + d) {
          out.outgoing = scenes[idx - 1];
          out.dissolve = ease(clamp((t - S.start) / d, 0, 1));
        } else if (idx === 0 && t < S.start + d) {
          out.fade = 1 - ease(clamp((t - S.start) / d, 0, 1));   // film opens from black
        }
      } else if ((tr.type === 'fade_black' || tr.type === 'fade_white') && t < S.start + d / 2) {
        out.fade = Math.max(out.fade, 1 - ease(clamp((t - S.start) / (d / 2), 0, 1)));
        out.fadeColor = tr.type === 'fade_white' ? '#fff' : '#000';
      }
    }
    // Outgoing half of the NEXT scene's fade
    const N = scenes[idx + 1];
    if (N && N.transition && (N.transition.type === 'fade_black' || N.transition.type === 'fade_white')) {
      const dn = clamp(N.transition.duration ?? 1, 0, 2);
      if (dn > 0.01 && t > N.start - dn / 2) {
        const f = ease(clamp((t - (N.start - dn / 2)) / (dn / 2), 0, 1));
        if (f > out.fade) {
          out.fade = f;
          out.fadeColor = N.transition.type === 'fade_white' ? '#fff' : '#000';
        }
      }
    }
    // Fade out at the very end of the film
    if (opts.filmFadeOut > 0 && opts.total) {
      const f = ease(clamp((t - (opts.total - opts.filmFadeOut)) / opts.filmFadeOut, 0, 1));
      if (f > out.fade) { out.fade = f; out.fadeColor = '#000'; }
    }
    return out;
  }

  window.Cinematic = { KenBurns, Foreground, Letterbox, transitionState };
})();
