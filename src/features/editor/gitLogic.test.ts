import { describe, expect, it } from "vitest";
import { aggregateToDirs, buildGitView, gitLabel, gitLetter, statePriority, strongerState } from "./gitLogic";

describe("strongerState / statePriority", () => {
  it("競合 > 削除 > 変更 > 名前変更 > 追加 > 未追跡", () => {
    const order = ["conflicted", "deleted", "modified", "renamed", "added", "untracked"] as const;
    for (let i = 0; i < order.length - 1; i++) {
      expect(statePriority(order[i])).toBeGreaterThan(statePriority(order[i + 1]));
      expect(strongerState(order[i + 1], order[i])).toBe(order[i]);
      expect(strongerState(order[i], order[i + 1])).toBe(order[i]);
    }
  });
  it("未定義なら新しいほう", () => {
    expect(strongerState(undefined, "added")).toBe("added");
  });
});

describe("gitLetter / gitLabel", () => {
  it("文字は M U A D R !", () => {
    expect(["modified", "untracked", "added", "deleted", "renamed", "conflicted"].map((s) => gitLetter(s as never)).join("")).toBe("MUADR!");
  });
  it("日本語の説明がある", () => {
    expect(gitLabel("conflicted")).toBe("競合");
  });
});

describe("aggregateToDirs", () => {
  it("祖先すべてに、最も優先度の高い状態を伝える", () => {
    const dirs = aggregateToDirs([
      { relPath: "src/a/x.ts", state: "untracked" },
      { relPath: "src/a/y.ts", state: "modified" },
      { relPath: "src/b.ts", state: "added" },
      { relPath: "README.md", state: "modified" },
    ]);
    expect(dirs.get("src/a")).toBe("modified");
    expect(dirs.get("src")).toBe("modified");
    expect(dirs.has("")).toBe(false);
    expect(dirs.size).toBe(2);
  });
  it("空なら空", () => {
    expect(aggregateToDirs([]).size).toBe(0);
  });
});

describe("buildGitView", () => {
  it("削除はファイルの索引に入れず、フォルダにだけ反映する", () => {
    const v = buildGitView(
      [
        { relPath: "docs/old.md", state: "deleted" },
        { relPath: "docs/new.md", state: "untracked" },
      ],
      true,
    );
    expect(v.files.has("docs/old.md")).toBe(false);
    expect(v.files.get("docs/new.md")).toBe("untracked");
    expect(v.dirs.get("docs")).toBe("deleted");
    expect(v.truncated).toBe(true);
  });
  it("日本語・空白のパスも扱える", () => {
    const v = buildGitView([{ relPath: "メモ 帳/日記 1.md", state: "added" }], false);
    expect(v.dirs.get("メモ 帳")).toBe("added");
  });
});
