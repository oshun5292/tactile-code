import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "../../api";
import { languageColor } from "../../shared/languageColors";
import { ChoiceDialog, type Choice } from "../../shared/ui/ChoiceDialog";
import { Toast } from "../../shared/ui/Toast";
import { useBoard } from "../board/store";
import { AiPanel } from "./AiPanel";
import { DocView } from "./DocView";
import { EditorHeader } from "./EditorHeader";
import { FileTree } from "./FileTree";
import { selectGitView, useGit } from "./gitStore";
import { GotoLine } from "./GotoLine";
import { useSettings } from "./settingsStore";
import { startAutoSave } from "./autoSave";
import { stepChord } from "./autoSaveLogic";
import { absolutePathOf, baseName, emptySession, isMarkdownFile, encodingLabel, isDirty, neighborTab, type Session } from "./editorLogic";
import { useEditor } from "./editorStore";
import { QuickOpen } from "./QuickOpen";
import { SearchPanel } from "./SearchPanel";
import { seedFromSelection } from "./searchLogic";
import { TabBar } from "./TabBar";
import "./editor.css";

const EMPTY_DIRS = {};
const EMPTY: Session = emptySession();
const POLL_MS = 5000;

/** エディタ画面の全体。ボードの上に全面で重ねて表示される(ボードはマウントしたまま)。 */
export function EditorScreen({ projectId }: { projectId: string }) {
  const project = useBoard((s) => s.projects.find((p) => p.id === projectId));
  const session = useEditor((s) => s.sessions[projectId]) ?? EMPTY;
  const dirs = useEditor((s) => s.dirs[projectId]) ?? EMPTY_DIRS;
  const git = useGit(selectGitView(projectId));
  const prompt = useEditor((s) => s.prompt);
  const conflict = useEditor((s) => s.conflict);
  const focusTick = useEditor((s) => s.focusTick);
  const quit = useEditor((s) => s.quit);
  const deleteRequest = useEditor((s) => s.deleteRequest);
  const notice = useEditor((s) => s.notice);
  const dirtyAll = useEditor((s) => s.sessions);
  const ed = useEditor.getState();
  const [quickOpen, setQuickOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const reveal = useEditor((s) => s.reveal);
  // サイドバーの「ファイル / 検索」。検索の入力内容は、切り替えても残す(パネルはマウントしたまま隠す)
  const [side, setSide] = useState<"files" | "search">("files");
  const [searchFocus, setSearchFocus] = useState<{ tick: number; seed: string | null }>({ tick: 0, seed: null });
  // 空の入力で先頭に出す「最近開いたファイル」。タブの並び順を使う(タブが変わらない限り同じ配列にする)
  const tabKey = session.tabs.map((t) => t.relPath).join("\n");
  const recent = useMemo(() => (tabKey ? tabKey.split("\n") : []), [tabKey]);

  const activeTab = session.tabs.find((t) => t.relPath === session.active) ?? null;

  // プロジェクトが記憶から外れていたら、ボードへ戻す
  const missing = !project;
  useEffect(() => {
    if (missing) useEditor.setState({ view: "board" });
  }, [missing]);

  // ウィンドウを閉じるとき、全プロジェクトの未保存を確認する(ボード表示中は未保存が無いので素通し)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void api.onCloseRequested(() => useEditor.getState().confirmQuit()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 外部変更の検知: ウィンドウにフォーカスが戻ったとき(ツリーも読み直す)と、表示中は一定間隔
  useEffect(() => {
    const check = () => void useEditor.getState().checkExternal(projectId);
    const onFocus = () => {
      check();
      void useEditor.getState().reloadTree(projectId);
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => {
      if (!document.hidden) check();
    }, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [projectId]);

  // Esc でボードへ。検索パネル・ダイアログ・入力欄・IME 変換中の Esc は、そちらを優先する。
  // Ctrl+S は、フォーカスがツリー等にあるときの保存(編集欄の中では CodeMirror が先に処理する)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented || e.isComposing) return;
        if (document.querySelector("dialog[open]") || document.querySelector(".cm-search") || document.querySelector(".quickopen") || document.querySelector(".settings-pop")) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        useEditor.getState().requestBack();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (e.isComposing || document.querySelector("dialog[open]")) return;
        // 編集欄で選択中の1行の文字があれば、検索語の初期値にする
        const sel = window.getSelection();
        const inEditor = !!sel?.anchorNode && !!sel.anchorNode.parentElement?.closest(".cm-content");
        const seed = inEditor && sel ? seedFromSelection(sel.toString()) : null;
        setSide("search");
        setSearchFocus((f) => ({ tick: f.tick + 1, seed }));
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault(); // ブラウザの印刷を出さない(ダイアログ中でも抑える)
        if (e.isComposing || document.querySelector("dialog[open]")) return;
        setQuickOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        if (e.defaultPrevented || document.querySelector("dialog[open]")) return; // 編集欄(CodeMirror)が処理済み / ダイアログ中
        e.preventDefault(); // ブラウザの「ページを保存」を出さない
        const st = useEditor.getState();
        const a = st.sessions[projectId]?.active;
        if (a) void st.save(projectId, a);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectId]);

  // Ctrl+Tab / Ctrl+PageDown で次のタブ、Shift 付き / Ctrl+PageUp で前のタブ。
  // WebView が Ctrl+Tab を奪う場合に備えて PageUp/Down も受ける。CodeMirror 等に先に食われないよう capture で受ける
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing || e.keyCode === 229) return;
      let delta: 1 | -1;
      if (e.key === "Tab") delta = e.shiftKey ? -1 : 1;
      else if (e.key === "PageDown" && !e.shiftKey) delta = 1;
      else if (e.key === "PageUp" && !e.shiftKey) delta = -1;
      else return;
      e.preventDefault();
      if (document.querySelector("dialog[open]") || document.querySelector(".quickopen")) return;
      const st = useEditor.getState();
      const next = neighborTab(st.sessions[projectId] ?? EMPTY, delta);
      if (next) st.activateTab(projectId, next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  // 設定を読む(エディタを開くとき)。読み込み済みなら何もしない
  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  // 自動保存(設定に従う)。エディタ画面が出ている間だけ動かす
  useEffect(() => startAutoSave(), []);

  // すべて保存: Ctrl+K のあと S(コード)。待ち時間内に S が来なければ、何も起きなかったことにする。
  // CodeMirror に先に食われないよう capture で受ける
  useEffect(() => {
    let pendingAt: number | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const HINT = "Ctrl+K: S ですべて保存";
    const clearHint = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      const st = useEditor.getState();
      if (st.notice?.text === HINT) st.dismissNotice();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (document.querySelector("dialog[open]") || document.querySelector(".quickopen")) {
        pendingAt = null;
        return;
      }
      const r = stepChord(pendingAt, Date.now(), { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey });
      const started = r.pendingAt !== null && r.pendingAt !== pendingAt;
      pendingAt = r.pendingAt;
      if (r.consume) {
        e.preventDefault(); // ブラウザの Ctrl+K(検索欄)や、S の文字入力を出さない
        e.stopPropagation();
      }
      if (started) {
        useEditor.getState().notify("info", HINT);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          pendingAt = null;
          clearHint();
        }, 1500);
      } else if (r.pendingAt === null && hideTimer) {
        clearHint();
      }
      if (r.fire) void useEditor.getState().saveAllOpen(projectId);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearHint();
    };
  }, [projectId]);

  // 文字サイズ(Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0)、折り返し(Alt+Z)、行へ移動(Ctrl+G)。
  // WebView のページ拡大や CodeMirror の「次を検索(Ctrl+G)」に先に食われないよう capture で受ける
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = useSettings.getState();
      if (mod && !e.altKey) {
        if (e.key === "=" || e.key === "+") s.zoom(1);
        else if (e.key === "-") s.zoom(-1);
        else if (e.key === "0") s.resetFont();
        else if (e.key.toLowerCase() === "g" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          if (document.querySelector("dialog[open]") || document.querySelector(".quickopen")) return;
          const st = useEditor.getState();
          const ses = st.sessions[projectId];
          const t = ses?.tabs.find((x) => x.relPath === ses.active);
          if (!t || t.kind !== "text" || t.draft === null) return;
          if (isMarkdownFile(t.relPath) && t.mdMode === "preview") {
            st.notify("info", "「読む」表示では行へ移動できません。「書く」か「半分」に切り替えてください");
            return;
          }
          setGotoOpen(true);
          return;
        } else return;
        e.preventDefault(); // WebView のページ拡大を出さない
      } else if (e.altKey && !mod && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        s.toggleWrap();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  if (!project) return null;

  const color = languageColor(project.mainLanguage);
  // メイン言語が無いときは水色(languageColor の「その他」は石色なので、ここで上書き)
  const proj = project.mainLanguage ? color : { bg: "var(--sky)", d: "var(--sky-d)" };
  const style = { "--proj": proj.bg, "--proj-d": proj.d, "--acc": proj.bg, "--acc-d": proj.d } as CSSProperties;

  // ツリーとタブのメニューで共通のパスコピー
  const copyPath = (relPath: string, absolute: boolean) => {
    const text = absolute ? absolutePathOf(project.path, relPath) : relPath;
    navigator.clipboard.writeText(text).then(
      () => ed.notify("info", `${absolute ? "絶対" : "相対"}パスをコピーしました`),
      () => ed.notify("error", "クリップボードにコピーできませんでした"),
    );
  };

  // --- 確認ダイアログの文面 ---
  const dirtyCount = session.tabs.filter((t) => isDirty(t)).length;
  const closingDirty =
    prompt?.kind === "closeTabs" ? session.tabs.filter((t) => prompt.relPaths.includes(t.relPath) && isDirty(t)).length : 0;
  const promptTitle =
    prompt?.kind === "reopen"
      ? `${baseName(prompt.relPath)} を ${encodingLabel(prompt.encoding)} で開き直しますか?`
      : prompt?.kind === "closeTab"
        ? `${baseName(prompt.relPath)} を保存しますか?`
        : "未保存の変更があります";
  // 開き直しは「保存して」の選択肢を持たない(保存は今の文字コードのまま、という意味になって紛らわしいため)
  const promptChoices: Choice[] =
    prompt?.kind === "reopen"
      ? [
          { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolvePrompt("cancel") },
          { label: "変更を捨てて開き直す", variant: "danger", onClick: () => void ed.resolvePrompt("discard") },
        ]
      : [
          { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolvePrompt("cancel") },
          { label: "保存せず閉じる", variant: "danger", onClick: () => void ed.resolvePrompt("discard") },
          { label: "保存して閉じる", variant: "primary", onClick: () => void ed.resolvePrompt("save") },
        ];
  const quitDirty = Object.values(dirtyAll).reduce((n, s) => n + s.tabs.filter((t) => isDirty(t)).length, 0);
  const quitChoices: Choice[] = [
    { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolveQuit("cancel") },
    { label: "保存せず閉じる", variant: "danger", onClick: () => void ed.resolveQuit("discard") },
    { label: "保存して閉じる", variant: "primary", onClick: () => void ed.resolveQuit("save") },
  ];
  const deleteChoices: Choice[] = [
    { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolveDelete(false) },
    { label: "ごみ箱へ移す", variant: "danger", onClick: () => void ed.resolveDelete(true) },
  ];
  const conflictChoices: Choice[] = [
    { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolveConflict("cancel") },
    { label: "読み込み直す", variant: "ghost", onClick: () => void ed.resolveConflict("reload") },
    { label: "上書きする", variant: "danger", onClick: () => void ed.resolveConflict("overwrite") },
  ];

  return (
    <div className="editor" style={style} data-project={project.id}>
      <EditorHeader
        project={project}
        activeTab={activeTab}
        onBack={() => ed.requestBack()}
        onSave={() => activeTab && void ed.save(projectId, activeTab.relPath)}
        dirtyCount={dirtyCount}
        onSaveAll={() => void ed.saveAllOpen(projectId)}
        onOpenInVscode={() => void ed.openInVscode(projectId, "")}
        onQuickOpen={() => setQuickOpen(true)}
        onNoteChange={(note) => void useBoard.getState().setNote(project.id, note)}
      />

      <aside className="side">
        <div className="side-tabs" role="tablist" aria-label="サイドバー">
          <button type="button" role="tab" className="side-tab" aria-selected={side === "files"} onClick={() => setSide("files")}>
            ファイル
          </button>
          <button
            type="button"
            role="tab"
            className="side-tab"
            aria-selected={side === "search"}
            onClick={() => {
              setSide("search");
              setSearchFocus((f) => ({ tick: f.tick + 1, seed: null }));
            }}
          >
            検索
          </button>
        </div>
        <div className="side-body" hidden={side !== "files"}>
          <FileTree
            dirs={dirs}
            gitFiles={git.files}
            gitDirs={git.dirs}
            expanded={session.expanded}
            activePath={session.active}
            onToggleDir={(p) => ed.toggleDir(projectId, p)}
            onOpenFile={(p) => void ed.openFile(projectId, p)}
            onReload={() => void ed.reloadTree(projectId)}
            onCreate={(kind, relPath) => ed.createEntry(projectId, kind, relPath)}
            onRename={(from, to) => ed.renameEntry(projectId, from, to)}
            onMove={(from, destDir) => ed.moveEntry(projectId, from, destDir)}
            onDuplicate={(entry) => ed.duplicateEntry(projectId, entry.relPath)}
            onDelete={(entry) => ed.requestDelete(projectId, entry.relPath, entry.kind)}
            onCopyPath={(entry, absolute) => copyPath(entry.relPath, absolute)}
            onOpenInVscode={(relPath) => void ed.openInVscode(projectId, relPath)}
          />
        </div>
        <div className="side-body" hidden={side !== "search"}>
          <SearchPanel
            key={projectId}
            projectId={projectId}
            focusTick={searchFocus.tick}
            seed={searchFocus.seed}
            onOpen={(p, line, col, len) => void ed.openAt(projectId, p, line, col, len)}
          />
        </div>
      </aside>

      <main className="pagemain">
        <TabBar
          session={session}
          gitFiles={git.files}
          onActivate={(p) => ed.activateTab(projectId, p)}
          onClose={(p) => ed.requestCloseTab(p)}
          onCloseMany={(ps) => ed.requestCloseTabs(ps)}
          onReorder={(p, at) => ed.reorderTab(projectId, p, at)}
          onCopyPath={(p, absolute) => copyPath(p, absolute)}
        />
        {activeTab?.external === "changed" && (
          <div className="ext-banner" role="status" data-kind="changed">
            このファイルは、ほかのアプリで変更されました。保存しようとすると確認が出ます(編集内容は残してあります)。
          </div>
        )}
        {activeTab?.external === "deleted" && (
          <div className="ext-banner" role="status" data-kind="deleted">
            このファイルは削除されました。内容はこのタブに残っています(保存すると、同じ場所に作り直されます)。
          </div>
        )}
        <DocView
          session={session}
          focusTick={focusTick}
          reveal={reveal && reveal.projectId === projectId ? reveal : null}
          onRevealed={(tick) => ed.clearReveal(tick)}
          onEdit={(p, v) => ed.edit(projectId, p, v)}
          onSave={(p) => void ed.save(projectId, p)}
          onMdMode={(p, m) => ed.setMdMode(projectId, p, m)}
          onReload={(p) => void ed.reloadTab(projectId, p)}
          onReopen={(p, enc) => ed.requestReopenWithEncoding(projectId, p, enc)}
          onSaveAs={(p, enc) => void ed.save(projectId, p, false, enc)}
          onSetEol={(p, eol) => ed.setEol(projectId, p, eol)}
          onSetIndent={(p, indent) => ed.setIndent(projectId, p, indent)}
        />
      </main>

      <AiPanel />

      {quickOpen && (
        <QuickOpen
          projectId={projectId}
          recent={recent}
          onClose={() => setQuickOpen(false)}
          onOpen={(p) => void ed.openFile(projectId, p)}
        />
      )}

      {gotoOpen && activeTab && (
        <GotoLine
          onClose={() => setGotoOpen(false)}
          // 桁は 0 始まりの文字数で渡す。範囲外は reveal 側(revealRange)が端に丸める
          onGo={(line, col) => void ed.openAt(projectId, activeTab.relPath, line, col - 1, 0)}
        />
      )}

      <ChoiceDialog
        open={prompt !== null}
        title={promptTitle}
        choices={promptChoices}
        onCancel={() => void ed.resolvePrompt("cancel")}
      >
        {prompt?.kind === "reopen" ? (
          <p>開き直すと、保存していない変更は失われます。</p>
        ) : prompt?.kind === "closeTab" ? (
          <p>このファイルには、保存していない変更があります。</p>
        ) : prompt?.kind === "closeTabs" ? (
          <p>閉じるタブのうち {closingDirty} 件に、保存していない変更があります。</p>
        ) : (
          <p>保存していない変更が {dirtyCount} 件のファイルにあります。</p>
        )}
      </ChoiceDialog>

      <ChoiceDialog open={quit !== null} title="未保存の変更があります" choices={quitChoices} onCancel={() => void ed.resolveQuit("cancel")}>
        <p>保存していない変更が {quitDirty} 件のファイルにあります。</p>
      </ChoiceDialog>

      <ChoiceDialog
        open={deleteRequest !== null}
        title={deleteRequest ? `「${baseName(deleteRequest.relPath)}」を削除しますか?` : ""}
        choices={deleteChoices}
        onCancel={() => void ed.resolveDelete(false)}
      >
        {/* 緑の囲み(confirm-safe)は使わず、普通の段落で伝える */}
        <p>ごみ箱へ移します。ごみ箱から元に戻せます。</p>
        {deleteRequest?.kind === "dir" && <p>フォルダの中身も、まとめてごみ箱へ移ります。</p>}
        {deleteRequest && deleteRequest.dirtyCount > 0 && (
          <p className="confirm-warn">保存していない変更が {deleteRequest.dirtyCount} 件のタブにあります。削除すると、この変更は失われます。</p>
        )}
      </ChoiceDialog>

      <Toast toast={notice} onClose={() => ed.dismissNotice()} />

      <ChoiceDialog
        open={conflict !== null}
        title="ほかのアプリで変更されています"
        choices={conflictChoices}
        onCancel={() => void ed.resolveConflict("cancel")}
      >
        <p>{conflict ? baseName(conflict.relPath) : ""} は、読み込んだあとに、ほかのアプリで書き換えられています。</p>
        <p>「上書きする」と、いまの編集内容でファイルを置き換えます。「読み込み直す」と、ファイルの内容を読み直し、編集内容は破棄されます。</p>
      </ChoiceDialog>
    </div>
  );
}
