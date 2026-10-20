import { describe, expect, it } from "vitest";
import {
  collectLanguages,
  formatPercent,
  formatUpdated,
  isoWeek,
  relativeDays,
  shortenPath,
  syncInfo,
  toMessage,
} from "./format";

describe("formatPercent", () => {
  it("丸めて % を付ける", () => {
    expect(formatPercent(82)).toBe("82%");
    expect(formatPercent(33.6)).toBe("34%");
  });
  it("範囲外は 0〜100 に収める", () => {
    expect(formatPercent(-5)).toBe("0%");
    expect(formatPercent(130)).toBe("100%");
  });
});

describe("shortenPath", () => {
  it("短ければそのまま", () => {
    expect(shortenPath("~/dev/todo-app")).toBe("~/dev/todo-app");
  });
  it("長ければ中間を省略する", () => {
    expect(shortenPath("~/Documents/00_active/memo_editor/src/features", 30)).toBe("~/…/src/features");
  });
  it("Windows の区切りも / にそろえる", () => {
    expect(shortenPath("C:\\a\\b")).toBe("C:/a/b");
  });
});

describe("isoWeek", () => {
  it("2026-10-20 は第43週", () => {
    expect(isoWeek(new Date(2026, 9, 20))).toBe(43);
  });
  it("年またぎ: 2021-01-01 は前年の第53週、2024-12-30 は第1週", () => {
    expect(isoWeek(new Date(2021, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1);
  });
});

describe("relativeDays / formatUpdated", () => {
  const now = new Date(2026, 9, 20, 15, 0, 0);
  it("日数を日本語にする", () => {
    expect(relativeDays(new Date(2026, 9, 20, 1).toISOString(), now)).toBe("今日");
    expect(relativeDays(new Date(2026, 9, 19, 23).toISOString(), now)).toBe("昨日");
    expect(relativeDays(new Date(2026, 9, 18).toISOString(), now)).toBe("2日前");
    expect(relativeDays(new Date(2026, 9, 6).toISOString(), now)).toBe("2週間前");
    expect(relativeDays(new Date(2026, 5, 1).toISOString(), now)).toBe("4か月前");
    expect(relativeDays(new Date(2024, 9, 1).toISOString(), now)).toBe("2年前");
  });
  it("表示用に 月/日 と相対表現を返す", () => {
    expect(formatUpdated(new Date(2026, 9, 18).toISOString(), now)).toEqual({ date: "10/18", relative: "2日前" });
    expect(formatUpdated(new Date(2026, 9, 20).toISOString(), now)).toEqual({ date: "今日", relative: null });
  });
  it("null や不正値は「不明」", () => {
    expect(formatUpdated(null, now).date).toBe("不明");
    expect(formatUpdated("xxx", now).date).toBe("不明");
  });
});

describe("syncInfo", () => {
  it("状態ごとのラベル", () => {
    expect(syncInfo({ ahead: 2, behind: 0, hasUpstream: true })).toEqual({ state: "ahead", label: "↑2 未push" });
    expect(syncInfo({ ahead: 0, behind: 1, hasUpstream: true })).toEqual({ state: "behind", label: "↓1 未pull" });
    expect(syncInfo({ ahead: 0, behind: 0, hasUpstream: true }).state).toBe("synced");
    expect(syncInfo({ ahead: 1, behind: 1, hasUpstream: true }).state).toBe("diverged");
    expect(syncInfo({ ahead: 0, behind: 0, hasUpstream: false }).state).toBe("no-upstream");
  });
});

describe("collectLanguages", () => {
  it("使っているプロジェクト数の多い順。「その他」は除く", () => {
    const l = (...names: string[]) => ({ languages: names.map((name) => ({ name, percent: 1 })) });
    expect(collectLanguages([l("Python", "SQL"), l("Python", "その他"), l("Rust")])).toEqual(["Python", "Rust", "SQL"]);
  });
});

describe("toMessage", () => {
  it("文字列・Error・その他を扱う", () => {
    expect(toMessage("すでに登録されています")).toBe("すでに登録されています");
    expect(toMessage(new Error("boom"))).toBe("boom");
    expect(toMessage(undefined)).toContain("もう一度");
  });
});
