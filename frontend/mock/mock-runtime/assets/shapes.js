// Asset module for the fake engine: small drawing helpers used by the generated scene code.
export function background(ctx, w, h, hue, t) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'hsl(' + ((hue + t * 12) % 360) + ',55%,22%)');
  g.addColorStop(1, 'hsl(' + ((hue + 70 + t * 12) % 360) + ',60%,38%)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function orbs(ctx, w, h, hue, t, idx) {
  for (let i = 0; i < 7; i++) {
    const a = t * (0.6 + i * 0.17) + i * 1.7 + idx;
    const x = w * (0.5 + 0.38 * Math.cos(a));
    const y = h * (0.5 + 0.3 * Math.sin(a * 1.3));
    const r = 28 + 14 * Math.sin(t * 2 + i) + i * 5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + ((hue + 40 + i * 25) % 360) + ',85%,68%,.8)';
    ctx.fill();
  }
}

export function title(ctx, w, h, text, t) {
  const k = Math.min(1, t / 0.6);
  const ease = 1 - Math.pow(1 - k, 3);
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.fillStyle = '#F3EAD7';
  ctx.font = '700 72px Georgia, serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 60 + (1 - ease) * -80, h * 0.46);
  ctx.restore();
}

export function caption(ctx, w, h, words, t, dur) {
  const shown = Math.max(1, Math.floor((t / dur) * words.length) + 1);
  ctx.fillStyle = 'rgba(34,30,26,.65)';
  ctx.fillRect(0, h * 0.74, w, 90);
  ctx.fillStyle = '#F2B531';
  ctx.font = '600 38px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(words.slice(0, shown).join(' ').slice(-48), 40, h * 0.74 + 45);
}
