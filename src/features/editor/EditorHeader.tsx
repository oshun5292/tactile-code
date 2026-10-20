import type { ProjectSummary } from "../../api/types";
import { shortenPath } from "../../shared/format";
import { EditableText } from "../../shared/ui/EditableText";
import { GithubChip } from "../../shared/ui/GithubChip";
import { LanguageBar, LanguageLabel } from "../../shared/ui/LanguageParts";
import { isDirty, type Tab } from "./editorLogic";

type Props = {
  project: ProjectSummary;
  activeTab: Tab | null;
  onBack: () => void;
  onSave: () => void;
  onOpenInVscode: () => void;
  onQuickOpen: () => void;
  onNoteChange: (note: string) => void;
};

/** 保存状態の文言と種類。未保存 / 保存中 / 保存済み / 失敗。 */
function saveStatus(tab: Tab | null): { kind: "none" | "dirty" | "saving" | "saved" | "failed"; text: string } {
  if (!tab || tab.kind !== "text") return { kind: "none", text: "" };
  if (tab.save === "saving") return { kind: "saving", text: "保存しています…" };
  if (tab.save === "failed") return { kind: "failed", text: `保存できませんでした: ${tab.saveError ?? "原因不明"}` };
  if (isDirty(tab)) return { kind: "dirty", text: "未保存の変更があります" };
  if (tab.save === "saved") return { kind: "saved", text: "保存しました" };
  return { kind: "none", text: "" };
}

/** エディタ上部(36 の .ehead)。ボードのカードと同じ部品(言語バー・GitHubチップ・メモ)を使う。 */
export function EditorHeader({ project: p, activeTab, onBack, onSave, onOpenInVscode, onQuickOpen, onNoteChange }: Props) {
  const status = saveStatus(activeTab);
  const canSave = !!activeTab && activeTab.kind === "text" && isDirty(activeTab) && activeTab.save !== "saving";
  const branch = p.git?.branch;

  return (
    <header className="ehead">
      <button type="button" className="back" onClick={onBack} aria-label="ボードへ戻る" title="ボードへ戻る(Esc)">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 3L5 9l6 6" />
        </svg>
      </button>

      <div className="ehead-title">
        <h1 title={p.name}>{p.name}</h1>
        <div className="x-path">
          <span title={p.path}>{shortenPath(p.displayPath)}</span>
          {branch ? <span className="br">{branch}</span> : null}
        </div>
      </div>

      <div className="ehead-lang">
        <LanguageLabel name={p.mainLanguage} />
        <LanguageBar languages={p.languages} />
      </div>

      <div className="ehead-gh">
        <GithubChip git={p.git} />
      </div>

      <div className="x-note ehead-note">
        <EditableText label="ひと言メモ" placeholder="ひと言メモを書く" maxLength={200} value={p.note} onSave={onNoteChange} />
      </div>

      <div className="ehead-save">
        <span className="save-status" data-kind={status.kind} role="status" aria-live="polite" title={status.text}>
          {status.kind !== "none" && <i className="save-dot" aria-hidden="true" />}
          <span>{status.text}</span>
        </span>
        <button type="button" className="btn btn-ghost find-btn" onClick={onQuickOpen} title="ファイルを探す(Ctrl+P)">
          ファイルを探す
          <kbd>Ctrl+P</kbd>
        </button>
        <button type="button" className="btn btn-ghost" onClick={onOpenInVscode} title="このプロジェクトのフォルダを VSCode で開く">
          VSCodeで開く
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave} title="保存(Ctrl+S)">
          保存
        </button>
      </div>
    </header>
  );
}
