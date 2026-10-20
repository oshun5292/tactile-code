import { describe, expect, it } from "vitest";
import { mulberry32, type Point } from "./handdrawn";
import { detectClosedEllipse, fitEllipse, resample, snapIfEllipse, snapToEllipse } from "./shapeSnap";

/** 回転楕円を、turns 周ぶん描いた点列(startAngle から、n 点、ノイズ付き) */
function ellipse(opts: { cx?: number; cy?: number; a: number; b: number; rot?: number; turns?: number; n?: number; start?: number; noise?: number; dir?: 1 | -1; seed?: number }): Point[] {
  const { cx = 200, cy = 200, a, b, rot = 0, turns = 1, n = 60, start = 0, noise = 0, dir = 1, seed = 1 } = opts;
  const rnd = mulberry32(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + dir * turns * 2 * Math.PI * (i / n);
    const u = a * Math.cos(t) + (rnd() - 0.5) * 2 * noise;
    const v = b * Math.sin(t) + (rnd() - 0.5) * 2 * noise;
    pts.push([cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)]);
  }
  return pts;
}

const line = (n: number, f: (t: number) => Point): Point[] => Array.from({ length: n }, (_, i) => f(i / (n - 1)));

describe("detectClosedEllipse: 丸と判定する", () => {
  it("きれいな円", () => {
    const fit = detectClosedEllipse(ellipse({ a: 50, b: 50 }));
    expect(fit).not.toBeNull();
    expect(fit!.a).toBeCloseTo(50, 0);
    expect(fit!.meanDev).toBeLessThan(0.02);
  });
  it("横長の楕円と回転した楕円", () => {
    expect(detectClosedEllipse(ellipse({ a: 80, b: 40 }))).not.toBeNull();
    const fit = detectClosedEllipse(ellipse({ a: 80, b: 40, rot: Math.PI / 3 }));
    expect(fit).not.toBeNull();
    expect(fit!.b / fit!.a).toBeCloseTo(0.5, 1);
  });
  it("少し重なった丸(1.1周)", () => {
    expect(detectClosedEllipse(ellipse({ a: 50, b: 45, turns: 1.1 }))).not.toBeNull();
  });
  it("少し開いた丸(0.93周)", () => {
    expect(detectClosedEllipse(ellipse({ a: 50, b: 45, turns: 0.93 }))).not.toBeNull();
  });
  it("手ぶれ(ノイズ)入りの丸", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(detectClosedEllipse(ellipse({ a: 60, b: 50, noise: 2.5, turns: 1.05, seed, rot: 0.4 }))).not.toBeNull();
    }
  });
  it("逆回りでも判定できる", () => {
    const fit = detectClosedEllipse(ellipse({ a: 50, b: 50, dir: -1 }));
    expect(fit).not.toBeNull();
    expect(fit!.dir).toBe(-1);
  });
  it("拡大していて小さく見えるボード座標でも、画面で60px以上なら丸", () => {
    const small = ellipse({ a: 15, b: 15 }); // 周長 ~94
    expect(detectClosedEllipse(small, { zoom: 1 })).not.toBeNull();
    expect(detectClosedEllipse(small, { zoom: 0.5 })).toBeNull(); // 画面では 47px
  });
});

describe("detectClosedEllipse: 丸と判定しない", () => {
  it("閉じていないU字", () => {
    const u = line(40, (t) => [100 + 80 * Math.sin(t * Math.PI), 100 + 80 * (1 - Math.cos(t * Math.PI)) / 1] as Point);
    expect(detectClosedEllipse(u)).toBeNull();
  });
  it("半円・C字(0.7周)", () => {
    expect(detectClosedEllipse(ellipse({ a: 50, b: 50, turns: 0.7 }))).toBeNull();
  });
  it("直線と下線", () => {
    expect(detectClosedEllipse(line(30, (t) => [100 + 200 * t, 100]))).toBeNull();
    expect(detectClosedEllipse(line(30, (t) => [100 + 200 * t, 100 + 3 * Math.sin(t * 9)]))).toBeNull();
  });
  it("行って戻る線(始点終点は近いが細い)", () => {
    const go = line(20, (t) => [100 + 150 * t, 100 + 2 * Math.sin(t * 7)]);
    const back = line(20, (t) => [250 - 150 * t, 103 + 2 * Math.sin(t * 7)]);
    expect(detectClosedEllipse([...go, ...back])).toBeNull();
  });
  it("8の字", () => {
    const eight = line(80, (t) => [200 + 50 * Math.sin(t * 2 * Math.PI), 200 + 50 * Math.sin(t * 4 * Math.PI) * 0.8] as Point);
    expect(detectClosedEllipse(eight)).toBeNull();
  });
  it("ジグザグ・うねった線", () => {
    expect(detectClosedEllipse(line(60, (t) => [100 + 200 * t, 100 + 40 * Math.sin(t * 20)] as Point))).toBeNull();
  });
  it("四角(角が大きくずれる)は丸にしない", () => {
    const sq: Point[] = [];
    const corners: Point[] = [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]];
    for (let c = 0; c < 4; c++) for (let i = 0; i < 10; i++) sq.push([corners[c][0] + ((corners[c + 1][0] - corners[c][0]) * i) / 10, corners[c][1] + ((corners[c + 1][1] - corners[c][1]) * i) / 10]);
    sq.push([100, 100]);
    expect(detectClosedEllipse(sq)).toBeNull();
  });
  it("二重巻き(2周)", () => {
    expect(detectClosedEllipse(ellipse({ a: 50, b: 50, turns: 2, n: 100 }))).toBeNull();
  });
  it("点が少ない・短い・始点終点が遠い", () => {
    expect(detectClosedEllipse(ellipse({ a: 50, b: 50, n: 8 }))).toBeNull();
    expect(detectClosedEllipse(ellipse({ a: 5, b: 5, n: 30 }))).toBeNull();
    expect(detectClosedEllipse([])).toBeNull();
    expect(detectClosedEllipse([[1, 1]])).toBeNull();
  });
  it("始点と終点が近すぎる(ほぼ動いていない)点列でも壊れない", () => {
    const dot: Point[] = Array.from({ length: 20 }, (_, i) => [100 + (i % 2) * 0.1, 100]);
    expect(detectClosedEllipse(dot)).toBeNull();
  });
});

describe("snapToEllipse", () => {
  const input = ellipse({ a: 60, b: 40, rot: 0.5, start: 1.2, turns: 1.02, noise: 2 });
  const fit = detectClosedEllipse(input)!;

  it("同じ入力なら同じ出力(決定的)", () => {
    expect(snapToEllipse(input, fit)).toEqual(snapToEllipse(input, fit));
  });
  it("点数は60〜120", () => {
    for (const a of [20, 60, 200, 800]) {
      const f = detectClosedEllipse(ellipse({ a, b: a * 0.8 }), { zoom: 1 })!;
      const n = snapToEllipse(ellipse({ a, b: a * 0.8 }), f).length;
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(121);
    }
  });
  it("ユーザーの始点の近くから描き始める", () => {
    const out = snapToEllipse(input, fit);
    expect(Math.hypot(out[0][0] - input[0][0], out[0][1] - input[0][1])).toBeLessThan(8);
  });
  it("約1.07〜1.1周して少し重なる: 終点は始点の近くだが一致しない", () => {
    const out = snapToEllipse(input, fit);
    const d = Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(40);
    // 周回数を直接確認
    const f2 = fitEllipse(out)!;
    expect(f2.sweep / (2 * Math.PI)).toBeGreaterThan(1.05);
    expect(f2.sweep / (2 * Math.PI)).toBeLessThan(1.13);
  });
  it("全点が元の楕円の近く(揺らぎはごく小さい)", () => {
    const out = snapToEllipse(input, fit);
    // 当てはめた楕円からの半径方向のずれ(正規化)が3%以内
    const c = Math.cos(fit.phi);
    const sn = Math.sin(fit.phi);
    for (const [x, y] of out) {
      const u = (x - fit.cx) * c + (y - fit.cy) * sn;
      const v = -(x - fit.cx) * sn + (y - fit.cy) * c;
      expect(Math.abs(Math.hypot(u / fit.a, v / fit.b) - 1)).toBeLessThan(0.05);
    }
  });
  it("元の回る向きを保つ", () => {
    const rev = ellipse({ a: 50, b: 50, dir: -1 });
    const f = detectClosedEllipse(rev)!;
    expect(fitEllipse(snapToEllipse(rev, f))!.dir).toBe(-1);
  });
});

describe("snapIfEllipse / resample", () => {
  it("丸でなければそのまま返す", () => {
    const l = line(30, (t) => [100 + 200 * t, 100]);
    const r = snapIfEllipse(l);
    expect(r.snapped).toBe(false);
    expect(r.points).toBe(l);
  });
  it("丸なら置き換える", () => {
    const r = snapIfEllipse(ellipse({ a: 50, b: 50 }));
    expect(r.snapped).toBe(true);
    expect(r.points.length).toBeGreaterThanOrEqual(60);
  });
  it("resample は指定の点数で端を保つ", () => {
    const out = resample(line(5, (t) => [t * 100, 0]), 11);
    expect(out).toHaveLength(11);
    expect(out[0]).toEqual([0, 0]);
    expect(out[10][0]).toBeCloseTo(100);
  });
});
