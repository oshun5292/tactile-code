import { describe, expect, it } from "vitest";
import {
  connectEndpoints,
  finishStroke,
  handDrawnLine,
  hashString,
  mulberry32,
  rectEdgePoint,
  smoothPath,
  thinPoints,
  zoomViewportAt,
  type Point,
} from "./handdrawn";

describe("smoothPath", () => {
  it("空なら空文字", () => expect(smoothPath([])).toBe(""));
  it("2点は直線", () => expect(smoothPath([[0, 0], [10, 5]])).toBe("M0 0 L10 5"));
  it("3点以上はベジェ(C)で、始点と終点を通る", () => {
    const d = smoothPath([[0, 0], [10, 10], [20, 0]]);
    expect(d.startsWith("M0 0 C")).toBe(true);
    expect(d.endsWith("20 0")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });
  it("1点でも描ける形になる", () => expect(smoothPath([[5, 5]])).toBe("M5 5 L5.1 5.1"));
});

describe("thinPoints", () => {
  it("近すぎる点を捨て、最初の点は残す", () => {
    const out = thinPoints([[0, 0], [1, 0], [2, 0], [3, 0], [10, 0]], 3);
    expect(out).toEqual([[0, 0], [3, 0], [10, 0]]);
  });
  it("空は空", () => expect(thinPoints([], 2)).toEqual([]));
});

describe("finishStroke", () => {
  it("間引きで落ちた最後の点を戻す", () => {
    const out = finishStroke([[0, 0], [1, 0], [2, 0]], 5);
    expect(out).toEqual([[0, 0], [2, 0]]);
  });
  it("1点だけなら2点にする(2点以上が契約)", () => {
    expect(finishStroke([[4, 4]], 2)).toHaveLength(2);
  });
  it("空は空", () => expect(finishStroke([], 2)).toEqual([]));
});

describe("揺らぎは決定的", () => {
  it("同じ seed は同じ数列、違う seed は違う", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });
  it("hashString は同じ文字列で同じ値", () => {
    expect(hashString("edge-1")).toBe(hashString("edge-1"));
    expect(hashString("edge-1")).not.toBe(hashString("edge-2"));
  });
  it("handDrawnLine: 同じ入力で同じ出力、両端は揺らさない", () => {
    const p0: Point = [0, 0];
    const p1: Point = [100, 40];
    const a = handDrawnLine(p0, p1, { seed: 3 });
    const b = handDrawnLine(p0, p1, { seed: 3 });
    expect(a).toEqual(b);
    expect(a[0]).toEqual(p0);
    expect(a[a.length - 1]).toEqual(p1);
    expect(a).toHaveLength(15);
    expect(handDrawnLine(p0, p1, { seed: 4 })).not.toEqual(a);
  });
  it("揺らぎの大きさは jitter 以内", () => {
    const flat = handDrawnLine([0, 0], [100, 0], { seed: 1, curve: 0, jitter: 0 });
    const wob = handDrawnLine([0, 0], [100, 0], { seed: 1, curve: 0, jitter: 1.2 });
    wob.forEach((p, i) => expect(Math.abs(p[1] - flat[i][1])).toBeLessThanOrEqual(0.6 + 1e-9));
  });
});

describe("端点の計算", () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  const b = { x: 300, y: 0, w: 100, h: 50 };
  it("右隣のカードなら、右辺と左辺の中央を結ぶ", () => {
    expect(connectEndpoints(a, b)).toEqual([[100, 25], [300, 25]]);
  });
  it("gap の分だけ外へ出る", () => {
    const [p0, p1] = connectEndpoints(a, b, 4);
    expect(p0[0]).toBeCloseTo(104);
    expect(p1[0]).toBeCloseTo(296);
  });
  it("真下方向は下辺に当たる", () => {
    const [x, y] = rectEdgePoint(a, [50, 500]);
    expect(x).toBeCloseTo(50);
    expect(y).toBeCloseTo(50);
  });
});

describe("zoomViewportAt", () => {
  it("カーソル位置の点は動かない", () => {
    const vp = { x: 72, y: 150, zoom: 1 };
    const next = zoomViewportAt(vp, 2, 400, 300, 0.2, 2);
    // フロー座標 (400-72, 300-150) が、拡大後も同じ画面位置に来る
    const before = [(400 - vp.x) / vp.zoom, (300 - vp.y) / vp.zoom];
    const after = [(400 - next.x) / next.zoom, (300 - next.y) / next.zoom];
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(next.zoom).toBe(2);
  });
  it("0.2〜2 に収める", () => {
    expect(zoomViewportAt({ x: 0, y: 0, zoom: 1.9 }, 3, 0, 0, 0.2, 2).zoom).toBe(2);
    expect(zoomViewportAt({ x: 0, y: 0, zoom: 0.3 }, 0.1, 0, 0, 0.2, 2).zoom).toBe(0.2);
  });
});
