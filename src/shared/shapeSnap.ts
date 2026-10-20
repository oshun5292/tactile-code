// 手書きの「ほぼ閉じた丸」を、手書き風の楕円に整える純粋関数。画面(React)に依存しない。
// 座標はボード座標。しきい値の「px」は画面上の長さで、zoom をかけて比べる。

import { hashString, mulberry32, type Point } from "./handdrawn";

export type EllipseFit = {
  cx: number;
  cy: number;
  /** 長半径・短半径(a >= b) */
  a: number;
  b: number;
  /** 長軸の向き(ラジアン) */
  phi: number;
  /** 始点の媒介変数角(ここから描き始める) */
  t0: number;
  /** 描いた向き(+1 = 角度が増える向き / -1) */
  dir: 1 | -1;
  /** 楕円への当てはまり: 半径方向のずれ |r-1| の平均と最大(0 に近いほど良い) */
  meanDev: number;
  maxDev: number;
  /** 媒介変数角で回った総量(ラジアン、絶対値)。1周 = 2π */
  sweep: number;
};

export type DetectOptions = {
  /** 画面の倍率(ボード座標 → 画面px)。長さのしきい値を画面pxで判定するため */
  zoom?: number;
  minPoints?: number; // 既定 12
  minLengthPx?: number; // 既定 60
  maxGapRatio?: number; // 始点終点の距離 / 経路長。既定 0.25
  maxMeanDev?: number; // 既定 0.08
  maxMaxDev?: number; // 既定 0.3
  minAspect?: number; // b/a の下限。既定 0.25
};

const TAU = Math.PI * 2;

function pathLength(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** 経路を弧長で等間隔に取り直す(点の粗密に左右されないようにするため)。 */
export function resample(pts: Point[], n: number): Point[] {
  const total = pathLength(pts);
  if (pts.length < 2 || total === 0) return pts.slice();
  const out: Point[] = [pts[0]];
  const step = total / (n - 1);
  let acc = 0;
  let next = step;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > 0 && acc + seg >= next && out.length < n) {
      const k = (next - acc) / seg;
      out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]);
      next += step;
    }
    acc += seg;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

/** 点列に楕円を当てはめる(モーメント法 → 半径を平均で合わせ直す)。点が足りなければ null。 */
export function fitEllipse(points: Point[]): EllipseFit | null {
  if (points.length < 3) return null;
  const s = resample(points, 64);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of s) {
    cx += x;
    cy += y;
  }
  cx /= s.length;
  cy /= s.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of s) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  sxx /= s.length;
  syy /= s.length;
  sxy /= s.length;
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const mean = (sxx + syy) / 2;
  const diff = Math.hypot((sxx - syy) / 2, sxy);
  // 一様な楕円の分散は a²/2, b²/2
  let a = Math.sqrt(2 * (mean + diff));
  let b = Math.sqrt(2 * Math.max(mean - diff, 0));
  if (a < 1e-6 || b < 1e-6) return null;

  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const local = (p: Point): [number, number] => [(p[0] - cx) * c + (p[1] - cy) * sn, -(p[0] - cx) * sn + (p[1] - cy) * c];

  // 弧長の等間隔サンプリングは細長い楕円で偏るので、半径のずれ (r-1) の二乗和が最小になる
  // a, b を求め直す(ガウス・ニュートン法の数回)。
  const loc = s.map(local);
  for (let it = 0; it < 8; it++) {
    let jaa = 0;
    let jab = 0;
    let jbb = 0;
    let ga = 0;
    let gb = 0;
    for (const [u, v] of loc) {
      const r = Math.hypot(u / a, v / b);
      if (r < 1e-9) continue;
      const da = -(u * u) / (a * a * a * r);
      const db = -(v * v) / (b * b * b * r);
      const res = r - 1;
      jaa += da * da;
      jab += da * db;
      jbb += db * db;
      ga += da * res;
      gb += db * res;
    }
    const det = jaa * jbb - jab * jab;
    if (Math.abs(det) < 1e-18) break;
    a -= (jbb * ga - jab * gb) / det;
    b -= (jaa * gb - jab * ga) / det;
    if (a < 1e-6 || b < 1e-6) return null;
  }
  if (b > a) {
    // 軸の入れ替え: 長軸を a に保つ
    [a, b] = [b, a];
    return fitFinish(points, s, cx, cy, phi + Math.PI / 2, a, b);
  }
  return fitFinish(points, s, cx, cy, phi, a, b);
}

function fitFinish(points: Point[], s: Point[], cx: number, cy: number, phi: number, a: number, b: number): EllipseFit {
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const local = (p: Point): [number, number] => [(p[0] - cx) * c + (p[1] - cy) * sn, -(p[0] - cx) * sn + (p[1] - cy) * c];

  let dev = 0;
  let maxDev = 0;
  for (const p of s) {
    const [u, v] = local(p);
    const d = Math.abs(Math.hypot(u / a, v / b) - 1);
    dev += d;
    if (d > maxDev) maxDev = d;
  }

  // 媒介変数角での回転量と向き(元の点列で測る)
  let prev = 0;
  let sweepSum = 0;
  let t0 = 0;
  points.forEach((p, i) => {
    const [u, v] = local(p);
    const t = Math.atan2(v / b, u / a);
    if (i === 0) t0 = t;
    else {
      let d = t - prev;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      sweepSum += d;
    }
    prev = t;
  });

  return {
    cx,
    cy,
    a,
    b,
    phi,
    t0,
    dir: sweepSum >= 0 ? 1 : -1,
    meanDev: dev / s.length,
    maxDev,
    sweep: Math.abs(sweepSum),
  };
}

/** 「ほぼ閉じた丸」なら当てはめた楕円を返し、そうでなければ null。 */
export function detectClosedEllipse(points: Point[], opts: DetectOptions = {}): EllipseFit | null {
  const { zoom = 1, minPoints = 12, minLengthPx = 60, maxGapRatio = 0.25, maxMeanDev = 0.08, maxMaxDev = 0.3, minAspect = 0.25 } = opts;
  if (points.length < minPoints) return null;
  const len = pathLength(points);
  if (len * zoom < minLengthPx) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) > maxGapRatio * len) return null;
  const fit = fitEllipse(points);
  if (!fit) return null;
  if (fit.b / fit.a < minAspect) return null;
  if (fit.meanDev > maxMeanDev || fit.maxDev > maxMaxDev) return null;
  // 1周ぶん回っていること(U字・8の字・多重巻きを外す)
  if (fit.sweep < 1.8 * Math.PI || fit.sweep > 2.7 * Math.PI) return null;
  return fit;
}

export type SnapOptions = {
  /** 描く周回数。既定は 1.07〜1.10 を入力から決定的に選ぶ */
  turns?: number;
  /** 揺らぎの種。既定は入力点から決める(同じ入力なら同じ出力) */
  seed?: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 当てはめた楕円から、手書き風につながる閉曲線(少し重なる約1.07〜1.1周)の点列を作る。 */
export function snapToEllipse(points: Point[], fit: EllipseFit, opts: SnapOptions = {}): Point[] {
  const seed =
    opts.seed ??
    hashString(points.length + ":" + points.slice(0, 4).map((p) => p.join(",")).join(";") + ":" + (points[points.length - 1] ?? []).join(","));
  const rnd = mulberry32(seed);
  const turns = opts.turns ?? 1.07 + 0.03 * rnd();
  const { cx, cy, a, b, phi, t0, dir } = fit;
  // 周長(ラマヌジャンの近似)から点数を決める。60〜120点
  const h = ((a - b) / (a + b)) ** 2;
  const perim = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const n = Math.min(120, Math.max(60, Math.round((perim * turns) / 5)));

  // 揺らぎ: 周回に沿ってゆっくり変わる小さな半径のずれ(低周波の正弦波3つ)
  const amp = Math.min(0.012 * (a + b) * 0.5, 1.2);
  const waves = [0, 1, 2].map((i) => ({ f: 2 + i * 1.7 + rnd(), ph: rnd() * TAU, w: 1 / (i + 1) }));
  const wSum = waves.reduce((s, w) => s + w.w, 0);
  const drift = 0.025; // 終わりが少し外へずれて、始点とぴったり重ならない

  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const prog = i / n;
    const t = t0 + dir * turns * TAU * prog;
    const wob = waves.reduce((s, w) => s + w.w * Math.sin(w.f * TAU * prog * 0.5 + w.ph), 0) / wSum;
    const k = 1 + drift * prog + (amp * wob) / ((a + b) / 2);
    const u = a * k * Math.cos(t);
    const v = b * k * Math.sin(t);
    out.push([r1(cx + u * c - v * sn), r1(cy + u * sn + v * c)]);
  }
  return out;
}

/** 判定と整形をまとめたもの。丸でなければ入力をそのまま返す。 */
export function snapIfEllipse(points: Point[], opts: DetectOptions & SnapOptions = {}): { points: Point[]; snapped: boolean } {
  const fit = detectClosedEllipse(points, opts);
  if (!fit) return { points, snapped: false };
  return { points: snapToEllipse(points, fit, opts), snapped: true };
}
