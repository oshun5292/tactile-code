import { useEffect, useRef } from "react";
import { languageForFilename } from "./cm/languages";
import { CodeEditor } from "./cm/CodeEditor";
import { MarkdownEditor } from "./cm/MarkdownEditor";
import { baseName, isMarkdownFile, unopenableReason, type MdMode, type Session, type Tab } from "./editorLogic";

type Props = {
  session: Session;
  focusTick: number;
  onEdit: (relPath: string, next: string) => void;
  onSave: (relPath: string) => void;
  onMdMode: (relPath: string, mode: MdMode) => void;
  onReload: (relPath: string) => void;
};

const MODES: { id: MdMode; label: string }[] = [
  { id: "edit", label: "書く" },
  { id: "split", label: "半分" },
  { id: "preview", label: "読む" },
];

/** 本文。開いているタブはすべてマウントしたまま隠し、切り替えても元に戻す履歴(Ctrl+Z)とスクロールが残るようにする。 */
export function DocView({ session, focusTick, onEdit, onSave, onMdMode, onReload }: Props) {
  const active = session.tabs.find((t) => t.relPath === session.active) ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const activeStatus = active?.status;

  // タブを開いた・切り替えたとき、本文の編集欄へフォーカスを移す
  useEffect(() => {
    if (!active || active.status !== "ready") return;
    const id = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('.doc-panel:not([hidden]) .cm-content')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.active, focusTick, activeStatus]);

  if (!active) {
    return (
      <div className="doc">
        <div className="doc-empty">
          <p>左のファイルツリーから、開きたいファイルを選んでください。</p>
        </div>
      </div>
    );
  }

  const isMd = isMarkdownFile(active.relPath);
  const lang = languageForFilename(active.relPath).label;

  return (
    <div className="doc" ref={rootRef}>
      <div className="doc-bar">
        <span className="doc-path" title={active.relPath}>
          {active.relPath}
        </span>
        <span className="doc-lang">{lang}</span>
        {active.kind === "text" && isMd && (
          <div className="mode" role="group" aria-label="マークダウンの表示">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className="mode-btn"
                aria-pressed={active.mdMode === m.id}
                onClick={() => onMdMode(active.relPath, m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="doc-body">
        {session.tabs.map((t) => (
          <div key={t.relPath} className="doc-panel" role="tabpanel" aria-label={baseName(t.relPath)} hidden={t.relPath !== session.active}>
            <Panel tab={t} onEdit={onEdit} onSave={onSave} onReload={onReload} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ tab, onEdit, onSave, onReload }: { tab: Tab } & Pick<Props, "onEdit" | "onSave" | "onReload">) {
  if (tab.status === "loading") {
    return (
      <p className="doc-state" role="status">
        <span className="spinner" aria-hidden="true" />
        読み込んでいます…
      </p>
    );
  }
  if (tab.status === "error") {
    return (
      <div className="doc-unopenable" role="alert">
        <b>ファイルを読み込めませんでした</b>
        <p>{tab.error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => onReload(tab.relPath)}>
          もう一度読む
        </button>
      </div>
    );
  }
  if (tab.kind !== "text" || tab.draft === null) {
    return (
      <div className="doc-unopenable">
        <div className="doc-lock" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <b>このファイルは開けません</b>
        <p>{tab.kind ? unopenableReason({ kind: tab.kind, size: tab.size }) : ""}</p>
      </div>
    );
  }
  if (isMarkdownFile(tab.relPath)) {
    return (
      <MarkdownEditor value={tab.draft} onChange={(v) => onEdit(tab.relPath, v)} onSave={() => onSave(tab.relPath)} mode={tab.mdMode} />
    );
  }
  return (
    <CodeEditor
      value={tab.draft}
      filename={tab.relPath}
      onChange={(v) => onEdit(tab.relPath, v)}
      onSave={() => onSave(tab.relPath)}
      ariaLabel={`${baseName(tab.relPath)} の編集`}
    />
  );
}
