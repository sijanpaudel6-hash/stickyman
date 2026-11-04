// backgrounds.js - Built-in & Custom Background Renderer for Sticky Character Studio

window.BG_PRESETS = [
  { id: 'paper_sketch', name: 'Sketchbook Paper', swatch: '#b5ad9f' },
  { id: 'cozy_night',   name: 'Cozy Night Room',  swatch: '#1e1b38' },
  { id: 'rainy_window', name: 'Rainy Lo-Fi',      swatch: '#16263b' },
  { id: 'streetlight',  name: 'Midnight Lamp',    swatch: '#12151f' },
  { id: 'classroom',    name: 'Sunset Desk',      swatch: '#573628' },
  { id: 'dark_spotlight', name: 'Dark Spotlight', swatch: '#141824' },
  { id: 'rooftop_dusk', name: 'Twilight Rooftop', swatch: '#3b1d4a' },
  { id: 'green_screen', name: 'Green Screen',     swatch: '#00ff00' },
];

class BackgroundRenderer {
  constructor() {
    this.customMedia = new Map(); // id -> { type: 'image'|'video', el, name, url }
    // Deterministic pseudo-random stars / bokeh / particles
    this.stars = Array.from({ length: 70 }, (_, i) => ({
      x: ((i * 137.5) % 100) / 100,
      y: ((i * 293.7) % 60) / 100,
      r: 0.8 + (i % 3) * 0.7,
      phase: i * 0.9,
    }));
    this.rainDrops = Array.from({ length: 95 }, (_, i) => ({
      x: ((i * 73.1) % 100) / 100,
      y: ((i * 41.9) % 100) / 100,
      len: 18 + (i % 5) * 8,
      speed: 0.65 + (i % 4) * 0.18,
    }));
    this.dustMotes = Array.from({ length: 45 }, (_, i) => ({
      x: ((i * 61.3) % 100) / 100,
      y: ((i * 89.7) % 100) / 100,
      r: 1.5 + (i % 4) * 1.1,
      speedX: (i % 2 === 0 ? 1 : -1) * (0.008 + (i % 3) * 0.004),
      speedY: -0.012 - (i % 4) * 0.005,
      phase: i * 1.3,
    }));
  }

  registerCustomMedia(id, type, el, name, url) {
    this.customMedia.set(id, { type, el, name, url });
  }

  render(ctx, W, H, bgId, timeSec, scene) {
    ctx.save();

    // Check if bgId is a custom uploaded media item
    if (this.customMedia.has(bgId)) {
      const item = this.customMedia.get(bgId);
      const el = item.el;
      const mediaW = item.type === 'video' ? (el.videoWidth || 1280) : (el.naturalWidth || 1280);
      const mediaH = item.type === 'video' ? (el.videoHeight || 720) : (el.naturalHeight || 720);
      if (mediaW > 0 && mediaH > 0) {
        const scale = Math.max(W / mediaW, H / mediaH);
        const dw = mediaW * scale;
        const dh = mediaH * scale;
        ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      ctx.restore();
      this.renderAtmosphere(ctx, W, H, timeSec, scene, bgId);
      return;
    }

    switch (bgId) {
      case 'paper_sketch': {
        const grad = ctx.createRadialGradient(W * 0.5, H * 0.45, W * 0.08, W * 0.5, H * 0.5, W * 0.75);
        grad.addColorStop(0, '#c7bfb2');
        grad.addColorStop(0.65, '#b6ae9f');
        grad.addColorStop(1, '#978f80');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Subtle sketch horizon line & soft floor shadow
        const floorY = H * 0.83;
        ctx.strokeStyle = 'rgba(70, 65, 58, 0.38)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W * 0.12, floorY);
        ctx.lineTo(W * 0.88, floorY);
        ctx.stroke();
        break;
      }

      case 'cozy_night': {
        // Wall gradient
        const wallGrad = ctx.createLinearGradient(0, 0, 0, H);
        wallGrad.addColorStop(0, '#121324');
        wallGrad.addColorStop(0.75, '#1d1c33');
        wallGrad.addColorStop(0.76, '#141222');
        wallGrad.addColorStop(1, '#0d0c18');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(0, 0, W, H);

        // Night window on the left-center
        const wx = W * 0.14, wy = H * 0.12, ww = W * 0.28, wh = H * 0.46;
        const skyGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        skyGrad.addColorStop(0, '#070b19');
        skyGrad.addColorStop(1, '#182549');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(wx, wy, ww, wh);

        // Twinkling stars inside window
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx, wy, ww, wh);
        ctx.clip();
        for (const s of this.stars) {
          const sx = wx + s.x * ww;
          const sy = wy + s.y * wh;
          const alpha = 0.35 + 0.55 * Math.sin(timeSec * 2.0 + s.phase);
          ctx.fillStyle = `rgba(255, 250, 220, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        // Crescent Moon
        ctx.fillStyle = '#fff8d6';
        ctx.beginPath();
        ctx.arc(wx + ww * 0.72, wy + wh * 0.26, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c1328';
        ctx.beginPath();
        ctx.arc(wx + ww * 0.72 - 8, wy + wh * 0.26 - 4, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Window frame
        ctx.strokeStyle = '#292742';
        ctx.lineWidth = 8;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy);
        ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh * 0.55);
        ctx.lineTo(wx + ww, wy + wh * 0.55);
        ctx.stroke();

        // Warm Desk Lamp Glow on the right
        const lampX = W * 0.82, lampY = H * 0.48;
        const lampGlow = ctx.createRadialGradient(lampX, lampY, 10, lampX, lampY, W * 0.42);
        lampGlow.addColorStop(0, 'rgba(255, 190, 95, 0.42)');
        lampGlow.addColorStop(0.45, 'rgba(255, 150, 65, 0.14)');
        lampGlow.addColorStop(1, 'rgba(255, 150, 65, 0)');
        ctx.fillStyle = lampGlow;
        ctx.fillRect(0, 0, W, H);
        break;
      }

      case 'rainy_window': {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0c1626');
        bgGrad.addColorStop(0.6, '#162840');
        bgGrad.addColorStop(1, '#0b121e');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Soft out-of-focus city bokeh lights
        const bokehColors = ['rgba(255, 180, 90, 0.16)', 'rgba(100, 200, 255, 0.14)', 'rgba(255, 95, 140, 0.12)'];
        for (let i = 0; i < 22; i++) {
          const bx = ((i * 179.3) % 100) / 100 * W;
          const by = H * (0.28 + ((i * 93.1) % 45) / 100);
          const br = 24 + (i % 5) * 14 + Math.sin(timeSec * 1.2 + i) * 4;
          ctx.fillStyle = bokehColors[i % bokehColors.length];
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }

        // Rain streaks on glass
        ctx.strokeStyle = 'rgba(185, 220, 255, 0.28)';
        ctx.lineWidth = 1.6;
        for (const r of this.rainDrops) {
          const rx = ((r.x - timeSec * 0.06 * r.speed) % 1 + 1) % 1 * W;
          const ry = ((r.y + timeSec * r.speed) % 1) * H;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 4, ry + r.len);
          ctx.stroke();
        }
        break;
      }

      case 'streetlight': {
        ctx.fillStyle = '#090b10';
        ctx.fillRect(0, 0, W, H);

        // Cone of warm light from above center
        const coneGrad = ctx.createRadialGradient(W * 0.5, H * 0.06, 8, W * 0.5, H * 0.55, W * 0.52);
        coneGrad.addColorStop(0, 'rgba(255, 238, 185, 0.48)');
        coneGrad.addColorStop(0.4, 'rgba(235, 195, 125, 0.18)');
        coneGrad.addColorStop(1, 'rgba(15, 18, 28, 0)');
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(W * 0.44, 0);
        ctx.lineTo(W * 0.56, 0);
        ctx.lineTo(W * 0.92, H);
        ctx.lineTo(W * 0.08, H);
        ctx.closePath();
        ctx.fill();

        // Ground pool of light
        const poolGrad = ctx.createRadialGradient(W * 0.5, H * 0.84, 20, W * 0.5, H * 0.84, W * 0.34);
        poolGrad.addColorStop(0, 'rgba(255, 225, 160, 0.26)');
        poolGrad.addColorStop(1, 'rgba(255, 225, 160, 0)');
        ctx.fillStyle = poolGrad;
        ctx.fillRect(0, H * 0.68, W, H * 0.32);
        break;
      }

      case 'classroom': {
        const wall = ctx.createLinearGradient(0, 0, 0, H);
        wall.addColorStop(0, '#3a2620');
        wall.addColorStop(0.7, '#4f3328');
        wall.addColorStop(1, '#261712');
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0, W, H);

        // Chalkboard behind character
        const bx = W * 0.12, by = H * 0.1, bw = W * 0.76, bh = H * 0.54;
        ctx.fillStyle = '#1b332b';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#6e4730';
        ctx.lineWidth = 10;
        ctx.strokeRect(bx, by, bw, bh);

        // Golden hour sunbeams diagonally across
        const beamGrad = ctx.createLinearGradient(0, 0, W * 0.7, H);
        beamGrad.addColorStop(0, 'rgba(255, 185, 95, 0.24)');
        beamGrad.addColorStop(1, 'rgba(255, 140, 60, 0.02)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(W * 0.45, 0);
        ctx.lineTo(W * 0.85, H);
        ctx.lineTo(W * 0.2, H);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'rooftop_dusk': {
        const sky = ctx.createLinearGradient(0, 0, 0, H * 0.8);
        sky.addColorStop(0, '#160d29');
        sky.addColorStop(0.45, '#3b1c4f');
        sky.addColorStop(0.78, '#8a3555');
        sky.addColorStop(1, '#d96b4b');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // Distant city skyline silhouettes
        ctx.fillStyle = '#120b1d';
        const buildings = [0.08, 0.16, 0.22, 0.31, 0.39, 0.48, 0.57, 0.66, 0.75, 0.84, 0.92];
        buildings.forEach((bx, idx) => {
          const bw = W * 0.085;
          const bh = H * (0.22 + (idx * 37 % 24) / 100);
          ctx.fillRect(bx * W - bw / 2, H * 0.78 - bh, bw, bh);
        });

        // Rooftop floor & railing
        ctx.fillStyle = '#0c0814';
        ctx.fillRect(0, H * 0.78, W, H * 0.22);
        ctx.strokeStyle = '#241936';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, H * 0.68);
        ctx.lineTo(W, H * 0.68);
        for (let x = 0; x <= W; x += W / 14) {
          ctx.moveTo(x, H * 0.68);
          ctx.lineTo(x, H * 0.78);
        }
        ctx.stroke();
        break;
      }

      case 'green_screen': {
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        return; // No vignette or particles on green screen
      }

      case 'dark_spotlight':
      default: {
        const grad = ctx.createRadialGradient(W * 0.5, H * 0.48, 20, W * 0.5, H * 0.5, W * 0.65);
        grad.addColorStop(0, '#232a3d');
        grad.addColorStop(0.55, '#151925');
        grad.addColorStop(1, '#090b10');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Floor line
        ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
        ctx.fillRect(0, H * 0.82, W, H * 0.18);
        break;
      }
    }

    ctx.restore();
    this.renderAtmosphere(ctx, W, H, timeSec, scene, bgId);
  }

  renderAtmosphere(ctx, W, H, timeSec, scene, bgId) {
    if (bgId === 'green_screen') return;
    const fx = scene?.atmosphere || 'dust';

    ctx.save();
    if (fx === 'rain') {
      ctx.strokeStyle = 'rgba(195, 225, 255, 0.34)';
      ctx.lineWidth = 1.5;
      for (const r of this.rainDrops) {
        const rx = ((r.x - timeSec * 0.08 * r.speed) % 1 + 1) % 1 * W;
        const ry = ((r.y + timeSec * 1.15 * r.speed) % 1) * H;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 5, ry + r.len);
        ctx.stroke();
      }
    } else if (fx === 'dust') {
      for (const m of this.dustMotes) {
        const mx = ((m.x + timeSec * m.speedX) % 1 + 1) % 1 * W;
        const my = ((m.y + timeSec * m.speedY) % 1 + 1) % 1 * H;
        const alpha = 0.2 + 0.35 * Math.sin(timeSec * 1.8 + m.phase);
        ctx.fillStyle = `rgba(255, 248, 215, ${alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(mx, my, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Soft cinematic vignette
    const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.32, W * 0.5, H * 0.5, W * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

window.BackgroundRenderer = BackgroundRenderer;
