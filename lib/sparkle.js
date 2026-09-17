// Lightweight celebratory particle burst — mirrors the "Sparkle Burst" mockup design
// (2026-09-16, approved for implementation). Two tiers: a small burst when a task/session is
// marked complete, a fuller one on Save & Replan. Deliberately NOT a React component: a single
// module-level canvas is created lazily on first use and painted only while particles are
// alive — nothing runs at rest, no idle animation loop, no library. Colors are read live from
// the app's real CSS custom properties (--amber/--blue/--teal/--green in app/globals.css) via
// getComputedStyle, so this always matches the current theme without hardcoding hex values here.

let canvas = null, ctx = null, dpr = 1;
let particles = [];
let raf = null;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9998";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawStar(p) {
  const s = p.size;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s * 0.28, -s * 0.28); ctx.lineTo(s, 0);
  ctx.lineTo(s * 0.28, s * 0.28); ctx.lineTo(0, s); ctx.lineTo(-s * 0.28, s * 0.28);
  ctx.lineTo(-s, 0); ctx.lineTo(-s * 0.28, -s * 0.28); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function tick() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  let alive = false;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life++;
    if (p.life > p.maxLife) { particles.splice(i, 1); continue; }
    alive = true;
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
    p.x += p.vx * 8; p.y += p.vy * 8; p.rot += p.vr;
    const t = p.life / p.maxLife;
    const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = p.color;
    if (p.kind === "star") drawStar(p);
    else if (p.kind === "dot") { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.42, 0, 7); ctx.fill(); }
    else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size * 0.5, -p.size * 0.18, p.size, p.size * 0.36); ctx.restore(); }
  }
  ctx.globalAlpha = 1;
  if (alive) raf = requestAnimationFrame(tick);
  else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}

function spawn(x, y, { count, spread, size, life, colors }) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = spread * 0.4 + Math.random() * spread * 0.6;
    const kind = Math.random() < 0.6 ? "star" : Math.random() < 0.5 ? "dot" : "bar";
    particles.push({
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 0.9,
      g: 0.013 + Math.random() * 0.009,
      drag: 0.982,
      life: 0, maxLife: life[0] + Math.random() * (life[1] - life[0]),
      size: size[0] + Math.random() * (size[1] - size[0]),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.09,
      color: colors[Math.floor(Math.random() * colors.length)],
      kind,
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

const TIERS = {
  // Marking one task/session complete — small, quick.
  task: { count: 20, spread: 1.5, size: [3, 6], life: [95, 120], colors: () => [cssVar("--amber"), cssVar("--amber"), cssVar("--green")] },
  // Save & Replan — the bigger moment, fuller burst in the full brand mix.
  save: { count: 60, spread: 2.1, size: [3, 7], life: [130, 165], colors: () => [cssVar("--amber"), cssVar("--amber"), cssVar("--blue"), cssVar("--teal")] },
};

// `target` is either a DOM element (its center — or top-center for "save" — is used) or a plain
// {x,y} point. `tier` is "task" (default) or "save". No-ops server-side and when the user has
// prefers-reduced-motion set, same as the mockup.
export function sparkleBurst(target, tier = "task") {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (!target) return;
  ensureCanvas();
  const cfg = TIERS[tier] || TIERS.task;
  let x, y;
  if (target instanceof Element) {
    const r = target.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = tier === "save" ? r.top : r.top + r.height / 2;
  } else {
    ({ x, y } = target);
  }
  spawn(x, y, { ...cfg, colors: cfg.colors() });
}
