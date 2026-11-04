// props.js — Hand-held props and set pieces drawn in the same ink style as the character.
// All props are drawn around the hand's grip point (origin) in an upright frame (+y = down).
(function () {
  const INK = '#141312';

  function glow(ctx, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  const PropPainter = {
    // Called BEFORE the hand is drawn so the fingers wrap over the prop.
    draw(ctx, id, t, opts = {}) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      switch (id) {
        case 'phone': this.phone(ctx, t); break;
        case 'mug': this.mug(ctx, t); break;
        case 'mic': this.mic(ctx, t); break;
        case 'controller': this.controller(ctx, t); break;
        case 'book': this.book(ctx, t); break;
        default: break;
      }
      ctx.restore();
    },

    phone(ctx, t) {
      // Body
      rr(ctx, -9, -36, 19, 38, 4);
      ctx.fillStyle = '#121214';
      ctx.fill();
      ctx.stroke();
      // Glowing screen
      ctx.save();
      glow(ctx, 'rgba(150, 200, 255, 0.85)', 10);
      const g = ctx.createLinearGradient(0, -33, 0, -2);
      g.addColorStop(0, '#cfe7ff');
      g.addColorStop(1, '#7f9cff');
      ctx.fillStyle = g;
      rr(ctx, -7, -33, 15, 31, 2.5);
      ctx.fill();
      ctx.restore();
      // Scrolling feed lines
      ctx.save();
      rr(ctx, -7, -33, 15, 31, 2.5);
      ctx.clip();
      ctx.fillStyle = 'rgba(40, 50, 90, 0.45)';
      const scroll = (t * 14) % 9;
      for (let i = -1; i < 5; i++) {
        const y = -31 + i * 9 - scroll;
        ctx.fillRect(-5, y, 11, 2);
        ctx.fillRect(-5, y + 3.5, 7, 1.6);
      }
      ctx.restore();
      ctx.fillStyle = '#121214';
      rr(ctx, -2.5, -35, 6, 2, 1);
      ctx.fill();
    },

    mug(ctx, t) {
      // Handle (toward the grip)
      ctx.beginPath();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.arc(-11, -12, 7, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#e9e4d6';
      ctx.stroke();
      // Body
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(-10, -26);
      ctx.lineTo(14, -26);
      ctx.quadraticCurveTo(15, -4, 12, 2);
      ctx.lineTo(-8, 2);
      ctx.quadraticCurveTo(-11, -4, -10, -26);
      ctx.closePath();
      ctx.fillStyle = '#ebe6d8';
      ctx.fill();
      ctx.stroke();
      // Shading band + logo heart
      ctx.fillStyle = 'rgba(92, 88, 81, 0.25)';
      ctx.fillRect(6, -24, 6, 25);
      ctx.fillStyle = '#7d7970';
      ctx.beginPath();
      ctx.arc(1, -14, 2.4, 0, Math.PI * 2);
      ctx.arc(5, -14, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-1.2, -13);
      ctx.lineTo(3, -8.6);
      ctx.lineTo(7.2, -13);
      ctx.fill();
      // Coffee surface
      ctx.beginPath();
      ctx.ellipse(2, -26, 12, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3b2416';
      ctx.fill();
      ctx.stroke();
      // Steam wisps
      ctx.save();
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.7 + i * 0.33) % 1;
        ctx.strokeStyle = `rgba(255, 252, 238, ${(0.55 * Math.sin(ph * Math.PI)).toFixed(3)})`;
        const x0 = -4 + i * 6;
        const y0 = -30 - ph * 22;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(x0 + 5, y0 - 5, x0 - 5, y0 - 9, x0 + 1, y0 - 15);
        ctx.stroke();
      }
      ctx.restore();
    },

    mic(ctx) {
      // Handle
      ctx.beginPath();
      ctx.moveTo(-4, 10);
      ctx.lineTo(4, 10);
      ctx.lineTo(6, -20);
      ctx.lineTo(-6, -20);
      ctx.closePath();
      ctx.fillStyle = '#1d1d20';
      ctx.fill();
      ctx.stroke();
      // Ring
      rr(ctx, -7.5, -24, 15, 5, 2);
      ctx.fillStyle = '#4a4a50';
      ctx.fill();
      ctx.stroke();
      // Grill ball
      ctx.beginPath();
      ctx.arc(0, -32, 10, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(-3, -36, 1, 0, -32, 11);
      g.addColorStop(0, '#d9d6cf');
      g.addColorStop(1, '#77736c');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.45)';
      ctx.lineWidth = 0.9;
      for (let i = -12; i <= 12; i += 3.2) {
        ctx.beginPath(); ctx.moveTo(i, -44); ctx.lineTo(i + 6, -20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, -44); ctx.lineTo(i - 6, -20); ctx.stroke();
      }
      ctx.restore();
    },

    controller(ctx) {
      ctx.beginPath();
      ctx.moveTo(-20, -12);
      ctx.quadraticCurveTo(0, -17, 20, -12);
      ctx.quadraticCurveTo(29, -10, 28, 4);
      ctx.quadraticCurveTo(27, 13, 19, 10);
      ctx.quadraticCurveTo(13, 4, 0, 4);
      ctx.quadraticCurveTo(-13, 4, -19, 10);
      ctx.quadraticCurveTo(-27, 13, -28, 4);
      ctx.quadraticCurveTo(-29, -10, -20, -12);
      ctx.closePath();
      ctx.fillStyle = '#2a2a2f';
      ctx.fill();
      ctx.stroke();
      // D-pad
      ctx.fillStyle = '#8d8a83';
      ctx.fillRect(-17, -6, 8, 2.6);
      ctx.fillRect(-14.3, -8.7, 2.6, 8);
      // Face buttons
      const btn = [[13, -8], [17, -4.5], [9, -4.5], [13, -1]];
      btn.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fillStyle = ['#e8e3d6', '#c9c4b7', '#c9c4b7', '#e8e3d6'][i];
        ctx.fill();
      });
      // Glowing status LED
      ctx.save();
      glow(ctx, 'rgba(255, 240, 175, 0.9)', 6);
      ctx.fillStyle = '#fffdf0';
      ctx.fillRect(-2.5, -10, 5, 1.6);
      ctx.restore();
    },

    book(ctx) {
      ctx.save();
      ctx.rotate(-0.08);
      // Pages edge
      rr(ctx, -12, -40, 30, 40, 2);
      ctx.fillStyle = '#ede7d6';
      ctx.fill();
      ctx.stroke();
      // Cover
      rr(ctx, -15, -42, 30, 40, 3);
      ctx.fillStyle = '#6e3b34';
      ctx.fill();
      ctx.stroke();
      // Spine shade + title
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-15, -42, 5, 40);
      ctx.fillStyle = '#e6cf94';
      ctx.fillRect(-6, -34, 16, 2.4);
      ctx.fillRect(-4, -29, 12, 1.8);
      ctx.restore();
    },

    // ---- Desk set piece (for "Sit at Desk / Typing") — local rig space, facing +x ----
    drawStool(ctx) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.fillStyle = '#3a3027';
      // legs
      [[-26, -6], [16, 6]].forEach(([x, lean]) => {
        ctx.beginPath();
        ctx.moveTo(x, -70);
        ctx.lineTo(x + lean, 0);
        ctx.lineTo(x + lean + 6, 0);
        ctx.lineTo(x + 6, -70);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillRect(-22, -34, 40, 4);
      // seat
      rr(ctx, -38, -78, 70, 10, 4);
      ctx.fillStyle = '#4a3d31';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },

    drawDesk(ctx, t) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      const top = -112;
      // Desk legs
      ctx.fillStyle = '#2f2721';
      ctx.fillRect(76, top, 8, -top);
      ctx.strokeRect(76, top, 8, -top);
      ctx.fillRect(222, top, 8, -top);
      ctx.strokeRect(222, top, 8, -top);
      // Laptop screen glow onto the character
      ctx.save();
      const glowG = ctx.createRadialGradient(150, top - 30, 4, 120, top - 30, 120);
      glowG.addColorStop(0, 'rgba(150, 190, 255, 0.28)');
      glowG.addColorStop(1, 'rgba(150, 190, 255, 0)');
      ctx.fillStyle = glowG;
      ctx.fillRect(0, top - 150, 280, 150);
      ctx.restore();
      // Laptop screen (thin slab tilted back) + base
      ctx.beginPath();
      ctx.moveTo(146, top - 6);
      ctx.lineTo(160, top - 62);
      ctx.lineTo(166, top - 61);
      ctx.lineTo(152, top - 6);
      ctx.closePath();
      ctx.fillStyle = '#26262b';
      ctx.fill();
      ctx.stroke();
      ctx.save();
      glow(ctx, 'rgba(160, 205, 255, 0.95)', 12 + Math.sin(t * 3) * 2);
      ctx.strokeStyle = '#bcd8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(147.5, top - 9);
      ctx.lineTo(160.5, top - 59);
      ctx.stroke();
      ctx.restore();
      rr(ctx, 84, top - 6, 72, 6, 2);
      ctx.fillStyle = '#3a3a40';
      ctx.fill();
      ctx.stroke();
      // Mug on desk
      ctx.save();
      ctx.translate(206, top - 1);
      ctx.scale(0.9, 0.9);
      PropPainter.mug(ctx, t);
      ctx.restore();
      // Desk top slab
      rr(ctx, 64, top, 184, 10, 3);
      ctx.fillStyle = '#5a4636';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(70, top + 6);
      ctx.lineTo(242, top + 6);
      ctx.stroke();
      ctx.restore();
    },
  };

  window.PropPainter = PropPainter;
})();
