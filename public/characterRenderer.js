// characterRenderer.js - Sprite & Glowing Face + Lip-Sync Renderer for Sticky Character Studio

window.EMOTIONS = [
  { id: 'neutral',   name: 'Neutral',   hotkey: '1', icon: '😐', sheetArt: true },
  { id: 'happy',     name: 'Happy',     hotkey: '2', icon: '😊', sheetArt: true },
  { id: 'tired',     name: 'Tired',     hotkey: '3', icon: '🫩', sheetArt: true },
  { id: 'crying',    name: 'Crying',    hotkey: '4', icon: '😭', sheetArt: true },
  { id: 'angry',     name: 'Angry',     hotkey: '5', icon: '😠', sheetArt: false },
  { id: 'shocked',   name: 'Shocked',   hotkey: '6', icon: '😳', sheetArt: false },
  { id: 'skeptical', name: 'Skeptical', hotkey: '7', icon: '🤨', sheetArt: false },
  { id: 'confused',  name: 'Confused',  hotkey: '8', icon: '🤔', sheetArt: false },
  { id: 'excited',   name: 'Excited',   hotkey: '9', icon: '🤩', sheetArt: false },
  { id: 'deadpan',   name: 'Deadpan',   hotkey: '0', icon: '😑', sheetArt: false },
];

class CharacterRenderer {
  constructor() {
    this.ready = false;
    this.images = {};
    this.meta = null;
    this.lastBlinkTime = 0;
    this.nextBlinkInterval = 3.2;
    this.blinkDuration = 0.15;
  }

  async load() {
    if (window.STICKY_ASSETS_META) {
      this.meta = window.STICKY_ASSETS_META;
    } else {
      const res = await fetch('assets/metadata.json');
      this.meta = await res.json();
    }

    const keys = [
      'pose_front_blank',
      'pose_front_orig',
      'pose_side_blank',
      'pose_side_orig',
      'pose_back_orig',
      'bust_blank',
      'face_neutral',
      'face_happy',
      'face_tired',
      'face_crying',
      'face_nomouth_neutral',
      'face_nomouth_happy',
      'face_nomouth_tired',
      'face_nomouth_crying',
    ];

    await Promise.all(
      keys.map((key) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { this.images[key] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = (window.STICKY_ASSETS_DATA && window.STICKY_ASSETS_DATA[key])
          ? window.STICKY_ASSETS_DATA[key]
          : `assets/${key}.png`;
      }))
    );
    this.ready = true;
  }

  isBlinking(timeSec, emotion) {
    // Happy & Crying already have curved closed/squeezed eyes in the original design
    if (emotion === 'happy' || emotion === 'crying') return false;
    const cycle = timeSec % 3.6;
    return cycle > 3.42 && cycle < 3.57;
  }

  render(ctx, W, H, timeSec, audioState, scene, faceMode = 'hybrid') {
    if (!this.ready || !this.meta) return;

    const pose = scene.pose || 'front';
    const emotion = scene.emotion || 'neutral';
    const motion = scene.motion || 'talk_bounce';
    const scaleUser = scene.scale ?? 1.0;
    const posX = (scene.x ?? 0.5) * W;
    const posY = (scene.y ?? (pose === 'bust' ? 0.62 : 0.54)) * H;
    const flipX = !!scene.flipX;

    const mouthOpen = audioState.mouthOpen || 0;
    const mouthForm = audioState.mouthForm || 0.5; // 0 = narrow O, 1 = wide E/A

    // Calculate motion offsets
    let offsetX = 0;
    let offsetY = 0;
    let rotRad = 0;
    let breatheScaleY = 1.0;
    let breatheScaleX = 1.0;

    if (motion === 'talk_bounce' || motion === 'breathe') {
      const br = Math.sin(timeSec * 2.4);
      breatheScaleY = 1.0 + br * 0.008;
      breatheScaleX = 1.0 - br * 0.004;
      offsetY += br * 2.0;
      if (motion === 'talk_bounce' && mouthOpen > 0.04) {
        offsetY -= mouthOpen * 11.0;
        breatheScaleY += mouthOpen * 0.018;
        rotRad = Math.sin(timeSec * 9.5) * mouthOpen * 0.025;
      }
    } else if (motion === 'walk') {
      offsetY = -Math.abs(Math.sin(timeSec * 6.5)) * 14.0;
      offsetX = Math.sin(timeSec * 1.6) * 45.0;
      rotRad = Math.sin(timeSec * 6.5) * 0.035;
    } else if (motion === 'shake') {
      offsetX = Math.sin(timeSec * 42.0) * 3.5;
      offsetY = Math.cos(timeSec * 37.0) * 2.0 - mouthOpen * 7.0;
    } else if (motion === 'float') {
      offsetY = Math.sin(timeSec * 1.8) * 14.0;
      rotRad = Math.sin(timeSec * 1.1) * 0.02;
    }

    // Choose base sprite and dimensions
    let baseImg, spriteW, spriteH, headMeta, defaultScale;
    if (pose === 'bust') {
      baseImg = this.images.bust_blank;
      spriteW = this.meta.busts.neutral.width;
      spriteH = this.meta.busts.neutral.height;
      headMeta = this.meta.busts.neutral.head;
      defaultScale = (H * 0.64) / spriteH;
    } else if (pose === 'side') {
      baseImg = this.images.pose_side_blank;
      spriteW = this.meta.poses.side.width;
      spriteH = this.meta.poses.side.height;
      headMeta = this.meta.poses.side.head;
      defaultScale = (H * 0.76) / spriteH;
    } else if (pose === 'back') {
      baseImg = this.images.pose_back_orig;
      spriteW = this.meta.poses.back.width;
      spriteH = this.meta.poses.back.height;
      headMeta = null;
      defaultScale = (H * 0.76) / spriteH;
    } else {
      baseImg = this.images.pose_front_blank;
      spriteW = this.meta.poses.front.width;
      spriteH = this.meta.poses.front.height;
      headMeta = this.meta.poses.front.head;
      defaultScale = (H * 0.76) / spriteH;
    }

    const framing = (window.STUDIO_FRAMING && window.STUDIO_FRAMING.charScale) || 1;
    const totalScale = defaultScale * scaleUser * framing;

    ctx.save();
    ctx.translate(posX + offsetX, posY + offsetY);
    ctx.rotate(rotRad);
    ctx.scale((flipX ? -1 : 1) * totalScale * breatheScaleX, totalScale * breatheScaleY);

    // Draw soft ground shadow for full-body poses
    if (pose !== 'bust' && scene.background !== 'green_screen') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
      ctx.beginPath();
      ctx.ellipse(0, spriteH * 0.48, spriteW * 0.36, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw sprite centered at (0, 0)
    const topLeftX = -spriteW / 2;
    const topLeftY = -spriteH / 2;
    ctx.drawImage(baseImg, topLeftX, topLeftY, spriteW, spriteH);

    // Draw facial expression & lip-sync if pose has a visible face
    if (pose === 'front' || pose === 'bust') {
      const headCx = topLeftX + headMeta.cx;
      const headCy = topLeftY + headMeta.cy;
      const headRx = headMeta.rx;
      const headRy = headMeta.ry;
      this.renderFrontFace(ctx, headCx, headCy, headRx, headRy, emotion, mouthOpen, mouthForm, timeSec, faceMode);
    } else if (pose === 'side') {
      const headCx = topLeftX + headMeta.cx;
      const headCy = topLeftY + headMeta.cy;
      const headRx = headMeta.rx;
      const headRy = headMeta.ry;
      this.renderSideFace(ctx, headCx, headCy, headRx, headRy, emotion, mouthOpen, timeSec);
    }

    ctx.restore();
  }

  renderFrontFace(ctx, cx, cy, rx, ry, emotion, mouthOpen, mouthForm, timeSec, faceMode) {
    const blinking = this.isBlinking(timeSec, emotion);
    const isSpeaking = mouthOpen >= 0.045;
    const hasSheetArt = ['neutral', 'happy', 'tired', 'crying'].includes(emotion);

    // Use Original Hand-Drawn Sheet Overlay when in 'hybrid' mode and not blinking
    if (faceMode === 'hybrid' && hasSheetArt && !blinking) {
      const bustMeta = this.meta.busts[emotion];
      const bustHead = bustMeta.head;
      const scaleX = rx / bustHead.rx;
      const scaleY = ry / bustHead.ry;
      const drawW = bustMeta.width * scaleX;
      const drawH = bustMeta.height * scaleY;
      const drawX = cx - bustHead.cx * scaleX;
      const drawY = cy - bustHead.cy * scaleY;

      const faceImg = isSpeaking
        ? this.images[`face_nomouth_${emotion}`]
        : this.images[`face_${emotion}`];

      if (faceImg) {
        ctx.drawImage(faceImg, drawX, drawY, drawW, drawH);
      }

      // If speaking, draw dynamic glowing mouth at the exact mouth position
      if (isSpeaking) {
        this.drawGlowingMouth(ctx, cx, cy + ry * 0.44, rx, ry, emotion, mouthOpen, mouthForm, timeSec);
      }

      // Add subtle animated tear droplets for crying even in sheet mode
      if (emotion === 'crying') {
        this.drawAnimatedTearDrops(ctx, cx, cy, rx, ry, timeSec);
      }
      return;
    }

    // Procedural Glowing Face Renderer (used for extra emotions, blinking frames, or 'procedural' mode)
    ctx.save();
    this.applyGlowStyle(ctx, rx);

    const eyeOffsetX = rx * 0.36;
    const eyeY = cy - ry * 0.04;
    const eyeW = rx * 0.25;
    const eyeH = ry * 0.16;

    // 1. Eyebrows
    const browY = cy - ry * 0.27;
    ctx.lineWidth = Math.max(1.8, rx * 0.075);
    ctx.lineCap = 'round';

    this.drawEyebrows(ctx, cx, browY, eyeOffsetX, eyeW, rx, ry, emotion);

    // 2. Eyes
    if (blinking) {
      // Closed blink lines
      ctx.beginPath();
      ctx.moveTo(cx - eyeOffsetX - eyeW, eyeY);
      ctx.quadraticCurveTo(cx - eyeOffsetX, eyeY + eyeH * 0.35, cx - eyeOffsetX + eyeW, eyeY);
      ctx.moveTo(cx + eyeOffsetX - eyeW, eyeY);
      ctx.quadraticCurveTo(cx + eyeOffsetX, eyeY + eyeH * 0.35, cx + eyeOffsetX + eyeW, eyeY);
      ctx.stroke();
    } else {
      this.drawEyes(ctx, cx, eyeY, eyeOffsetX, eyeW, eyeH, rx, ry, emotion, timeSec);
    }

    // 3. Mouth (static or lip-synced)
    this.drawGlowingMouth(ctx, cx, cy + ry * 0.44, rx, ry, emotion, mouthOpen, mouthForm, timeSec);

    // 4. Extra emotion effects (tears, floating ?, anger vein, sweat drop)
    this.drawEmotionExtras(ctx, cx, cy, rx, ry, emotion, timeSec);

    ctx.restore();
  }

  applyGlowStyle(ctx, rx) {
    ctx.fillStyle = '#fffdf0';
    ctx.strokeStyle = '#fffdf0';
    ctx.shadowColor = 'rgba(255, 240, 175, 0.9)';
    ctx.shadowBlur = Math.max(4, rx * 0.16);
  }

  drawEyebrows(ctx, cx, browY, eyeOffsetX, eyeW, rx, ry, emotion) {
    const drawPair = (leftDyIn, leftDyOut, rightDyIn, rightDyOut, arch = 0) => {
      // Left brow
      ctx.beginPath();
      ctx.moveTo(cx - eyeOffsetX - eyeW * 0.95, browY + leftDyOut);
      ctx.quadraticCurveTo(cx - eyeOffsetX, browY + (leftDyIn + leftDyOut) * 0.5 - arch, cx - eyeOffsetX + eyeW * 0.95, browY + leftDyIn);
      ctx.stroke();
      // Right brow
      ctx.beginPath();
      ctx.moveTo(cx + eyeOffsetX - eyeW * 0.95, browY + rightDyIn);
      ctx.quadraticCurveTo(cx + eyeOffsetX, browY + (rightDyIn + rightDyOut) * 0.5 - arch, cx + eyeOffsetX + eyeW * 0.95, browY + rightDyOut);
      ctx.stroke();
    };

    const s = ry * 0.12;
    switch (emotion) {
      case 'happy':
      case 'excited':
        drawPair(-s * 0.3, s * 0.2, -s * 0.3, s * 0.2, s * 0.85);
        break;
      case 'tired':
        drawPair(-s * 0.6, s * 0.4, -s * 0.6, s * 0.4, -s * 0.15);
        break;
      case 'crying':
        drawPair(-s * 0.9, s * 0.5, -s * 0.9, s * 0.5, -s * 0.25);
        break;
      case 'angry':
        drawPair(s * 0.95, -s * 0.55, s * 0.95, -s * 0.55, 0);
        break;
      case 'shocked':
        drawPair(-s * 0.9, -s * 0.7, -s * 0.9, -s * 0.7, s * 0.7);
        break;
      case 'skeptical':
        drawPair(s * 0.2, s * 0.1, -s * 0.7, -s * 0.4, s * 0.35);
        break;
      case 'confused':
        drawPair(-s * 0.7, s * 0.2, s * 0.5, -s * 0.3, s * 0.2);
        break;
      case 'deadpan':
        drawPair(s * 0.2, s * 0.2, s * 0.2, s * 0.2, 0);
        break;
      case 'neutral':
      default:
        drawPair(0, 0, 0, 0, 0);
        break;
    }
  }

  drawEyes(ctx, cx, eyeY, eyeOffsetX, eyeW, eyeH, rx, ry, emotion, timeSec) {
    const drawHalfMoonEye = (ex, ey, w, h, topSlope = 0) => {
      ctx.beginPath();
      ctx.moveTo(ex - w, ey - h * 0.35 - topSlope);
      ctx.lineTo(ex + w, ey - h * 0.35 + topSlope);
      ctx.bezierCurveTo(ex + w, ey + h * 1.15, ex - w, ey + h * 1.15, ex - w, ey - h * 0.35 - topSlope);
      ctx.closePath();
      ctx.fill();
    };

    switch (emotion) {
      case 'happy': {
        ctx.lineWidth = Math.max(2.2, rx * 0.095);
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          ctx.beginPath();
          ctx.moveTo(ex - eyeW, eyeY + eyeH * 0.3);
          ctx.quadraticCurveTo(ex, eyeY - eyeH * 1.1, ex + eyeW, eyeY + eyeH * 0.3);
          ctx.stroke();
        });
        break;
      }
      case 'tired': {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          drawHalfMoonEye(ex, eyeY + eyeH * 0.1, eyeW * 0.95, eyeH * 0.85, -dir * eyeH * 0.18);
          // Eye bag line underneath
          ctx.lineWidth = Math.max(1.2, rx * 0.045);
          ctx.beginPath();
          ctx.moveTo(ex - eyeW * 0.75, eyeY + eyeH * 1.1);
          ctx.quadraticCurveTo(ex, eyeY + eyeH * 1.48, ex + eyeW * 0.75, eyeY + eyeH * 1.1);
          ctx.stroke();
        });
        break;
      }
      case 'crying': {
        ctx.lineWidth = Math.max(2.2, rx * 0.09);
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          ctx.beginPath();
          ctx.moveTo(ex - eyeW, eyeY + eyeH * 0.25);
          ctx.quadraticCurveTo(ex, eyeY - eyeH * 0.65, ex + eyeW, eyeY + eyeH * 0.25);
          ctx.stroke();
        });
        break;
      }
      case 'angry': {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          drawHalfMoonEye(ex, eyeY + eyeH * 0.1, eyeW, eyeH * 0.85, dir * eyeH * 0.42);
        });
        break;
      }
      case 'shocked': {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          ctx.beginPath();
          ctx.ellipse(ex, eyeY, eyeW * 0.92, eyeH * 1.25, 0, 0, Math.PI * 2);
          ctx.fill();
        });
        break;
      }
      case 'skeptical': {
        drawHalfMoonEye(cx - eyeOffsetX + rx * 0.04, eyeY, eyeW * 0.92, eyeH * 0.75, 0);
        ctx.beginPath();
        ctx.ellipse(cx + eyeOffsetX + rx * 0.04, eyeY, eyeW * 0.92, eyeH * 1.05, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'confused': {
        drawHalfMoonEye(cx - eyeOffsetX, eyeY, eyeW * 0.9, eyeH * 0.85, 0);
        ctx.beginPath();
        ctx.ellipse(cx + eyeOffsetX, eyeY - eyeH * 0.1, eyeW * 0.95, eyeH * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'excited': {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          // Sparkling star / diamond eyes
          const rOut = eyeW * 0.95;
          const rIn = eyeW * 0.35;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4;
            const rad = i % 2 === 0 ? rOut : rIn;
            const px = ex + Math.cos(ang) * rad;
            const py = eyeY + Math.sin(ang) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        });
        break;
      }
      case 'deadpan': {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          ctx.beginPath();
          ctx.arc(ex, eyeY, eyeW * 0.42, 0, Math.PI * 2);
          ctx.fill();
        });
        break;
      }
      case 'neutral':
      default: {
        [-1, 1].forEach(dir => {
          const ex = cx + dir * eyeOffsetX;
          drawHalfMoonEye(ex, eyeY, eyeW, eyeH, 0);
        });
        break;
      }
    }
  }

  drawGlowingMouth(ctx, mx, my, rx, ry, emotion, mouthOpen, mouthForm, timeSec) {
    ctx.save();
    this.applyGlowStyle(ctx, rx);
    ctx.lineWidth = Math.max(1.8, rx * 0.068);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const isSpeaking = mouthOpen >= 0.045;

    if (!isSpeaking) {
      // Silent mouth per emotion
      const w = rx * 0.22;
      if (emotion === 'happy' || emotion === 'excited') {
        ctx.beginPath();
        ctx.moveTo(mx - w, my - ry * 0.04);
        ctx.quadraticCurveTo(mx, my + ry * 0.11, mx + w, my - ry * 0.04);
        ctx.stroke();
      } else if (emotion === 'crying') {
        const cw = rx * 0.32;
        ctx.beginPath();
        ctx.moveTo(mx - cw, my + ry * 0.03);
        ctx.bezierCurveTo(mx - cw * 0.5, my - ry * 0.06, mx - cw * 0.15, my + ry * 0.06, mx, my - ry * 0.02);
        ctx.bezierCurveTo(mx + cw * 0.15, my + ry * 0.06, mx + cw * 0.5, my - ry * 0.06, mx + cw, my + ry * 0.03);
        ctx.stroke();
      } else if (emotion === 'tired' || emotion === 'shocked') {
        ctx.beginPath();
        ctx.ellipse(mx, my + ry * 0.02, rx * 0.12, ry * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (emotion === 'angry') {
        ctx.beginPath();
        ctx.moveTo(mx - w, my + ry * 0.04);
        ctx.quadraticCurveTo(mx, my - ry * 0.06, mx + w, my + ry * 0.04);
        ctx.stroke();
      } else if (emotion === 'confused') {
        ctx.beginPath();
        ctx.moveTo(mx - w * 0.8, my + ry * 0.02);
        ctx.quadraticCurveTo(mx, my - ry * 0.05, mx + w * 0.8, my + ry * 0.04);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(mx - w * 0.85, my);
        ctx.lineTo(mx + w * 0.85, my);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Speaking Lip-Sync Mouth!
    // Combine mouthOpen (volume) and mouthForm (spectral centroid: 0=round O, 1=wide Ah/Ee)
    const openClamped = Math.min(1.0, mouthOpen);
    const mw = rx * (0.16 + openClamped * 0.14 + mouthForm * 0.08);
    const mh = ry * (0.04 + openClamped * 0.21);

    if (emotion === 'happy' || emotion === 'excited') {
      // Smiling D-shape talking mouth
      ctx.beginPath();
      ctx.moveTo(mx - mw, my - mh * 0.25);
      ctx.quadraticCurveTo(mx, my - mh * 0.1, mx + mw, my - mh * 0.25);
      ctx.bezierCurveTo(mx + mw * 0.85, my + mh * 1.25, mx - mw * 0.85, my + mh * 1.25, mx - mw, my - mh * 0.25);
      ctx.closePath();
      ctx.fill();
    } else if (emotion === 'crying' || emotion === 'angry') {
      // Wavy / shouting bean shape
      ctx.beginPath();
      ctx.moveTo(mx - mw, my + mh * 0.2);
      ctx.quadraticCurveTo(mx, my - mh * 0.9, mx + mw, my + mh * 0.2);
      ctx.quadraticCurveTo(mx, my + mh * 0.95, mx - mw, my + mh * 0.2);
      ctx.closePath();
      ctx.fill();
    } else {
      // Natural glowing oval / rounded vowel mouth
      ctx.beginPath();
      ctx.ellipse(mx, my, mw * 0.88, mh * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawAnimatedTearDrops(ctx, cx, cy, rx, ry, timeSec) {
    ctx.save();
    this.applyGlowStyle(ctx, rx);
    const dropYOffset = ((timeSec * 1.4) % 1) * ry * 0.42;
    const alpha = 1.0 - ((timeSec * 1.4) % 1);
    ctx.fillStyle = `rgba(255, 253, 240, ${alpha.toFixed(2)})`;
    [-1, 1].forEach((dir, idx) => {
      const dy = ((timeSec * 1.4 + idx * 0.5) % 1) * ry * 0.42;
      const tx = cx + dir * rx * 0.62;
      const ty = cy + ry * 0.22 + dy;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(1.5, rx * 0.045), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  drawEmotionExtras(ctx, cx, cy, rx, ry, emotion, timeSec) {
    if (emotion === 'crying') {
      // Glowing tear streams on both cheeks + animated drops
      ctx.lineWidth = Math.max(2.4, rx * 0.085);
      [-1, 1].forEach(dir => {
        const sx = cx + dir * rx * 0.48;
        const sy = cy + ry * 0.02;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + dir * rx * 0.14, sy + ry * 0.28, sx + dir * rx * 0.08, sy + ry * 0.54);
        ctx.stroke();
      });
      this.drawAnimatedTearDrops(ctx, cx, cy, rx, ry, timeSec);
    } else if (emotion === 'confused') {
      // Floating glowing '?' next to head
      ctx.font = `bold ${Math.round(rx * 0.52)}px sans-serif`;
      const bob = Math.sin(timeSec * 3.2) * (ry * 0.08);
      ctx.fillText('?', cx + rx * 1.15, cy - ry * 0.35 + bob);
    } else if (emotion === 'angry') {
      // Comic anger cross mark near upper temple
      const ax = cx + rx * 0.62;
      const ay = cy - ry * 0.52;
      const s = rx * 0.12 * (1 + 0.15 * Math.sin(timeSec * 8));
      ctx.lineWidth = Math.max(1.5, rx * 0.05);
      ctx.beginPath();
      ctx.moveTo(ax - s, ay - s * 0.3); ctx.lineTo(ax - s * 0.3, ay - s * 0.3); ctx.lineTo(ax - s * 0.3, ay - s);
      ctx.moveTo(ax + s, ay - s * 0.3); ctx.lineTo(ax + s * 0.3, ay - s * 0.3); ctx.lineTo(ax + s * 0.3, ay - s);
      ctx.moveTo(ax - s, ay + s * 0.3); ctx.lineTo(ax - s * 0.3, ay + s * 0.3); ctx.lineTo(ax - s * 0.3, ay + s);
      ctx.moveTo(ax + s, ay + s * 0.3); ctx.lineTo(ax + s * 0.3, ay + s * 0.3); ctx.lineTo(ax + s * 0.3, ay + s);
      ctx.stroke();
    }
  }

  renderSideFace(ctx, cx, cy, rx, ry, emotion, mouthOpen, timeSec) {
    ctx.save();
    this.applyGlowStyle(ctx, rx);
    const blinking = this.isBlinking(timeSec, emotion);

    // Side profile faces LEFT in original sprite
    const eyeX = cx - rx * 0.64;
    const eyeY = cy - ry * 0.02;
    const eyeW = rx * 0.14;
    const eyeH = ry * 0.18;

    // Eyebrow
    ctx.lineWidth = Math.max(1.8, rx * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const browSlope = emotion === 'angry' ? -ry * 0.08 : (emotion === 'crying' || emotion === 'tired' ? ry * 0.08 : 0);
    ctx.moveTo(eyeX - eyeW * 0.6, eyeY - ry * 0.22 + browSlope);
    ctx.lineTo(eyeX + eyeW * 1.1, eyeY - ry * 0.22 - browSlope);
    ctx.stroke();

    // Eye
    if (blinking || emotion === 'happy' || emotion === 'crying') {
      ctx.beginPath();
      ctx.moveTo(eyeX - eyeW * 0.5, eyeY);
      ctx.quadraticCurveTo(eyeX + eyeW * 0.3, eyeY - (emotion === 'happy' ? eyeH * 0.6 : -eyeH * 0.3), eyeX + eyeW * 1.1, eyeY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, eyeW * 0.72, eyeH * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Side Mouth
    const mx = cx - rx * 0.74;
    const my = cy + ry * 0.36;
    if (mouthOpen >= 0.045) {
      const mh = ry * (0.05 + mouthOpen * 0.18);
      const mw = rx * (0.1 + mouthOpen * 0.12);
      ctx.beginPath();
      ctx.ellipse(mx + mw * 0.3, my, mw, mh, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + rx * 0.14, my + (emotion === 'happy' ? -ry * 0.04 : 0));
      ctx.stroke();
    }

    ctx.restore();
  }
}

window.CharacterRenderer = CharacterRenderer;
