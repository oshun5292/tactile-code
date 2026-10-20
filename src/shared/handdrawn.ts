// 手書き(ペン)の線を作る純粋関数。画面(React)に依存しないので、テストしやすい。

export type Point = [number, number];
export type ViewportT = { x: number; y: number; zoom: number };

const f = (n: number) => Math.round(n * 100) / 100;

/** 点列をなめらかな曲線の SVG パス(d 属性)にする。Catmull-Rom をベジェに直したもの。 */
export function smoothPath(pts: Point[]): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  let d = `M${f(first[0])} ${f(first[1])}`;
  if (pts.length === 1) return `${d} L${f(first[0] + 0.1)} ${f(first[1] + 0.1)}`; // 点だけでも丸が見える
  if (pts.length === 2) return `${d} L${f(pts[1][0])} ${f(pts[1][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** 前に残した点から minDist 未満の点を捨てる(最初の点は必ず残す)。 */
export function thinPoints(pts: Point[], minDist: number): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push(p);
  }
  return out;
}

/** 描き終わりの整え。間引きで落ちた最後の点を戻し、1点だけなら点として残せる2点にする。 */
export function finishStroke(raw: Point[], minDist: number): Point[] {
  if (raw.length === 0) return [];
  const thin = thinPoints(raw, minDist);
  const end = raw[raw.length - 1];
  const last = thin[thin.length - 1];
  if (last[0] !== end[0] || last[1] !== end[1]) thin.push(end);
  if (thin.length === 1) thin.push([thin[0][0] + 0.1, thin[0][1] + 0.1]);
  return thin;
}

/** 同じ seed なら同じ数列を返す乱数(mulberry32)。揺らぎを毎回同じにするため。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列(図形の id など)から seed を作る。 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 点 (cx, cy)(画面座標)を動かさずに、倍率だけ変えたビューポートを返す。ペンON中のホイール拡大縮小用。 */
export function zoomViewportAt(vp: ViewportT, factor: number, cx: number, cy: number, minZoom: number, maxZoom: number): ViewportT {
  const zoom = clamp(vp.zoom * factor, minZoom, maxZoom);
  const k = zoom / vp.zoom;
  return { zoom, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k };
}

// ===== 消しゴムのヒット判定 =====

/** 点 p から線分 ab までの最短距離。 */
export function distPointSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 線分 ab と線分 cd の最短距離(交差していれば 0)。 */
export function distSegmentSegment(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distPointSegment(a, c, d), distPointSegment(b, c, d), distPointSegment(c, a, b), distPointSegment(d, a, b));
}

/** 線分 ab(消しゴムの動き)が、折れ線 pts から radius 以内を通ったか。点1つだけの線も扱う。 */
export function polylineHitBySegment(pts: Point[], a: Point, b: Point, radius: number): boolean {
  if (pts.length === 0) return false;
  // 外接矩形での先回り判定(多くの線を毎回調べても軽くするため)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (Math.max(a[0], b[0]) < minX - radius || Math.min(a[0], b[0]) > maxX + radius) return false;
  if (Math.max(a[1], b[1]) < minY - radius || Math.min(a[1], b[1]) > maxY + radius) return false;
  if (pts.length === 1) return distPointSegment(pts[0], a, b) <= radius;
  for (let i = 1; i < pts.length; i++) {
    if (distSegmentSegment(a, b, pts[i - 1], pts[i]) <= radius) return true;
  }
  return false;
}

/**
 * 消しゴムの動き ab で触れた手書きの id を返す。
 * 半径 = 消しゴムの半径 + 線幅/2(線の縁に触れたら消える)。
 */
export function strokesHitBySegment(
  strokes: ReadonlyArray<{ id: string; width: number; points: Point[] }>,
  a: Point,
  b: Point,
  eraserRadius: number,
): string[] {
  return strokes.filter((s) => polylineHitBySegment(s.points, a, b, eraserRadius + s.width / 2)).map((s) => s.id);
}
