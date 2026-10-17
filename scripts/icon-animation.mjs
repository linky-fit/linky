#!/usr/bin/env node
// Regenerates the handwriting reveal in apps/linky-app/public/icon-animated.svg.
//
// The filled "L" glyph is shown through a mask that a pen stroke paints along the glyph's centreline. The stroke is
// made of short polygon slices, each exactly as wide as the glyph is thick there, growing one after another. The
// edges and the centreline are measured from the glyph outline itself, so the pen never shows more of the glyph than
// it has reached, and the two places where the stroke crosses itself are handled explicitly.
//
//   node scripts/icon-animation.mjs                 # rewrite the SVG in place
//   node scripts/icon-animation.mjs --dry-run       # only print the measurements
//   node scripts/icon-animation.mjs --dump out.tsv  # also write the per-sample measurements
//
// Tunables: DURATION (seconds for the whole stroke), STEP (segment length in SVG units), MARGIN (extra band width
// outside crossings so the glyph's anti-aliased edge pixels are fully shown).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SVG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/linky-app/public/icon-animated.svg",
);
const DURATION = 2.4;
const STEP = 8;
const MARGIN = 3;
const ZONE_MARGIN = 0; // no extra width where the arm that passes a crossing first has no edge of its own
const MIN_HALF_WIDTH = 4; // keeps the band visible at the glyph's pointed start and end
const MARGIN_FADE = 5; // samples over which the margin fades out before a crossing
const FILLET_TRIM = 5; // samples next to a foreign edge that are not trusted as the arm's own edge
const FILLET_MARGIN = 12; // the designer rounded the concave corners where two arms meet
const FILLET = 14; // how far the fillets' tangent run-in reaches along an arm beyond the crossing itself
const ALIGN_MIN = Math.cos((20 * Math.PI) / 180);
const dryRun = process.argv.includes("--dry-run");
const dumpIndex = process.argv.indexOf("--dump"); // --dump <file>: per-sample measurements, tab separated
const dumpPath = dumpIndex >= 0 ? process.argv[dumpIndex + 1] : null;

// Rough centreline of the glyph in writing order; it is refined against the outline below.
const SEED =
  `177.5,458.4 180.8,456.3 191.3,450.3 202.1,445.2 213.3,440.9 224.7,437.0 236.1,433.4 247.6,430.0 259.2,426.9 270.8,423.8 282.5,421.0 294.1,418.1 305.8,415.3 317.4,412.4 329.1,409.5 340.6,406.1 351.9,402.1 363.2,398.0 374.4,393.8 385.7,389.6 396.9,385.4 408.1,381.0 419.1,376.2 429.5,370.4 439.7,364.0 449.6,357.2 459.3,350.1 468.7,342.7 477.8,334.8 486.4,326.5 494.6,317.7 502.2,308.5 509.3,298.8 515.7,288.6 521.3,278.0 525.8,266.9 528.4,255.2 527.8,243.3 521.1,233.6 509.8,230.0 498.0,231.9 487.1,236.7 476.8,243.0 467.3,250.3 458.5,258.5 450.4,267.2 442.8,276.6 435.7,286.2 429.0,296.2 422.5,306.3 416.4,316.6 410.4,327.0 404.7,337.6 399.1,348.2 393.6,358.9 389.0,369.9 384.2,380.9 377.9,391.1 370.7,400.7 364.4,410.9 359.3,421.8 353.4,432.2 346.9,442.3 340.2,452.3 333.0,461.8 324.8,470.7 316.5,479.3 308.2,488.0 299.9,496.7 291.1,504.8 281.5,512.0 271.4,518.5 261.0,524.3 250.1,529.4 238.8,533.6 227.3,536.8 215.5,539.1 203.6,540.3 191.6,539.8 179.9,537.3 169.2,531.9 161.7,522.7 159.6,511.0 162.7,499.5 169.5,489.6 178.5,481.7 188.8,475.6 199.9,471.1 211.4,467.9 223.3,465.9 235.2,465.1 247.2,465.2 259.2,466.2 271.1,468.0 282.8,470.5 294.3,473.9 305.6,477.9 316.9,482.0 328.2,486.1 339.5,490.1 350.7,494.5 361.8,499.0 372.9,503.5 384.1,507.9 395.3,512.2 406.5,516.3 417.9,520.3 429.3,524.0 440.8,527.4 452.4,530.5 464.1,533.2 475.9,535.3 487.7,537.1 499.7,538.4 511.6,539.2 523.6,539.4 535.6,538.9 547.6,537.6 559.4,535.7 571.1,532.9 582.5,529.1 593.5,524.3 603.9,518.4 613.6,511.3 622.1,502.9 628.9,493.1 633.0,481.8 632.4,469.9 626.5,459.6 616.7,452.8 605.1,450.1 593.1,450.7 592.5,450.8 587.0,451.4`
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));

// ---------- geometry helpers ----------
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function parsePath(d) {
  const tokens = d.match(/[MCLZmclz]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const contours = [];
  let cur = null;
  let i = 0;
  let cmd = null;
  let pt = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MCLZ]/i.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === "Z" || cmd === "z") continue;
    }
    if (cmd === "M") {
      pt = [num(), num()];
      cur = { segs: [] };
      contours.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      const p = [num(), num()];
      cur.segs.push({ type: "L", p0: pt, p1: p });
      pt = p;
    } else if (cmd === "C") {
      const c1 = [num(), num()];
      const c2 = [num(), num()];
      const p = [num(), num()];
      cur.segs.push({ type: "C", p0: pt, c1, c2, p1: p });
      pt = p;
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return contours;
}

function bezierPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

function flatten(contour, n) {
  const pts = [];
  for (const s of contour.segs) {
    if (s.type === "L") pts.push(s.p0);
    else
      for (let k = 0; k < n; k++)
        pts.push(bezierPoint(s.p0, s.c1, s.c2, s.p1, k / n));
  }
  pts.push(contour.segs[contour.segs.length - 1].p1);
  return pts;
}

function resample(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    let a = pts[k - 1];
    const b = pts[k];
    let d = dist(a, b);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p);
      a = p;
      d = dist(a, b);
      acc = 0;
    }
    acc += d;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const tangents = (pts) =>
  pts.map((_, k) => {
    const a = pts[Math.max(0, k - 2)];
    const b = pts[Math.min(pts.length - 1, k + 2)];
    const d = dist(a, b);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  });

const smooth = (arr, half) =>
  arr.map((_, k) => {
    let sum = 0;
    let n = 0;
    for (
      let j = Math.max(0, k - half);
      j <= Math.min(arr.length - 1, k + half);
      j++
    ) {
      sum += arr[j];
      n++;
    }
    return sum / n;
  });

const cumulativeLengths = (pts) => {
  const l = [0];
  for (let k = 1; k < pts.length; k++)
    l[k] = l[k - 1] + dist(pts[k - 1], pts[k]);
  return l;
};

// Linear interpolation across runs of untrusted samples.
function fillRuns(values, trusted) {
  const out = values.slice();
  for (let k = 0; k < values.length; k++) {
    if (trusted[k]) continue;
    let a = k - 1;
    while (a >= 0 && !trusted[a]) a--;
    let b = k + 1;
    while (b < values.length && !trusted[b]) b++;
    if (a < 0 && b >= values.length)
      throw new Error("no trusted thickness measurements");
    if (a < 0) out[k] = values[b];
    else if (b >= values.length) out[k] = values[a];
    else out[k] = values[a] + ((values[b] - values[a]) * (k - a)) / (b - a);
  }
  return out;
}

// ---------- the glyph outline ----------
const svg = readFileSync(SVG_PATH, "utf8");
const glyphMatch = svg.match(
  /<g mask="url\(#write-mask\)">\s*<path d="([^"]+)"/,
);
if (!glyphMatch) throw new Error("glyph path not found in " + SVG_PATH);
const edges = [];
for (const contour of parsePath(glyphMatch[1])) {
  const poly = flatten(contour, 32);
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    if (dist(a, b) > 1e-6) edges.push([a, b]);
  }
}

// Nearest point where the ray p + s*dir leaves the glyph, and the direction of the outline edge it crosses.
function rayHit(p, dir) {
  let best = Infinity;
  let edge = null;
  for (const [a, b] of edges) {
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const dx = a[0] - p[0];
    const dy = a[1] - p[1];
    const s = (dx * ey - dy * ex) / den;
    const u = (dx * dir[1] - dy * dir[0]) / den;
    if (s > 1e-6 && u >= 0 && u <= 1 && s < best) {
      best = s;
      edge = [ex, ey];
    }
  }
  if (!edge) return { d: Infinity, edge: [0, 0] };
  const l = Math.hypot(edge[0], edge[1]);
  return { d: best, edge: [edge[0] / l, edge[1] / l] };
}

// Distance from p to the glyph's edge on each side, measured perpendicular to the pen direction t. Near a crossing a
// side is trusted only when its ray leaves the glyph through an edge that runs roughly along the pen direction, i.e.
// the arm's own edge; there the ray otherwise exits through the other arm's edge, or through the rounded fillet where
// the arms meet, at an oblique angle, and such a side is interpolated from its trusted neighbours instead. Away from
// crossings every hit is the glyph's real boundary, however oblique (the inside of a tight bend, for instance).
function measure(p, t, nearCrossing) {
  const n = [-t[1], t[0]];
  const side = (dir) => {
    const hit = rayHit(p, dir);
    const alignment = Math.abs(hit.edge[0] * t[0] + hit.edge[1] * t[1]);
    return {
      d: hit.d,
      angle: (Math.acos(Math.min(1, alignment)) * 180) / Math.PI,
      ok:
        Number.isFinite(hit.d) &&
        hit.d < 30 &&
        (!nearCrossing || alignment >= ALIGN_MIN),
    };
  };
  return { left: side(n), right: side([-n[0], -n[1]]) };
}

// ---------- crossings ----------
function segmentIntersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const q = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

// Where the centreline meets itself, the arm's own edges are hidden under the other arm for a stretch on either side
// of the crossing. Returns, per sample, 0 (no crossing), 1 (this arm passes the crossing first) or 2 (second).
function crossingZones(pts, widths, lengths) {
  const zone = new Array(pts.length).fill(0);
  const crossings = [];
  const widthNear = (k) => {
    const v = [];
    for (
      let m = Math.max(0, k - 25);
      m <= Math.min(pts.length - 1, k + 25);
      m++
    )
      if (Math.abs(m - k) >= 15) v.push(widths[m]);
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 6; j < pts.length - 1; j++) {
      const x = segmentIntersection(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (!x) continue;
      const ti = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      const tj = [pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]];
      const sinT =
        Math.abs(ti[0] * tj[1] - ti[1] * tj[0]) /
        (Math.hypot(...ti) * Math.hypot(...tj));
      const wi = widthNear(i);
      const wj = widthNear(j);
      const halfI =
        wj / 2 / Math.max(sinT, 0.3) + (wi / 2) * (1 - sinT) + FILLET;
      const halfJ =
        wi / 2 / Math.max(sinT, 0.3) + (wj / 2) * (1 - sinT) + FILLET;
      const si = lengths[i] + x.t * (lengths[i + 1] - lengths[i]);
      const sj = lengths[j] + x.u * (lengths[j + 1] - lengths[j]);
      for (let k = 0; k < pts.length; k++) {
        if (Math.abs(lengths[k] - si) <= halfI) zone[k] = Math.max(zone[k], 1);
        if (Math.abs(lengths[k] - sj) <= halfJ) zone[k] = Math.max(zone[k], 2);
      }
      crossings.push({
        at: [si, sj].map((v) => v.toFixed(0)).join("/"),
        angle: ((Math.asin(sinT) * 180) / Math.PI).toFixed(0),
      });
    }
  }
  return { zone, crossings };
}

// Distance, in samples, to the nearest sample whose edge on that side is not the arm's own.
const samplesToForeignEdge = (own) => {
  const d = new Array(own.length).fill(Infinity);
  for (let k = 0, last = -Infinity; k < own.length; k++) {
    if (!own[k]) last = k;
    d[k] = k - last;
  }
  for (let k = own.length - 1, next = Infinity; k >= 0; k--) {
    if (!own[k]) next = k;
    d[k] = Math.min(d[k], next - k);
  }
  return d;
};
// The rounded fillet where two arms meet starts off tangent to the arm's edge, so its first stretch passes as the
// arm's own edge while already bulging outwards. Samples that close to a foreign edge are dropped as well.
const trimNearForeign = (own) => {
  const d = samplesToForeignEdge(own);
  return own.map((o, k) => o && d[k] > FILLET_TRIM);
};

// ---------- refine the centreline and measure the thickness ----------
let pts = resample(SEED, 2);
let left = []; // distance to the glyph's edge on the left of the pen direction, per sample
let right = [];
let ownLeft = []; // whether that edge was measured (the arm's own edge) or interpolated
let ownRight = [];
let widths = [];
let zone = [];
let crossings = [];
let lastRaw = [];
// Each pass measures the edges, interpolates across the stretches with no edge of their own, and moves the
// centreline halfway towards the middle of the two edges. The position is never smoothed as a whole, which would pull
// it to the inside of every bend; only the measured offsets are.
for (let iter = 0; iter < 8; iter++) {
  const tan = tangents(pts);
  const raw = pts.map((p, k) => measure(p, tan[k], zone[k] !== 0));
  lastRaw = raw;
  ownLeft = trimNearForeign(raw.map((r) => r.left.ok));
  ownRight = trimNearForeign(raw.map((r) => r.right.ok));
  left = smooth(
    fillRuns(
      raw.map((r) => (r.left.ok ? r.left.d : 0)),
      ownLeft,
    ),
    1,
  );
  right = smooth(
    fillRuns(
      raw.map((r) => (r.right.ok ? r.right.d : 0)),
      ownRight,
    ),
    1,
  );
  widths = left.map((l, k) => l + right[k]);
  ({ zone, crossings } = crossingZones(pts, widths, cumulativeLengths(pts)));
  if (iter === 7) break;
  const offset = smooth(
    left.map((l, k) => (right[k] - l) / 2),
    1,
  );
  pts = resample(
    pts.map((p, k) => {
      const n = [-tan[k][1], tan[k][0]];
      const o = Math.max(-1.5, Math.min(1.5, offset[k] * 0.7));
      return [p[0] - n[0] * o, p[1] - n[1] * o];
    }),
    2,
  );
}
const finalTan = tangents(pts);

// ---------- timing: slower in tight curves, with a gentle start and finish ----------
const tan = tangents(pts);
const curvature = smooth(
  pts.map((_, k) => {
    if (k === 0 || k === pts.length - 1) return 0;
    const a = tan[k - 1];
    const b = tan[k + 1];
    return (
      Math.abs(
        Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]),
      ) / 4
    );
  }),
  6,
);
const lengths = cumulativeLengths(pts);
const cost = [0];
for (let k = 1; k < pts.length; k++)
  cost[k] = cost[k - 1] + dist(pts[k - 1], pts[k]) * (1 + 28 * curvature[k]);
const ease = (u) => 0.55 * u + (0.45 * (1 - Math.cos(Math.PI * u))) / 2;
const times = cost.map((c) => DURATION * ease(c / cost[cost.length - 1]));

// ---------- emit the mask ----------
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const f3 = (x) => x.toFixed(3);
const segmentStarts = [0];
for (let k = 1; k < pts.length; k++)
  if (lengths[k] - lengths[segmentStarts[segmentStarts.length - 1]] >= STEP)
    segmentStarts.push(k);
// The leftover at the end joins the last segment unless it is long enough to stand on its own.
const lastStart = segmentStarts[segmentStarts.length - 1];
if (lastStart !== pts.length - 1) {
  if (lengths[pts.length - 1] - lengths[lastStart] < STEP / 2)
    segmentStarts[segmentStarts.length - 1] = pts.length - 1;
  else segmentStarts.push(pts.length - 1);
}

// Each side of the band reaches a little past the glyph's edge so the anti-aliased edge pixels are fully shown.
// Where the arm that passes a crossing first has no edge of its own, the band stops exactly at the interpolated
// edge (anything more would show the other arm too early); the arm that passes second gets extra width there, so
// the rounded fillets in the corners are shown.
const foreignLeft = samplesToForeignEdge(ownLeft);
const foreignRight = samplesToForeignEdge(ownRight);
// How deep a sample sits inside a stretch where the arm passes a crossing second (in samples).
const filletDepth = (() => {
  const d = new Array(zone.length).fill(0);
  for (let k = 0, run = 0; k < zone.length; k++)
    d[k] = run = zone[k] === 2 ? run + 1 : 0;
  for (let k = zone.length - 1, run = 0; k >= 0; k--) {
    run = zone[k] === 2 ? run + 1 : 0;
    d[k] = Math.min(d[k], run);
  }
  return d;
})();
// Where the arm has no edge of its own (under the other arm, or past the glyph's ends) the band stops exactly at
// the interpolated edge. The margin fades out over a few samples before that, so the band's edge meets the
// interpolated edge without a step; the fillet margin likewise fades in and out.
const extent = (k, own, foreign) => {
  if (zone[k] === 2)
    return (
      MARGIN / 2 +
      (FILLET_MARGIN / 2 - MARGIN / 2) *
        Math.min(1, filletDepth[k] / MARGIN_FADE)
    );
  if (!own) return ZONE_MARGIN / 2;
  return (MARGIN / 2) * Math.min(1, foreign / MARGIN_FADE);
};
const edgePoint = (k, side) => {
  const n = [-finalTan[k][1], finalTan[k][0]];
  let d =
    (side < 0 ? left[k] : right[k]) +
    extent(
      k,
      side < 0 ? ownLeft[k] : ownRight[k],
      side < 0 ? foreignLeft[k] : foreignRight[k],
    );
  // The arm that passes a crossing second reaches right through the other arm, which is already shown, so the
  // fillets on the far side of it are shown as the pen passes rather than left for the safety net.
  const raw = side < 0 ? lastRaw[k].left.d : lastRaw[k].right.d;
  if (zone[k] === 2 && Number.isFinite(raw) && raw < 45)
    d = Math.max(d, raw + MARGIN / 2);
  d = Math.max(MIN_HALF_WIDTH, d);
  return [pts[k][0] + side * n[0] * d, pts[k][1] + side * n[1] * d];
};
const leftEdge = pts.map((_, k) => edgePoint(k, -1));
const rightEdge = pts.map((_, k) => edgePoint(k, 1));
const pointList = (list) =>
  list.map((p) => `${f1(p[0])},${f1(p[1])}`).join(" ");

// Every segment is the exact slice of the band between two cross-sections, so neighbouring segments share their
// edge points and the band's outline is continuous. A segment grows from its first cross-section to its full shape by
// animating its points, which keeps the leading edge a clean cut across the glyph.
const segments = [];
for (let s = 0; s < segmentStarts.length - 1; s++) {
  const a = segmentStarts[s];
  const b = segmentStarts[s + 1];
  // The shape runs one sample into the next segment: two shapes that merely touch leave a faint anti-aliased seam.
  const c = Math.min(b + 1, pts.length - 1);
  const count = c - a + 1;
  const full = [
    ...leftEdge.slice(a, c + 1),
    ...rightEdge.slice(a, c + 1).reverse(),
  ];
  const collapsed = [
    ...Array(count).fill(leftEdge[a]),
    ...Array(count).fill(rightEdge[a]),
  ];
  const begin = f3(times[a]);
  const dur = f3(Math.max(0.001, times[b] - times[a]));
  segments.push(
    `        <polygon points="${pointList(collapsed)}" opacity="0"><set attributeName="opacity" to="1" begin="${begin}s" fill="freeze" /><animate attributeName="points" to="${pointList(full)}" begin="${begin}s" dur="${dur}s" fill="freeze" /></polygon>`,
  );
}
const end = times[times.length - 1];

const mask = `
      <rect x="0" y="0" width="800" height="800" fill="black" />
      <!-- Each segment stays hidden until its turn, so no engine paints anything of it ahead of time. -->
      <g fill="white" stroke="none">
${segments.join("\n")}
      </g>
      <!-- Safety net: once the pen has finished, make sure every last edge pixel of the glyph is shown. -->
      <rect x="0" y="0" width="800" height="800" fill="white" opacity="0"><set attributeName="opacity" to="1" begin="${f3(end + 0.05)}s" fill="freeze" /></rect>
    `;
const comment = `
    <!-- Handwriting reveal: the filled glyph is shown through a mask that a pen stroke paints along the glyph's
         centreline. Generated by scripts/icon-animation.mjs: ${segments.length} short segments, each as wide as the
         glyph is thick there, starting one after another. Edit the script, not this markup. -->`;
const result = svg
  // The mask needs no blur: its bands always reach past the glyph's edges, so only the glyph's own anti-aliasing shows.
  .replace(/\s*<filter id="write-soft"[\s\S]*?<\/filter>/, "")
  .replace(/\s*<!-- Handwriting reveal:[\s\S]*?-->/, comment)
  .replace(/(<mask id="write-mask"[^>]*>)[\s\S]*?(<\/mask>)/, `$1${mask}$2`);

console.log(
  `stroke ${lengths[lengths.length - 1].toFixed(0)} units, ${segments.length} segments, ${end.toFixed(2)}s; thickness ${Math.min(...widths).toFixed(1)}–${Math.max(...widths).toFixed(1)}; crossings ${crossings.map((c) => `${c.at} (${c.angle}°)`).join(", ")}`,
);
if (dumpPath) {
  const rows = pts.map((p, k) =>
    [
      lengths[k],
      p[0],
      p[1],
      left[k],
      right[k],
      (ownLeft[k] ? 1 : 0) + (ownRight[k] ? 2 : 0),
      widths[k],
      zone[k],
      times[k],
      lastRaw[k].left.d,
      lastRaw[k].left.angle,
      lastRaw[k].right.d,
      lastRaw[k].right.angle,
    ]
      .map((v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : "inf"))
      .join("\t"),
  );
  writeFileSync(
    dumpPath,
    "length\tx\ty\tleft\tright\town(1=L,2=R,3=both)\twidth\tzone\ttime\trawL\tangleL\trawR\tangleR\n" +
      rows.join("\n") +
      "\n",
  );
}
if (!dryRun) {
  writeFileSync(SVG_PATH, result);
  console.log("wrote", SVG_PATH);
}
