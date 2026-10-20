// 手書き風の線を作る純粋関数。画面(React)に依存しないので、テストしやすい。
// 元は samples/assets/common.js の smooth / link を TypeScript で書き直したもの。

export type Point = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };
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

/** 文字列(エッジの id など)から seed を作る。 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type LineOptions = { seed: number; curve?: number; steps?: number; jitter?: number };

/**
 * 2点を、ゆるくふくらませた曲線でつなぎ、ごく小さな揺らぎを足した点列にする。
 * 両端は揺らさない(カードの縁にぴったり付けるため)。同じ入力なら同じ出力。
 */
export function handDrawnLine(p0: Point, p1: Point, { seed, curve = 0.1, steps = 14, jitter = 1.2 }: LineOptions): Point[] {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const bend = curve * len;
  const qx = (p0[0] + p1[0]) / 2 - (dy / len) * bend;
  const qy = (p0[1] + p1[1]) / 2 + (dx / len) * bend;
  const rnd = mulberry32(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const edge = i === 0 || i === steps;
    pts.push([
      u * u * p0[0] + 2 * u * t * qx + t * t * p1[0] + (edge ? 0 : (rnd() - 0.5) * jitter),
      u * u * p0[1] + 2 * u * t * qy + t * t * p1[1] + (edge ? 0 : (rnd() - 0.5) * jitter),
    ]);
  }
  return pts;
}

/** 矩形の中心から target 方向へ進んだとき、矩形の縁にぶつかる点。gap だけ外へ出す。 */
export function rectEdgePoint(r: Rect, target: Point, gap = 0): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = target[0] - cx;
  const dy = target[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const k = Math.min(Math.abs(r.w / 2 / (dx || 1e-9)), Math.abs(r.h / 2 / (dy || 1e-9)));
  const len = Math.hypot(dx, dy);
  return [cx + dx * k + (dx / len) * gap, cy + dy * k + (dy / len) * gap];
}

/** 2枚のカードの縁どうしを結ぶ端点(中心どうしを結ぶ線が縁と交わる点)。 */
export function connectEndpoints(a: Rect, b: Rect, gap = 0): [Point, Point] {
  const ca: Point = [a.x + a.w / 2, a.y + a.h / 2];
  const cb: Point = [b.x + b.w / 2, b.y + b.h / 2];
  return [rectEdgePoint(a, cb, gap), rectEdgePoint(b, ca, gap)];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 点 (cx, cy)(画面座標)を動かさずに、倍率だけ変えたビューポートを返す。ペンON中のホイール拡大縮小用。 */
export function zoomViewportAt(vp: ViewportT, factor: number, cx: number, cy: number, minZoom: number, maxZoom: number): ViewportT {
  const zoom = clamp(vp.zoom * factor, minZoom, maxZoom);
  const k = zoom / vp.zoom;
  return { zoom, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k };
}
