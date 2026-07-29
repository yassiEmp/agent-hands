// Motion and timing model. Pure functions, no I/O.
//
// Detectors score path entropy and the distribution of inter-event timings.
// Uniform random is as machine-like as no randomness at all, so every delay
// here is lognormal — the shape human motor timing actually has.

export const rand = (a, b) => a + Math.random() * (b - a);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function lognormal(median, sigma, cap) {
  const u = Math.max(1e-9, Math.random()), v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(cap, median * Math.exp(sigma * z));
}

// Fitts's law. Near targets and wide targets are reached faster.
export function moveDuration(dist, width, speed) {
  const index = Math.log2((2 * dist) / Math.max(8, width) + 1);
  const ms = (60 + 105 * index) * rand(0.82, 1.24) / speed;
  return Math.max(140, Math.min(1100, ms));
}

// Cubic Bezier with a perpendicular bow. A straight line is the tell.
export function bezierPath(from, to, steps) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(90, dist * rand(0.08, 0.22)) * (Math.random() < 0.5 ? -1 : 1);
  const nx = -dy / dist, ny = dx / dist;

  const c1 = {
    x: from.x + dx * rand(0.15, 0.35) + nx * bow,
    y: from.y + dy * rand(0.15, 0.35) + ny * bow,
  };
  const c2 = {
    x: from.x + dx * rand(0.62, 0.85) + nx * bow * rand(0.3, 0.7),
    y: from.y + dy * rand(0.62, 0.85) + ny * bow * rand(0.3, 0.7),
  };

  const points = [];
  for (let i = 1; i <= steps; i++) {
    let t = i / steps;
    t = t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out
    const u = 1 - t;
    const x = u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x;
    const y = u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y;
    const tremor = i < steps - 2 ? 0.7 : 0.15; // the hand steadies on approach
    points.push({ x: x + rand(-tremor, tremor), y: y + rand(-tremor, tremor) });
  }
  return points;
}
