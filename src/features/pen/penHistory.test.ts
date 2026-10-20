import { describe, expect, it } from "vitest";
import type { Stroke } from "../../api/types";
import { popOp, pushOp, remapId, type HistoryOp } from "./penHistory";

const st = (id: string): Stroke => ({ id, color: "#000", width: 3, points: [[0, 0], [1, 1]] });

describe("penHistory", () => {
  it("新しい順に取り出せる", () => {
    let s: HistoryOp[] = [];
    s = pushOp(s, { kind: "draw", id: "a" });
    s = pushOp(s, { kind: "erase", strokes: [st("b"), st("c")] });
    s = pushOp(s, { kind: "clear", strokes: [st("d")] });
    const [o1, r1] = popOp(s);
    expect(o1?.kind).toBe("clear");
    const [o2, r2] = popOp(r1);
    expect(o2?.kind === "erase" && o2.strokes.map((x) => x.id)).toEqual(["b", "c"]);
    const [o3, r3] = popOp(r2);
    expect(o3).toEqual({ kind: "draw", id: "a" });
    expect(popOp(r3)).toEqual([null, []]);
  });
  it("元の配列を壊さない", () => {
    const s: HistoryOp[] = [{ kind: "draw", id: "a" }];
    pushOp(s, { kind: "draw", id: "b" });
    popOp(s);
    expect(s).toHaveLength(1);
  });
  it("空の消去は積まない", () => {
    expect(pushOp([], { kind: "erase", strokes: [] })).toEqual([]);
  });
  it("上限を超えたら古いものを捨てる", () => {
    let s: HistoryOp[] = [];
    for (let i = 0; i < 7; i++) s = pushOp(s, { kind: "draw", id: String(i) }, 5);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual({ kind: "draw", id: "2" });
  });
  it("id の付け替え(描いた だけが対象)", () => {
    const s: HistoryOp[] = [{ kind: "draw", id: "a" }, { kind: "draw", id: "b" }, { kind: "erase", strokes: [st("a")] }];
    const r = remapId(s, "a", "z");
    expect(r[0]).toEqual({ kind: "draw", id: "z" });
    expect(r[1]).toEqual({ kind: "draw", id: "b" });
    expect(r[2]).toEqual(s[2]);
  });
});
