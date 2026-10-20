import { describe, expect, it } from "vitest";
import type { FileContent } from "../../api/types";
import { CHORD_WINDOW_MS, editedSince, isAutoSaveBlockedByDialog, isAutoSaveTarget, isChordActive, stepChord, type ChordKey } from "./autoSaveLogic";
import { applyLoaded, newTab, type Tab } from "./editorLogic";

const loaded = (content = "a"): Tab =>
  applyLoaded(newTab("a.ts"), {
    relPath: "a.ts", kind: "text", content, size: 1, modified: "m", eol: "lf", hasBom: false, encoding: "utf-8",
  } as FileContent);
const dirty = (): Tab => ({ ...loaded(), draft: "b" });
const key = (k: string, o: Partial<ChordKey> = {}): ChordKey => ({ key: k, ctrl: false, meta: false, alt: false, shift: false, ...o });

describe("和音 Ctrl+K → S", () => {
  it("Ctrl+K で待ち状態になり、時間内の S で完成する", () => {
    const a = stepChord(null, 1000, key("k", { ctrl: true }));
    expect(a).toEqual({ pendingAt: 1000, fire: false, consume: true });
    const b = stepChord(a.pendingAt, 1000 + CHORD_WINDOW_MS, key("s"));
    expect(b).toEqual({ pendingAt: null, fire: true, consume: true });
  });
  it("Ctrl を押したままの S でも完成する", () => {
    expect(stepChord(1000, 1500, key("S", { ctrl: true })).fire).toBe(true);
  });
  it("待ち時間を過ぎた S は、ただの文字入力", () => {
    expect(stepChord(1000, 1000 + CHORD_WINDOW_MS + 1, key("s"))).toEqual({ pendingAt: null, fire: false, consume: false });
    expect(isChordActive(1000, 1000 + CHORD_WINDOW_MS + 1)).toBe(false);
  });
  it("Ctrl+K なしの S は何もしない", () => {
    expect(stepChord(null, 1000, key("s"))).toEqual({ pendingAt: null, fire: false, consume: false });
  });
  it("修飾キーだけでは待ちを解かず、他のキーでは解く", () => {
    expect(stepChord(1000, 1200, key("Control", { ctrl: true })).pendingAt).toBe(1000);
    expect(stepChord(1000, 1200, key("a"))).toEqual({ pendingAt: null, fire: false, consume: false });
  });
  it("Alt や Shift 付きの Ctrl+K / S は和音にしない", () => {
    expect(stepChord(null, 1, key("k", { ctrl: true, shift: true })).pendingAt).toBeNull();
    expect(stepChord(1000, 1100, key("s", { alt: true })).fire).toBe(false);
  });
});

describe("自動保存の対象", () => {
  it("未保存のテキストタブは対象、保存済みは対象外", () => {
    expect(isAutoSaveTarget(dirty())).toBe(true);
    expect(isAutoSaveTarget(loaded())).toBe(false);
  });
  it("改行コードだけの変更も対象(isDirty に従う)", () => {
    expect(isAutoSaveTarget({ ...loaded(), eol: "crlf" })).toBe(true);
  });
  it("保存中・失敗済み・外部変更ありは対象外", () => {
    expect(isAutoSaveTarget({ ...dirty(), save: "saving" })).toBe(false);
    expect(isAutoSaveTarget({ ...dirty(), save: "failed", saveError: "x" })).toBe(false);
    expect(isAutoSaveTarget({ ...dirty(), external: "changed" })).toBe(false);
    expect(isAutoSaveTarget({ ...dirty(), external: "deleted" })).toBe(false);
  });
  it("前回の自動保存失敗と同じ内容は再試行せず、編集されれば再び対象", () => {
    const t = dirty();
    expect(isAutoSaveTarget(t, { draft: "b", eol: "lf" })).toBe(false);
    expect(isAutoSaveTarget({ ...t, draft: "bc" }, { draft: "b", eol: "lf" })).toBe(true);
    expect(isAutoSaveTarget({ ...t, eol: "crlf" }, { draft: "b", eol: "lf" })).toBe(true);
  });
  it("読み込み中のタブは対象外", () => {
    expect(isAutoSaveTarget({ ...newTab("a.ts"), draft: "x", baseline: "y" })).toBe(false);
  });
});

describe("ダイアログ中・編集の検出", () => {
  const none = { prompt: null, conflict: null, quit: null, deleteRequest: null };
  it("どれかの確認が出ていれば止める", () => {
    expect(isAutoSaveBlockedByDialog(none)).toBe(false);
    expect(isAutoSaveBlockedByDialog({ ...none, prompt: { kind: "back" } })).toBe(true);
    expect(isAutoSaveBlockedByDialog({ ...none, conflict: {} })).toBe(true);
    expect(isAutoSaveBlockedByDialog({ ...none, quit: {} })).toBe(true);
    expect(isAutoSaveBlockedByDialog({ ...none, deleteRequest: {} })).toBe(true);
  });
  it("本文・改行コードの変化だけを編集とみなす", () => {
    const t = loaded();
    expect(editedSince(t, { ...t, save: "saved" })).toBe(false);
    expect(editedSince(t, { ...t, draft: "z" })).toBe(true);
    expect(editedSince(t, { ...t, eol: "crlf" })).toBe(true);
    expect(editedSince(undefined, t)).toBe(true);
  });
});
