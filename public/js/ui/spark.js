// Sparkline: a 60x16 inline SVG built with DOM APIs (plan §4 2.5, fleet component kit).
// Pure at import time. sparkPoints/sparkTrend are pure and tested in
// test/components.test.mjs; sparkline() touches the document only when called.
//
// <svg class="spark" viewBox="0 0 60 16" width="60" height="16" role="img" aria-label="ctx 64%, rising">
//   <line class="spark-th" .../>        optional dashed threshold (p2)
//   <polyline class="spark-line" points="..."/>
//   <rect class="spark-last" width="2" height="2" .../>
// </svg>

const SVGNS = 'http://www.w3.org/2000/svg';
export const SPARK_W = 60;
export const SPARK_H = 16;
/** Inset so the 1px stroke and the 2x2 last-point mark never clip at the edges. */
const PAD = 1;

const round2 = (n) => Math.round(n * 100) / 100;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The value range: explicit min/max win, else the data extent. */
export function sparkRange(values, { min, max } = {}) {
  const nums = (Array.isArray(values) ? values : []).filter(finite);
  let lo = finite(min) ? min : (nums.length ? Math.min(...nums) : 0);
  let hi = finite(max) ? max : (nums.length ? Math.max(...nums) : 0);
  if (hi < lo) [lo, hi] = [hi, lo];
  return { lo, hi };
}

/** Value -> y in an h-high box (top is high), clamped inside the padding. */
function yOf(v, lo, hi, h) {
  const inner = h - 2 * PAD;
  if (hi === lo) return round2(h / 2);
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return round2(PAD + (1 - t) * inner);
}

/**
 * values -> polyline points "x,y x,y ...". Points are spread evenly over the
 * width by index; non-finite values (gaps) are skipped but keep their slot.
 * A flat or single-value series sits on the middle line.
 */
export function sparkPoints(values, w = SPARK_W, h = SPARK_H, opts = {}) {
  const list = Array.isArray(values) ? values : [];
  if (!list.some(finite)) return '';
  const { lo, hi } = sparkRange(list, opts);
  const n = list.length;
  const inner = w - 2 * PAD;
  const out = [];
  list.forEach((v, i) => {
    if (!finite(v)) return;
    const x = n === 1 ? w - PAD : round2(PAD + (i * inner) / (n - 1));
    out.push(`${x},${yOf(v, lo, hi, h)}`);
  });
  return out.join(' ');
}

/** 'rising' | 'falling' | 'flat': last value against the first, with a 5% dead band. */
export function sparkTrend(values) {
  const nums = (Array.isArray(values) ? values : []).filter(finite);
  if (nums.length < 2) return 'flat';
  const first = nums[0];
  const last = nums[nums.length - 1];
  const span = Math.max(...nums) - Math.min(...nums);
  if (span === 0 || Math.abs(last - first) <= span * 0.05) return 'flat';
  return last > first ? 'rising' : 'falling';
}

/** The accessible name: "<label>, <trend>", or "no data". */
export function sparkLabel(label, values) {
  const nums = (Array.isArray(values) ? values : []).filter(finite);
  const head = label == null || label === '' ? 'trend' : String(label);
  return nums.length ? `${head}, ${sparkTrend(nums)}` : `${head}, no data`;
}

function node(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/**
 * Build the sparkline element. `label` is text (builder data allowed: it only
 * reaches setAttribute/textContent). `threshold` draws a dashed p2 line.
 */
export function sparkline(values, { label = null, threshold = null, min, max, w = SPARK_W, h = SPARK_H } = {}) {
  const svg = node('svg', { class: 'spark', viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img' });
  const name = sparkLabel(label, values);
  svg.setAttribute('aria-label', name);
  const title = document.createElementNS(SVGNS, 'title');
  title.textContent = name;
  svg.appendChild(title);
  const opts = { min, max };
  if (finite(threshold)) {
    const { lo, hi } = sparkRange([...(Array.isArray(values) ? values : []), threshold], opts);
    const y = yOf(threshold, lo, hi, h);
    svg.appendChild(node('line', { class: 'spark-th', x1: 0, x2: w, y1: y, y2: y }));
    opts.min = lo;
    opts.max = hi;
  }
  const pts = sparkPoints(values, w, h, opts);
  if (pts) {
    svg.appendChild(node('polyline', { class: 'spark-line', points: pts }));
    const last = pts.split(' ').pop().split(',').map(Number);
    svg.appendChild(node('rect', { class: 'spark-last', x: round2(last[0] - 1), y: round2(last[1] - 1), width: 2, height: 2 }));
  }
  return svg;
}
