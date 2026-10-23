import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { languageColor } from "../../shared/languageColors";
import { baseName, iconForFile, isDirty, type ExternalMark, type Session } from "./editorLogic";

const EXTERNAL_LABEL: Record<ExternalMark, string> = {
  reloaded: "更新",
  changed: "外部で変更",
  deleted: "削除された",
};

type Props = {
  session: Session;
  onActivate: (relPath: string) => void;
  onClose: (relPath: string) => void;
};

/** タブ(36 の .ml-tab)。アクティブはプロジェクト色の上線、未保存は ●。多いときは横スクロール。 */
export function TabBar({ session, onActivate, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // アクティブなタブが見える位置までスクロールする
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [session.active, session.tabs.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = session.tabs.findIndex((t) => t.relPath === session.active);
    if (i === -1) return;
    const next = session.tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + session.tabs.length) % session.tabs.length];
    e.preventDefault();
    onActivate(next.relPath);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };

  return (
    <div className="tabs" ref={listRef} role="tablist" aria-label="開いているファイル" onKeyDown={onKeyDown}>
      {session.tabs.map((t) => {
        const active = t.relPath === session.active;
        const dirty = isDirty(t);
        const name = baseName(t.relPath);
        const icon = iconForFile(name);
        return (
          <div key={t.relPath} className="tab" data-active={active ? "" : undefined} data-dirty={dirty ? "" : undefined}>
            <button
              type="button"
              role="tab"
              className="tab-main"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${t.relPath}${dirty ? "(未保存)" : ""}${t.external ? `(${EXTERNAL_LABEL[t.external]})` : ""}`}
              onClick={() => onActivate(t.relPath)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.relPath);
                }
              }}
            >
              <span className="ico" style={{ "--c": languageColor(icon.language).d } as CSSProperties} aria-hidden="true">
                {icon.abbr}
              </span>
              <span className="tab-name">{name}</span>
              {t.external && (
                <span className="tab-ext" data-kind={t.external}>
                  {EXTERNAL_LABEL[t.external]}
                </span>
              )}
              {dirty && (
                <span className="tab-dirty" role="img" aria-label="未保存">
                  ●
                </span>
              )}
            </button>
            <button type="button" className="tab-close" onClick={() => onClose(t.relPath)} aria-label={`${name} を閉じる`} title="閉じる">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
