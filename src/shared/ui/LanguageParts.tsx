import type { CSSProperties } from "react";
import type { LangShare } from "../../api/types";
import { formatLangShare } from "../format";
import { languageColor } from "../languageColors";

/** 色の点 + 言語名 + 「自動検知」(36 の .x-lang) */
export function LanguageLabel({ name }: { name: string | null }) {
  const color = languageColor(name);
  return (
    <div className="x-lang">
      <i className="dot" style={{ "--c": color.d } as CSSProperties} aria-hidden="true" />
      <b>{name ?? "言語なし"}</b>
      <span className="auto">自動検知</span>
    </div>
  );
}

/** 言語の内訳バー(36 の .x-bar)。色だけに頼らないよう、title と aria-label に内訳を入れる。 */
export function LanguageBar({ languages }: { languages: LangShare[] }) {
  if (languages.length === 0) {
    return <div className="x-bar x-bar-empty" role="img" aria-label="言語を検知できませんでした" />;
  }
  const summary = languages.map(formatLangShare).join("、");
  return (
    <div className="x-bar" role="img" aria-label={`言語の内訳: ${summary}`}>
      {languages.map((l) => (
        <i
          key={l.name}
          title={formatLangShare(l)}
          style={{ "--w": l.percent, "--c": languageColor(l.name).d } as CSSProperties}
        />
      ))}
    </div>
  );
}
