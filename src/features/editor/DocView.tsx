import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { EncodingName, Eol } from "../../api/types";
import { ContextMenu, type MenuItem } from "../../shared/ui/ContextMenu";
import { languageForFilename } from "./cm/languages";
import { CodeEditor, type RevealTarget } from "./cm/CodeEditor";
import { MarkdownEditor } from "./cm/MarkdownEditor";
import { useSettings } from "./settingsStore";
import {
  baseName,
  canReopenWithEncoding,
  canSaveWithEncoding,
  encodingChoices,
  encodingLabel,
  isMarkdownFile,
  unopenableReason,
  type MdMode,
  type Session,
  type Tab,
} from "./editorLogic";
import {
  EOL_CHOICES,
  INDENT_CHOICES,
  detectIndent,
  eolLabel,
  formatPosition,
  indentLabel,
  resolveIndent,
  sameCursor,
  sameIndent,
  type CursorInfo,
  type IndentSetting,
} from "./statusBarLogic";

type Props = {
  session: Session;
  focusTick: number;
  /** 検索結果から開いた位置(対象のファイルのパネルにだけ渡す) */
  reveal: (RevealTarget & { relPath: string }) | null;
  onRevealed: (tick: number) => void;
  onEdit: (relPath: string, next: string) => void;
  onSave: (relPath: string) => void;
  onMdMode: (relPath: string, mode: MdMode) => void;
  onReload: (relPath: string) => void;
  /** 指定の文字コードで読み直す(未保存の確認はストア側) */
  onReopen: (relPath: string, encoding: EncodingName) => void;
  /** 指定の文字コードで保存する */
  onSaveAs: (relPath: string, encoding: EncodingName) => void;
  /** 改行コードの切り替え(本文は変えず、未保存扱いにする) */
  onSetEol: (relPath: string, eol: Eol) => void;
  /** インデントの一時設定(null=自動判定) */
  onSetIndent: (relPath: string, indent: IndentSetting | null) => void;
};

/** 状態バーのメニュー。文字コード(root=「再度開く/保存」の選択、reopen・save=文字コード一覧)・インデント・改行コード。 */
type EncMenu = { x: number; y: number; step: "root" | "reopen" | "save" | "indent" | "eol"; relPath: string };

const MENU_LABEL: Record<EncMenu["step"], string> = {
  root: "文字コード",
  reopen: "エンコード付きで再度開く",
  save: "エンコード付きで保存",
  indent: "インデント",
  eol: "改行コード",
};

const MODES: { id: MdMode; label: string }[] = [
  { id: "edit", label: "書く" },
  { id: "split", label: "半分" },
  { id: "preview", label: "読む" },
];

/** 本文。開いているタブはすべてマウントしたまま隠し、切り替えても元に戻す履歴(Ctrl+Z)とスクロールが残るようにする。 */
export function DocView({ session, focusTick, reveal, onRevealed, onEdit, onSave, onMdMode, onReload, onReopen, onSaveAs, onSetEol, onSetIndent }: Props) {
  const [menu, setMenu] = useState<EncMenu | null>(null);
  // タブごとのカーソル位置(隠れているタブは動かないので、表示中のぶんだけ見ればよい)
  const [cursors, setCursors] = useState<Record<string, CursorInfo>>({});
  const active = session.tabs.find((t) => t.relPath === session.active) ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const activeStatus = active?.status;
  // インデントの自動判定は、読み込んだ内容(baseline)から。打鍵のたびに判定し直さない
  const activeBaseline = active?.baseline ?? null;
  const detectedIndent = useMemo(() => detectIndent(activeBaseline), [activeBaseline]);

  // タブを開いた・切り替えたとき、本文の編集欄へフォーカスを移す
  useEffect(() => {
    if (!active || active.status !== "ready") return;
    const id = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('.doc-panel:not([hidden]) .cm-content')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.active, focusTick, activeStatus]);

  // 別のタブへ移ったらメニューは閉じる(違うファイルへ作用しないように)
  useEffect(() => setMenu(null), [session.active]);

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
  const langInfo = languageForFilename(active.relPath);
  const lang = langInfo.label;
  const isText = active.kind === "text" && active.status === "ready" && active.draft !== null;
  const indent = resolveIndent(active.indent, detectedIndent, langInfo.tabSize);
  const cursor = cursors[active.relPath];
  // 「読む」モードのマークダウンには編集欄が無く、カーソルも無い
  const showCursor = isText && !(isMd && active.mdMode === "preview") && !!cursor;

  const openMenu = (e: MouseEvent<HTMLElement>, step: EncMenu["step"]) => {
    const r = e.currentTarget.getBoundingClientRect();
    // 状態バーは画面の下端なので、メニューは上に開く(高さは項目数からの概算。はみ出しは ContextMenu が直す)
    const rows = step === "indent" ? INDENT_CHOICES.length + 2 : step === "eol" ? EOL_CHOICES.length : step === "root" ? 2 : 9;
    setMenu({ x: r.left, y: r.top - 4 - (rows * 32 + 12), step, relPath: active.relPath });
  };
  const menuTab = menu ? session.tabs.find((t) => t.relPath === menu.relPath) : undefined;
  const menuItems = (m: EncMenu, t: Tab): MenuItem[] => {
    if (m.step === "indent") {
      const cur = resolveIndent(t.indent, detectIndent(t.baseline), languageForFilename(t.relPath).tabSize);
      return [
        ...INDENT_CHOICES.map((c) => ({
          label: indentLabel(c),
          hint: sameIndent(c, cur) ? "現在" : undefined,
          onClick: () => onSetIndent(m.relPath, c),
        })),
        { type: "separator" as const },
        { label: "自動判定に戻す", disabled: t.indent === null, onClick: () => onSetIndent(m.relPath, null) },
      ];
    }
    if (m.step === "eol") {
      return EOL_CHOICES.map((c) => ({
        label: c.label,
        hint: c.eol === t.eol ? "現在" : undefined,
        onClick: () => onSetEol(m.relPath, c.eol),
      }));
    }
    if (m.step === "root") {
      return [
        { label: "エンコード付きで再度開く", disabled: !canReopenWithEncoding(t), onClick: () => setMenu({ ...m, step: "reopen" }) },
        { label: "エンコード付きで保存", disabled: !canSaveWithEncoding(t), onClick: () => setMenu({ ...m, step: "save" }) },
      ];
    }
    // 現在の文字コードに印を付ける(文字コード不明のタブは印なし)
    return encodingChoices(t.kind === "text" ? t.encoding : null).map((c) => ({
      label: c.label,
      hint: c.current ? "現在" : undefined,
      onClick: () => (m.step === "reopen" ? onReopen(m.relPath, c.encoding) : onSaveAs(m.relPath, c.encoding)),
    }));
  };

  return (
    <div className="doc" ref={rootRef}>
      <div className="doc-bar">
        <span className="doc-path" title={active.relPath}>
          {active.relPath}
        </span>
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
            <Panel tab={t} reveal={reveal?.relPath === t.relPath ? reveal : null} onRevealed={onRevealed} onEdit={onEdit} onSave={onSave} onReload={onReload} onOpenEncodingMenu={(e) => openMenu(e, "reopen")} onCursorChange={(c) => setCursors((cs) => (sameCursor(cs[t.relPath], c) ? cs : { ...cs, [t.relPath]: c }))} />
          </div>
        ))}
      </div>

      <div className="statusbar" role="status" aria-label="状態バー">
        {showCursor && <span className="sb-item sb-pos">{formatPosition(cursor)}</span>}
        <span className="sb-right">
          {isText && (
            <button type="button" className="sb-btn" aria-haspopup="menu" title="インデント(クリックで変更。このタブだけの一時設定)" onClick={(e) => openMenu(e, "indent")}>
              {indentLabel(indent)}
            </button>
          )}
          {isText && (
            <button type="button" className="sb-btn" aria-haspopup="menu" title="改行コード(クリックで変更。保存すると反映)" onClick={(e) => openMenu(e, "eol")}>
              {eolLabel(active.eol)}
            </button>
          )}
          {(active.kind === "text" || active.kind === "unsupportedEncoding") && active.status === "ready" && (
            <button type="button" className="sb-btn" aria-haspopup="menu" title="文字コード(クリックで、再度開く・保存の選択)" onClick={(e) => openMenu(e, "root")}>
              {active.kind === "text" ? encodingLabel(active.encoding) : "文字コード不明"}
            </button>
          )}
          <span className="sb-item sb-lang">{lang}</span>
        </span>
      </div>

      {menu && menuTab && (
        <ContextMenu
          key={menu.step}
          x={menu.x}
          y={menu.y}
          label={MENU_LABEL[menu.step]}
          items={menuItems(menu, menuTab)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Panel({
  tab,
  reveal,
  onRevealed,
  onEdit,
  onSave,
  onReload,
  onOpenEncodingMenu,
  onCursorChange,
}: { tab: Tab; onCursorChange: (c: CursorInfo) => void; reveal: RevealTarget | null; onRevealed: (tick: number) => void; onOpenEncodingMenu: (e: MouseEvent<HTMLElement>) => void } & Pick<Props, "onEdit" | "onSave" | "onReload">) {
  // 隠れているタブも、自分のインデント設定を持つ(切り替え時に直さなくて済む)
  const detected = useMemo(() => detectIndent(tab.baseline), [tab.baseline]);
  const indent = resolveIndent(tab.indent, detected, languageForFilename(tab.relPath).tabSize);
  const fontSize = useSettings((s) => s.settings.fontSize);
  const wordWrap = useSettings((s) => s.settings.wordWrap);
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
        <b>{tab.kind === "unsupportedEncoding" ? "文字コードを判別できません" : "このファイルは開けません"}</b>
        <p>{tab.kind ? unopenableReason({ kind: tab.kind, size: tab.size }) : ""}</p>
        {tab.kind === "unsupportedEncoding" && (
          <button type="button" className="btn btn-primary" aria-haspopup="menu" onClick={onOpenEncodingMenu}>
            エンコード付きで再度開く
          </button>
        )}
      </div>
    );
  }
  if (isMarkdownFile(tab.relPath)) {
    return (
      <MarkdownEditor value={tab.draft} onChange={(v) => onEdit(tab.relPath, v)} onSave={() => onSave(tab.relPath)} mode={tab.mdMode} reveal={reveal} onRevealed={onRevealed} onCursorChange={onCursorChange} indent={indent} fontSize={fontSize} />
    );
  }
  return (
    <CodeEditor
      value={tab.draft}
      filename={tab.relPath}
      onChange={(v) => onEdit(tab.relPath, v)}
      onSave={() => onSave(tab.relPath)}
      ariaLabel={`${baseName(tab.relPath)} の編集`}
      reveal={reveal}
      onRevealed={onRevealed}
      onCursorChange={onCursorChange}
      indent={indent}
      fontSize={fontSize}
      wrap={wordWrap}
    />
  );
}
