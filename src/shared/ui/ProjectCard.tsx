import type { CSSProperties } from "react";
import type { ProjectSummary } from "../../api/types";
import { formatUpdated, shortenPath } from "../format";
import { languageColor } from "../languageColors";
import { EditableText } from "./EditableText";
import { GithubChip } from "./GithubChip";
import { LanguageBar, LanguageLabel } from "./LanguageParts";

type Props = {
  project: ProjectSummary;
  onNoteChange: (id: string, note: string) => void;
  onDescriptionChange: (id: string, description: string | null) => void;
  onRemoveRequest: (project: ProjectSummary) => void;
};

/** 1プロジェクトのカード(36 の .card)。メイン言語の色がアクセントになる。 */
export function ProjectCard({ project: p, onNoteChange, onDescriptionChange, onRemoveRequest }: Props) {
  const color = languageColor(p.mainLanguage);
  const updated = formatUpdated(p.lastUpdated);
  const branch = p.git?.branch;

  return (
    <article
      className="card"
      data-missing={p.exists ? undefined : ""}
      style={{ "--acc": color.bg, "--acc-d": color.d } as CSSProperties}
      aria-label={`プロジェクト ${p.name}`}
    >
      <button
        type="button"
        className="card-remove nodrag nopan"
        onClick={() => onRemoveRequest(p)}
        aria-label={`${p.name} を記憶から外す`}
        title="記憶から外す"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>

      <div className="hd">
        <LanguageLabel name={p.mainLanguage} />
        <LanguageBar languages={p.languages} />
      </div>

      <div className="tt">
        <h2>{p.name}</h2>
        <div className="x-path">
          <span title={p.path}>{shortenPath(p.displayPath)}</span>
          {branch ? <span className="br">{branch}</span> : null}
        </div>
      </div>

      {!p.exists && (
        <div className="missing" role="status">
          <b>フォルダが見つかりません。</b>
          移動または削除された可能性があります。右上の × で記憶から外せます(フォルダ自体は消えません)。
        </div>
      )}

      <div className="cols">
        <EditableText
          className="x-desc"
          label="説明"
          placeholder="説明を書く(クリックで編集)"
          value={p.description ?? ""}
          onSave={(next) => onDescriptionChange(p.id, next === "" ? null : next)}
        />
        <div className="x-note">
          <EditableText
            label="ひと言メモ"
            placeholder="ひと言メモを書く"
            maxLength={200}
            value={p.note}
            onSave={(next) => onNoteChange(p.id, next)}
          />
        </div>
      </div>

      <div className="x-foot">
        <span className="x-upd">
          更新 <b>{updated.date}</b>
          {updated.relative ? ` · ${updated.relative}` : ""}
        </span>
        <GithubChip git={p.git} />
      </div>
    </article>
  );
}
