// Pháo hoa trên canvas
const COLORS = ["#ffd36b", "#ff5f9e", "#6bd5ff", "#9b7bff", "#7dffb0", "#ff8a4c", "#ffffff"];
let cv, ctx, W = 0, H = 0, dpr = 1, running = false;
const rockets = [];
const sparks = [];

export function initFx(canvas) {
  cv = canvas;
  ctx = cv.getContext("2d");
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener("resize", resize);
  if (!running) { running = true; requestAnimationFrame(loop); }
}

/** Bắn 1 quả pháo. x: 0–1 theo chiều ngang. size: 1 bình thường, 2 lớn */
export function launch(x = 0.15 + Math.random() * 0.7, size = 1, color) {
  if (!ctx || rockets.length > 40) return;
  rockets.push({
    x: x * W, y: H * 0.66, vx: (Math.random() - 0.5) * 0.6,
    vy: -(H * 0.011 + Math.random() * H * 0.004),
    ty: H * (0.08 + Math.random() * 0.3),
    color: color || COLORS[(Math.random() * COLORS.length) | 0], size,
  });
}

/** Màn pháo hoa lớn (giao thừa) */
export function finale(seconds = 8) {
  const end = performance.now() + seconds * 1000;
  const t = setInterval(() => {
    if (performance.now() > end) return clearInterval(t);
    for (let i = 0; i < 3; i++) launch(undefined, Math.random() < 0.3 ? 2 : 1);
  }, 220);
}

function burst(r) {
  const n = r.size > 1 ? 110 : 60;
  const speed = (r.size > 1 ? 4.2 : 3) * (H / 800 + 0.4);
  const ring = Math.random() < 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const v = ring ? speed : speed * (0.3 + Math.random() * 0.7);
    sparks.push({
      x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 1, decay: 0.012 + Math.random() * 0.012,
      color: Math.random() < 0.15 ? "#ffffff" : r.color,
    });
  }
  if (sparks.length > 1600) sparks.splice(0, sparks.length - 1600);
}

function loop() {
  requestAnimationFrame(loop);
  if (document.hidden || !ctx) return;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";

  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.x += r.vx; r.y += r.vy; r.vy *= 0.985;
    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(r.x, r.y, 2, 0, 7); ctx.fill();
    if (r.y <= r.ty || r.vy > -1) { burst(r); rockets.splice(i, 1); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.045; p.vx *= 0.985; p.vy *= 0.985;
    p.life -= p.decay;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * p.life + 0.6, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
