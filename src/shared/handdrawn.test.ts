import { describe, expect, it } from "vitest";
import { distPointSegment, distSegmentSegment, finishStroke, hashString, mulberry32, polylineHitBySegment, smoothPath, strokesHitBySegment, thinPoints, zoomViewportAt, type Point } from "./handdrawn";

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

describe("揺らぎの元になる乱数", () => {
  it("同じ seed は同じ数列、違う seed は違う", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });
  it("hashString は同じ文字列で同じ値", () => {
    expect(hashString("a-1")).toBe(hashString("a-1"));
    expect(hashString("a-1")).not.toBe(hashString("a-2"));
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

describe("消しゴムのヒット判定", () => {
  it("点と線分の距離(端・内側)", () => {
    expect(distPointSegment([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(distPointSegment([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(distPointSegment([1, 1], [2, 2], [2, 2])).toBeCloseTo(Math.SQRT2);
  });
  it("線分どうしの距離(交差は0、平行は間隔)", () => {
    expect(distSegmentSegment([0, 0], [10, 10], [0, 10], [10, 0])).toBe(0);
    expect(distSegmentSegment([0, 0], [10, 0], [0, 4], [10, 4])).toBe(4);
    expect(distSegmentSegment([0, 0], [1, 0], [5, 0], [9, 0])).toBe(4);
  });
  it("折れ線への命中: 近ければ当たる、遠ければ外れる", () => {
    const line: Point[] = [[0, 0], [100, 0]];
    expect(polylineHitBySegment(line, [50, 8], [50, 20], 9)).toBe(true);
    expect(polylineHitBySegment(line, [50, 8], [50, 20], 7)).toBe(false);
    expect(polylineHitBySegment(line, [50, -20], [50, 20], 1)).toBe(true); // 横切る
    expect(polylineHitBySegment(line, [200, 0], [220, 0], 5)).toBe(false);
    expect(polylineHitBySegment([[10, 10]], [12, 10], [20, 10], 3)).toBe(true); // 点だけの線
    expect(polylineHitBySegment([], [0, 0], [1, 1], 5)).toBe(false);
  });
  it("線幅の半分ぶん広く当たる", () => {
    const s = [
      { id: "a", width: 4, points: [[0, 0], [100, 0]] as Point[] },
      { id: "b", width: 4, points: [[0, 50], [100, 50]] as Point[] },
    ];
    expect(strokesHitBySegment(s, [50, 11], [60, 11], 9)).toEqual(["a"]); // 距離11 <= 9+2
    expect(strokesHitBySegment(s, [50, 12.5], [60, 12.5], 9)).toEqual([]);
    expect(strokesHitBySegment(s, [50, -10], [50, 60], 1)).toEqual(["a", "b"]);
  });
});
