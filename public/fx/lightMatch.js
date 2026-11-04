// lightMatch.js — Environment colour match & rim lighting ("harmonization") for photo backgrounds.
//
// The character is rendered into an offscreen layer, then:
//   1. Ambient tint   — multiplied by the photo's ambient colour (hue only, normalised brightness)
//   2. Exposure match — brightness / contrast follow the photo's average luminance
//   3. Rim light      — the silhouette edge facing the photo's key light glows in the key colour
//                       (cool moonlight in a blue 3 AM bedroom, warm amber in a golden sunset)
// The glowing face can be re-drawn un-graded afterwards so the eyes still glow in dark photos.
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  window.defaultLightSettings = (overrides = {}) => ({
    tint: 0.35,      // 0..1 ambient colour tint
    rim: 0.55,       // 0..1 rim light strength
    exposure: 0.5,   // 0..1 brightness/contrast match to the photo
    side: 'auto',    // 'auto' | 'left' | 'right' | 'back' (both sides)
    ...overrides,
  });

  const OFF = { tint: 0, rim: 0, exposure: 0, side: 'auto' };

  class LightMatcher {
    constructor() {
      this.layers = [];
      this.W = 0;
      this.H = 0;
    }

    ensure(W, H) {
      if (this.W === W && this.H === H && this.layers.length) return;
      this.W = W;
      this.H = H;
      this.layers = [0, 1, 2].map(() => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        return { c, ctx: c.getContext('2d') };
      });
    }

    static settingsFor(scene) {
      return scene && scene.light ? { ...OFF, ...scene.light } : OFF;
    }

    static isActive(st) {
      return st.tint > 0.001 || st.rim > 0.001 || st.exposure > 0.001;
    }

    // Normalise a colour to a target luminance (keeps hue/saturation, removes brightness)
    static normalize(c, target) {
      const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      const k = l > 0.001 ? target / l : 1;
      return c.map((v) => clamp(v * k, 0, 255));
    }

    /**
     * ctx: stage context (camera transform already applied)
     * lighting: BackgroundRenderer.getLighting() result
     * st: { tint, rim, exposure, side }
     * drawCharacter(layerCtx): draws the character with the same transform
     */
    render(ctx, W, H, lighting, st, drawCharacter) {
      if (!LightMatcher.isActive(st) || !lighting) {
        drawCharacter(ctx);
        return;
      }
      this.ensure(W, H);
      const [A, B, C] = this.layers;
      const m = ctx.getTransform();

      // 1) Character → layer A (same camera transform)
      A.ctx.setTransform(1, 0, 0, 1, 0, 0);
      A.ctx.clearRect(0, 0, W, H);
      A.ctx.setTransform(m);
      drawCharacter(A.ctx);
      A.ctx.setTransform(1, 0, 0, 1, 0, 0);

      // 2) Tinted copy → layer B
      B.ctx.setTransform(1, 0, 0, 1, 0, 0);
      B.ctx.clearRect(0, 0, W, H);
      B.ctx.globalCompositeOperation = 'source-over';
      B.ctx.drawImage(A.c, 0, 0);
      if (st.tint > 0.001) {
        const amb = LightMatcher.normalize(lighting.ambient, 0.62);
        const tc = [0, 1, 2].map((i) => Math.round(lerp(255, amb[i], clamp(st.tint, 0, 1))));
        B.ctx.globalCompositeOperation = 'multiply';
        B.ctx.fillStyle = `rgb(${tc[0]},${tc[1]},${tc[2]})`;
        B.ctx.fillRect(0, 0, W, H);
        B.ctx.globalCompositeOperation = 'destination-in';
        B.ctx.drawImage(A.c, 0, 0);
        B.ctx.globalCompositeOperation = 'source-over';
      }

      // 3) Composite with exposure match
      const L = clamp(lighting.lum, 0, 1);
      const e = clamp(st.exposure, 0, 1);
      const brightness = clamp(lerp(1, 0.62 + L * 0.85, e), 0.5, 1.25);
      const contrast = clamp(lerp(1, 0.86 + L * 0.3, e), 0.75, 1.15);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = e > 0.001 ? `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)})` : 'none';
      ctx.drawImage(B.c, 0, 0);
      ctx.filter = 'none';

      // 4) Rim light on the edge facing the key light
      if (st.rim > 0.001) {
        const key = LightMatcher.normalize(lighting.key, 0.82);
        const rimC = key.map((v) => Math.round(lerp(v, 255, 0.25)));
        const strength = clamp(st.rim, 0, 1) * (0.55 + 0.45 * clamp(lighting.keyLum, 0, 1));
        let dirs;
        const side = st.side || 'auto';
        if (side === 'left') dirs = [[-1, -0.35]];
        else if (side === 'right') dirs = [[1, -0.35]];
        else if (side === 'back' || Math.abs(lighting.lightX) < 0.15) dirs = [[-1, -0.25], [1, -0.25]];
        else dirs = [[Math.sign(lighting.lightX), -0.35]];
        const scale = Math.hypot(m.a, m.b) || 1;
        const d = clamp(3.2 * scale, 2, 7);
        dirs.forEach(([dx, dy]) => {
          C.ctx.setTransform(1, 0, 0, 1, 0, 0);
          C.ctx.globalCompositeOperation = 'source-over';
          C.ctx.clearRect(0, 0, W, H);
          C.ctx.drawImage(A.c, 0, 0);
          C.ctx.globalCompositeOperation = 'source-in';
          C.ctx.fillStyle = `rgb(${rimC[0]},${rimC[1]},${rimC[2]})`;
          C.ctx.fillRect(0, 0, W, H);
          // keep only pixels whose neighbour toward the light is outside the silhouette
          C.ctx.globalCompositeOperation = 'destination-out';
          C.ctx.drawImage(A.c, -dx * d, -dy * d);
          C.ctx.globalCompositeOperation = 'source-over';
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = strength * (dirs.length > 1 ? 0.75 : 1);
          ctx.filter = 'blur(1.2px)';
          ctx.drawImage(C.c, 0, 0);
          ctx.filter = 'blur(5px)';
          ctx.globalAlpha *= 0.55;
          ctx.drawImage(C.c, 0, 0);
          ctx.filter = 'none';
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        });
      }
      ctx.restore();
    }
  }

  window.LightMatcher = LightMatcher;
})();
