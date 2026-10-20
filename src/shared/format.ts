// 表示用の小さな純粋関数。画面の部品から切り離して、Vitest で確認できるようにしている。
import type { GitInfo, LangShare, ProjectSummary } from "../api/types";

/** 割合(0〜100)を "82%" の形にする。範囲外・小数は丸める。 */
export function formatPercent(n: number): string {
  const v = Math.min(100, Math.max(0, Math.round(n)));
  return `${v}%`;
}

/** 内訳バーのツールチップ用 "TypeScript 82%" */
export function formatLangShare(l: LangShare): string {
  return `${l.name} ${formatPercent(l.percent)}`;
}

/**
 * 長い表示用パスを中間省略する。例: "~/a/b/c/d/e" → "~/…/d/e"
 * 区切りは / に揃える(Windows の \ も受ける)。
 */
export function shortenPath(path: string, maxLen = 34): string {
  const p = path.replace(/\\/g, "/");
  if (p.length <= maxLen) return p;
  const parts = p.split("/").filter((s) => s !== "");
  if (parts.length <= 3) return p;
  const head = p.startsWith("/") ? "/" : `${parts[0]}/`;
  const tail = parts.slice(-2).join("/");
  return `${head}…/${tail}`;
}

/** ISO 8601 の週番号(1〜53)。月曜始まり、1/4 を含む週が第1週。 */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // 日曜=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // その週の木曜へ
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "今日" "昨日" "3日前" "2週間前" "5か月前" "2年前"。未来の日付は "今日" 扱い。 */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000));
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}

/** 最終更新の表示用。null や不正な日付は date:"不明"。 */
export function formatUpdated(
  iso: string | null,
  now: Date = new Date(),
): { date: string; relative: string | null } {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return { date: "不明", relative: null };
  const rel = relativeDays(iso, now);
  if (rel === "今日") return { date: "今日", relative: null };
  const d = new Date(iso);
  return { date: `${d.getMonth() + 1}/${d.getDate()}`, relative: rel };
}

export type SyncState = "ahead" | "behind" | "diverged" | "synced" | "no-upstream";

/** git の ahead/behind を、チップ用の状態と日本語ラベルにする。 */
export function syncInfo(git: Pick<GitInfo, "ahead" | "behind" | "hasUpstream">): {
  state: SyncState;
  label: string;
} {
  if (!git.hasUpstream) return { state: "no-upstream", label: "上流なし" };
  if (git.ahead > 0 && git.behind > 0)
    return { state: "diverged", label: `↑${git.ahead} 未push · ↓${git.behind} 未pull` };
  if (git.ahead > 0) return { state: "ahead", label: `↑${git.ahead} 未push` };
  if (git.behind > 0) return { state: "behind", label: `↓${git.behind} 未pull` };
  return { state: "synced", label: "同期済み" };
}

/** 全プロジェクトの言語を、使っているプロジェクト数の多い順(同数なら名前順)に並べる。「その他」は除く。 */
export function collectLanguages(projects: Pick<ProjectSummary, "languages">[]): string[] {
  const count = new Map<string, number>();
  for (const p of projects) {
    for (const l of p.languages) {
      if (l.name === "その他") continue;
      count.set(l.name, (count.get(l.name) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** invoke の失敗(文字列が基本)を、画面に出せる日本語の文字列にする。 */
export function toMessage(e: unknown): string {
  if (typeof e === "string" && e) return e;
  if (e instanceof Error && e.message) return e.message;
  return "うまくいきませんでした。もう一度お試しください。";
}
