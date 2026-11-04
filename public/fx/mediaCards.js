// mediaCards.js — Picture-in-Picture B-roll cards (screenshot, meme, social post, big text) with spring pop-in.
(function () {
  const { clamp, springEase, smoothstep } = window.RigCore;

  window.CARD_KINDS = [
    { id: 'image', name: 'Image / Screenshot' },
    { id: 'meme', name: 'Meme (TOP | BOTTOM text)' },
    { id: 'post', name: 'Social Post Card' },
    { id: 'note', name: 'Big Text Card' },
  ];

  function wrapText(ctx, text, maxW) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  class MediaCardRenderer {
    constructor(library) {
      this.library = library; // Map id -> { img, name }
      this.latchedSide = new Map(); // card id -> side chosen when it popped in (auto mode)
    }

    // Timeline window of a card (absolute seconds)
    window(card, scene) {
      const start = scene.start + (card.appear || 0);
      const end = card.hold > 0 ? Math.min(scene.end, start + card.hold) : scene.end;
      return { start, end };
    }

    render(ctx, W, H, scene, time, charX) {
      if (!scene || !Array.isArray(scene.cards)) return;
      scene.cards.forEach((card, i) => this.renderCard(ctx, W, H, scene, card, time, charX, i));
    }

    renderCard(ctx, W, H, scene, card, time, charX, idx) {
      const { start, end } = this.window(card, scene);
      const local = time - start;
      const remain = end - time;
      if (local < 0 || remain < 0) return;
      let scale = springEase(local, 15, 6.5);
      if (remain < 0.22) scale *= smoothstep(0, 0.22, remain);
      if (scale <= 0.01) return;

      // Auto side = opposite the character, latched at pop-in so a walking character never makes it jump
      let side = card.side;
      if (side !== 'left' && side !== 'right') {
        if (local < 0.05 || !this.latchedSide.has(card.id)) {
          this.latchedSide.set(card.id, (charX ?? W / 2) < W / 2 ? 'right' : 'left');
        }
        side = this.latchedSide.get(card.id);
      }
      const sgn = side === 'right' ? 1 : -1;
      const cw = clamp(card.size || 0.34, 0.15, 0.6) * W;
      const layout = this.measure(ctx, card, cw);
      const cx = W / 2 + sgn * W * 0.235 + (card.offsetX || 0) * W;
      const cy = H * 0.42 + (card.offsetY || 0) * H + Math.sin(time * 1.6 + idx) * 4;
      const settle = clamp(local / 0.6, 0, 1);
      const rot = (-sgn * 3 + Math.sin(local * 9) * 2.5 * (1 - settle)) * Math.PI / 180;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.translate(-cw / 2, -layout.h / 2);
      this.drawFrame(ctx, card, cw, layout);
      ctx.restore();
    }

    measure(ctx, card, cw) {
      const lib = card.mediaId ? this.library.get(card.mediaId) : null;
      const img = lib && lib.img;
      const aspect = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.62;
      if (card.kind === 'post') {
        ctx.save();
        ctx.font = `600 ${Math.round(cw * 0.052)}px "Inter", system-ui, sans-serif`;
        const lines = wrapText(ctx, card.text || 'Write something…', cw - cw * 0.12);
        ctx.restore();
        const lh = cw * 0.068;
        const imgH = img ? (cw - cw * 0.12) * Math.min(aspect, 0.8) : 0;
        return { h: cw * 0.2 + lines.length * lh + (imgH ? imgH + cw * 0.04 : 0) + cw * 0.13, lines, lh, img, imgH };
      }
      if (card.kind === 'note') {
        ctx.save();
        ctx.font = `900 ${Math.round(cw * 0.11)}px "Arial Black", Impact, system-ui`;
        const lines = wrapText(ctx, (card.text || 'MEANWHILE…').toUpperCase(), cw * 0.84);
        ctx.restore();
        return { h: Math.max(cw * 0.42, lines.length * cw * 0.13 + cw * 0.16), lines };
      }
      const pad = card.kind === 'meme' ? 0 : cw * 0.035;
      const capH = card.kind === 'image' && card.text ? cw * 0.12 : 0;
      const innerH = (cw - pad * 2) * clamp(aspect, 0.4, 1.4);
      return { h: innerH + pad * 2 + capH, pad, innerH, capH, img };
    }

    drawFrame(ctx, card, cw, L) {
      const r = cw * 0.04;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 10;
      ctx.beginPath();
      ctx.roundRect(0, 0, cw, L.h, r);
      ctx.fillStyle = card.kind === 'note' ? '#141519' : '#fbfaf6';
      ctx.fill();
      ctx.restore();

      if (card.kind === 'post') return this.drawPost(ctx, card, cw, L);
      if (card.kind === 'note') return this.drawNote(ctx, card, cw, L);

      // image / meme
      ctx.save();
      ctx.beginPath();
      const x = L.pad, y = L.pad, w = cw - L.pad * 2, h = L.innerH;
      ctx.roundRect(x, y, w, h, card.kind === 'meme' ? r : r * 0.6);
      ctx.clip();
      if (L.img && L.img.naturalWidth) {
        const s = Math.max(w / L.img.naturalWidth, h / L.img.naturalHeight);
        const dw = L.img.naturalWidth * s, dh = L.img.naturalHeight * s;
        ctx.drawImage(L.img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else {
        this.placeholder(ctx, x, y, w, h);
      }
      ctx.restore();

      if (card.kind === 'meme') {
        const [top, bottom] = String(card.text || 'WHEN THE CODE | WORKS FIRST TRY').split('|').map((s) => s.trim().toUpperCase());
        const size = cw * 0.085;
        ctx.save();
        ctx.font = `900 ${Math.round(size)}px Impact, "Arial Black", system-ui`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#fff';
        if (top) {
          ctx.textBaseline = 'top';
          ctx.strokeText(top, cw / 2, size * 0.35, cw * 0.92);
          ctx.fillText(top, cw / 2, size * 0.35, cw * 0.92);
        }
        if (bottom) {
          ctx.textBaseline = 'bottom';
          ctx.strokeText(bottom, cw / 2, L.h - size * 0.3, cw * 0.92);
          ctx.fillText(bottom, cw / 2, L.h - size * 0.3, cw * 0.92);
        }
        ctx.restore();
      } else if (L.capH) {
        ctx.save();
        ctx.font = `700 ${Math.round(cw * 0.05)}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = '#1b1c20';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.text, cw / 2, L.h - L.capH / 2 - L.pad * 0.3, cw * 0.9);
        ctx.restore();
      }
    }

    placeholder(ctx, x, y, w, h) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#2b3245');
      g.addColorStop(1, '#151922');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `700 ${Math.round(w * 0.06)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🖼️ Upload an image', x + w / 2, y + h / 2);
    }

    drawPost(ctx, card, cw, L) {
      const pad = cw * 0.06;
      const av = cw * 0.11;
      // Avatar: the Sticky character himself
      ctx.save();
      ctx.beginPath();
      ctx.arc(pad + av / 2, pad + av / 2, av / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#08080a';
      ctx.fill();
      ctx.fillStyle = '#fffdf0';
      ctx.shadowColor = 'rgba(255,240,175,0.9)';
      ctx.shadowBlur = 4;
      [-1, 1].forEach((s) => {
        ctx.beginPath();
        ctx.ellipse(pad + av / 2 + s * av * 0.17, pad + av * 0.48, av * 0.09, av * 0.06, 0, 0, Math.PI);
        ctx.fill();
      });
      ctx.restore();
      ctx.save();
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#111';
      ctx.font = `800 ${Math.round(cw * 0.05)}px "Inter", system-ui, sans-serif`;
      ctx.fillText(card.title || 'Sticky', pad + av + cw * 0.03, pad + av * 0.05);
      ctx.fillStyle = '#6b7280';
      ctx.font = `500 ${Math.round(cw * 0.042)}px "Inter", system-ui, sans-serif`;
      ctx.fillText(`${card.handle || '@stickyhoodie'} · 2h`, pad + av + cw * 0.03, pad + av * 0.55);
      ctx.fillStyle = '#16171a';
      ctx.font = `600 ${Math.round(cw * 0.052)}px "Inter", system-ui, sans-serif`;
      let y = pad + av + cw * 0.04;
      L.lines.forEach((line) => {
        ctx.fillText(line, pad, y);
        y += L.lh;
      });
      if (L.img && L.imgH) {
        y += cw * 0.01;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pad, y, cw - pad * 2, L.imgH, cw * 0.025);
        ctx.clip();
        const w = cw - pad * 2;
        const s = Math.max(w / L.img.naturalWidth, L.imgH / L.img.naturalHeight);
        ctx.drawImage(L.img, pad + (w - L.img.naturalWidth * s) / 2, y + (L.imgH - L.img.naturalHeight * s) / 2, L.img.naturalWidth * s, L.img.naturalHeight * s);
        ctx.restore();
        y += L.imgH + cw * 0.03;
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = `600 ${Math.round(cw * 0.042)}px "Inter", system-ui, sans-serif`;
      const stats = [`💬 ${card.replies || '312'}`, `🔁 ${card.reposts || '2.1K'}`, `♥ ${card.likes || '18.4K'}`];
      stats.forEach((s, i) => ctx.fillText(s, pad + i * (cw - pad * 2) / 3, L.h - pad - cw * 0.045));
      ctx.restore();
    }

    drawNote(ctx, card, cw, L) {
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = cw * 0.012;
      ctx.beginPath();
      ctx.roundRect(cw * 0.025, cw * 0.025, cw - cw * 0.05, L.h - cw * 0.05, cw * 0.03);
      ctx.stroke();
      ctx.font = `900 ${Math.round(cw * 0.11)}px "Arial Black", Impact, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fffdf0';
      ctx.shadowColor = 'rgba(255, 240, 175, 0.7)';
      ctx.shadowBlur = 12;
      const lh = cw * 0.13;
      const y0 = L.h / 2 - ((L.lines.length - 1) * lh) / 2;
      L.lines.forEach((line, i) => ctx.fillText(line, cw / 2, y0 + i * lh, cw * 0.88));
      ctx.restore();
    }
  }

  window.MediaCardRenderer = MediaCardRenderer;
})();
