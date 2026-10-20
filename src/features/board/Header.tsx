import { useMemo } from "react";
import type { ProjectSummary } from "../../api/types";
import { collectLanguages, isoWeek } from "../../shared/format";
import { languageColor } from "../../shared/languageColors";

/** 左上のタイトルと、右上の「自動検知した言語」凡例チップ(36 の .head / .chips)。 */
export function Header({ projects }: { projects: ProjectSummary[] }) {
  const languages = useMemo(() => collectLanguages(projects).slice(0, 8), [projects]);
  const week = useMemo(() => isoWeek(new Date()), []);

  return (
    <>
      <header className="head">
        <div className="hi">
          <i className="dot" aria-hidden="true" />
          workspace <span className="sep">/</span> {projects.length} projects <span className="sep">/</span> week {week}
        </div>
        <h1>
          Projects<span className="end">.</span>
        </h1>
      </header>

      {languages.length > 0 && (
        <ul className="chips" aria-label="自動検知した言語">
          <li className="lbl">自動検知した言語</li>
          {languages.map((name) => {
            const c = languageColor(name);
            return (
              <li key={name} className="chip" style={{ background: c.bg, "--d": c.d } as React.CSSProperties}>
                <i aria-hidden="true" />
                {name}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
