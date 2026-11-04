// captions.js — YouTube-style animated captions: word-by-word pop-in, karaoke highlight, classic box.
(function () {
  const { clamp, springEase } = window.RigCore;

  window.CAPTION_MODES = [
    { id: 'pop', name: 'Pop-In Words (viral)' },
    { id: 'karaoke', name: 'Karaoke Highlight Line' },
    { id: 'classic', name: 'Classic Subtitle Box' },
    { id: 'off', name: 'Captions Off' },
  ];

  window.defaultCaptionStyle = () => ({
    mode: 'pop',
    highlight: '#fde047',
    position: 'bottom',
    chunk: 3,
    uppercase: true,
    size: 54,
    bounce: true,
  });

  class CaptionRenderer {
    constructor() {
      this.cache = new Map();
    }

    // Distribute words across the scene with weights (longer words & punctuation pauses take longer).
    timings(scene) {
      const text = (scene.subtitle || '').trim();
      const key = `${text}|${scene.start}|${scene.end}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const words = text.split(/\s+/).filter(Boolean);
      const t0 = scene.start + Math.min(0.15, (scene.end - scene.start) * 0.05);
      const t1 = scene.end - Math.min(0.3, (scene.end - scene.start) * 0.08);
      const weights = words.map((w) => 1 + w.length * 0.13 + (/[.,!?…:;]$/.test(w) ? 0.7 : 0));
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = t0;
      const out = words.map((w, i) => {
        const d = ((t1 - t0) * weights[i]) / total;
        const item = { text: w, start: acc, end: acc + d, index: i };
        acc += d;
        return item;
      });
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, out);
      return out;
    }

    anchorY(H, position) {
      if (position === 'top') return H * 0.15;
      if (position === 'middle') return H * 0.5;
      return H * 0.83;
    }

    render(ctx, W, H, scene, time, style) {
      const st = { ...window.defaultCaptionStyle(), ...(style || {}) };
      if (!scene || !scene.subtitle || !scene.subtitle.trim() || st.mode === 'off') return;
      if (st.mode === 'classic') return this.renderClassic(ctx, W, H, scene.subtitle.trim(), st);
      const words = this.timings(scene);
      if (!words.length) return;
      let active = words.findIndex((w) => time >= w.start && time < w.end);
      if (active === -1) active = time >= words[words.length - 1].end ? words.length - 1 : -1;
      if (active === -1 && time < words[0].start) return;
      if (st.mode === 'karaoke') return this.renderKaraoke(ctx, W, H, words, time, active, st);
      return this.renderPop(ctx, W, H, words, time, active, st);
    }

    font(size) {
      return `900 ${Math.round(size)}px "Arial Black", "Impact", "Inter", system-ui, sans-serif`;
    }

    drawWord(ctx, text, x, y, size, fill, scale, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.font = this.font(size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.06;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = size * 0.2;
      ctx.strokeText(text, 0, 0);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = fill;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    renderPop(ctx, W, H, words, time, active, st) {
      const n = clamp(Math.round(st.chunk || 3), 1, 8);
      const chunkIdx = Math.floor(Math.max(0, active) / n);
      const chunk = words.slice(chunkIdx * n, chunkIdx * n + n);
      let size = st.size;
      ctx.save();
      ctx.font = this.font(size);
      const label = (w) => (st.uppercase ? w.text.toUpperCase() : w.text);
      const space = size * 0.32;
      // Reserve 14% per word so the bouncing (scaled-up) active word never collides with its neighbours
      let widths = chunk.map((w) => ctx.measureText(label(w)).width * 1.14);
      let total = widths.reduce((a, b) => a + b, 0) + space * (chunk.length - 1);
      const maxW = W * 0.86;
      if (total > maxW) {
        const k = maxW / total;
        size *= k;
        widths = widths.map((w) => w * k);
        total *= k;
      }
      ctx.restore();
      let x = W / 2 - total / 2;
      const y = this.anchorY(H, st.position);
      chunk.forEach((w, i) => {
        const cx = x + widths[i] / 2;
        x += widths[i] + space * (size / st.size);
        const local = time - w.start;
        if (local < 0) return;                               // not spoken yet → hidden (pop-in reveal)
        const pop = springEase(local, 20, 9);
        const isActive = chunkIdx * n + i === active;
        let scale = 0.55 + 0.45 * pop;
        if (st.bounce && isActive) scale *= 1.1 + 0.05 * Math.exp(-local * 6);
        const fill = isActive ? st.highlight : '#ffffff';
        this.drawWord(ctx, label(w), cx, y - (isActive ? size * 0.04 : 0), size, fill, scale, clamp(local / 0.06, 0, 1));
      });
    }

    renderKaraoke(ctx, W, H, words, time, active, st) {
      const size = st.size * 0.72;
      ctx.save();
      ctx.font = this.font(size);
      const label = (w) => (st.uppercase ? w.text.toUpperCase() : w.text);
      const space = size * 0.3;
      const maxW = W * 0.8;
      const lines = [[]];
      let lineW = 0;
      words.forEach((w) => {
        const ww = ctx.measureText(label(w)).width;
        if (lineW + ww > maxW && lines[lines.length - 1].length) {
          lines.push([]);
          lineW = 0;
        }
        lines[lines.length - 1].push({ w, ww });
        lineW += ww + space;
      });
      ctx.restore();
      const lineH = size * 1.25;
      const baseY = this.anchorY(H, st.position) - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, li) => {
        const total = line.reduce((a, b) => a + b.ww, 0) + space * (line.length - 1);
        let x = W / 2 - total / 2;
        line.forEach(({ w, ww }) => {
          const cx = x + ww / 2;
          x += ww + space;
          const spoken = time >= w.start;
          const isActive = w.index === active;
          const local = time - w.start;
          const scale = isActive && st.bounce ? 1 + 0.12 * Math.exp(-local * 7) : 1;
          this.drawWord(ctx, label(w), cx, baseY + li * lineH, size, spoken ? st.highlight : '#ffffff', scale, spoken ? 1 : 0.82);
        });
      });
    }

    renderClassic(ctx, W, H, text, st) {
      ctx.save();
      ctx.font = '700 28px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(text);
      const boxW = Math.min(W * 0.86, metrics.width + 48);
      const boxH = 52;
      const bx = (W - boxW) / 2;
      const by = st.position === 'top' ? 40 : st.position === 'middle' ? H / 2 - boxH / 2 : H - 78;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.82)';
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 252, 230, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fffdf2';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(text, W / 2, by + boxH / 2, W * 0.82);
      ctx.restore();
    }
  }

  window.CaptionRenderer = CaptionRenderer;
})();
