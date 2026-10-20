// git 状態の表示用の純粋関数(N11)。ファイル単位の状態から、ツリーに出す印を作る。
import type { GitFileState, GitFileStatus } from "../../api/types";
import { ancestorsOf } from "./editorLogic";

/** 優先度(大きいほど目立たせる)。フォルダのドットは、配下で最も高い状態の色にする。 */
const PRIORITY: Record<GitFileState, number> = {
  conflicted: 6,
  deleted: 5,
  modified: 4,
  renamed: 3,
  added: 2,
  untracked: 1,
};

export function statePriority(state: GitFileState): number {
  return PRIORITY[state];
}

/** 2つの状態のうち、優先度が高いほう。 */
export function strongerState(a: GitFileState | undefined, b: GitFileState): GitFileState {
  return a && PRIORITY[a] >= PRIORITY[b] ? a : b;
}

const LETTERS: Record<GitFileState, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!" };
const LABELS: Record<GitFileState, string> = {
  modified: "変更あり",
  added: "追加",
  deleted: "削除",
  renamed: "名前変更",
  untracked: "未追跡(新規)",
  conflicted: "競合",
};

export function gitLetter(state: GitFileState): string {
  return LETTERS[state];
}

/** 画面読み上げ・ツールチップ用の日本語。 */
export function gitLabel(state: GitFileState): string {
  return LABELS[state];
}

export type GitView = {
  /** ツリーに存在するはずのファイルの状態(削除は含めない) */
  files: Map<string, GitFileState>;
  /** 配下に変更があるフォルダの状態(削除も含む)。ルート("")は含めない */
  dirs: Map<string, GitFileState>;
  truncated: boolean;
};

export const EMPTY_GIT_VIEW: GitView = { files: new Map(), dirs: new Map(), truncated: false };

/** フォルダ(祖先)ごとに、配下で最も優先度の高い状態を集計する。 */
export function aggregateToDirs(files: readonly GitFileStatus[]): Map<string, GitFileState> {
  const dirs = new Map<string, GitFileState>();
  for (const f of files) {
    for (const dir of ancestorsOf(f.relPath)) dirs.set(dir, strongerState(dirs.get(dir), f.state));
  }
  return dirs;
}

/** API の結果から、表示用の索引を作る。deleted はツリーに無いので、フォルダのドットにだけ反映する。 */
export function buildGitView(files: readonly GitFileStatus[], truncated: boolean): GitView {
  const map = new Map<string, GitFileState>();
  for (const f of files) {
    if (f.state !== "deleted") map.set(f.relPath, f.state);
  }
  return { files: map, dirs: aggregateToDirs(files), truncated };
}
