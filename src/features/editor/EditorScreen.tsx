import { useEffect, type CSSProperties } from "react";
import { languageColor } from "../../shared/languageColors";
import { ChoiceDialog, type Choice } from "../../shared/ui/ChoiceDialog";
import { useBoard } from "../board/store";
import { AiPanel } from "./AiPanel";
import { DocView } from "./DocView";
import { EditorHeader } from "./EditorHeader";
import { FileTree } from "./FileTree";
import { baseName, emptySession, type Session } from "./editorLogic";
import { useEditor } from "./editorStore";
import { TabBar } from "./TabBar";
import "./editor.css";

const EMPTY_DIRS = {};
const EMPTY: Session = emptySession();

/** エディタ画面の全体。ボードの上に全面で重ねて表示される(ボードはマウントしたまま)。 */
export function EditorScreen({ projectId }: { projectId: string }) {
  const project = useBoard((s) => s.projects.find((p) => p.id === projectId));
  const session = useEditor((s) => s.sessions[projectId]) ?? EMPTY;
  const dirs = useEditor((s) => s.dirs[projectId]) ?? EMPTY_DIRS;
  const prompt = useEditor((s) => s.prompt);
  const conflict = useEditor((s) => s.conflict);
  const focusTick = useEditor((s) => s.focusTick);
  const ed = useEditor.getState();

  const activeTab = session.tabs.find((t) => t.relPath === session.active) ?? null;

  // プロジェクトが記憶から外れていたら、ボードへ戻す
  const missing = !project;
  useEffect(() => {
    if (missing) useEditor.setState({ view: "board" });
  }, [missing]);

  // Esc でボードへ。検索パネル・ダイアログ・入力欄・IME 変換中の Esc は、そちらを優先する。
  // Ctrl+S は、フォーカスがツリー等にあるときの保存(編集欄の中では CodeMirror が先に処理する)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented || e.isComposing) return;
        if (document.querySelector("dialog[open]") || document.querySelector(".cm-search")) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        useEditor.getState().requestBack();
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

  if (!project) return null;

  const color = languageColor(project.mainLanguage);
  // メイン言語が無いときは水色(languageColor の「その他」は石色なので、ここで上書き)
  const proj = project.mainLanguage ? color : { bg: "var(--sky)", d: "var(--sky-d)" };
  const style = { "--proj": proj.bg, "--proj-d": proj.d, "--acc": proj.bg, "--acc-d": proj.d } as CSSProperties;

  // --- 確認ダイアログの文面 ---
  const dirtyCount = session.tabs.filter((t) => t.draft !== null && t.draft !== t.baseline).length;
  const promptTitle = prompt?.kind === "closeTab" ? `${baseName(prompt.relPath)} を保存しますか?` : "未保存の変更があります";
  const promptChoices: Choice[] = [
    { label: "やめる", variant: "ghost", autoFocus: true, onClick: () => void ed.resolvePrompt("cancel") },
    { label: "保存せず閉じる", variant: "danger", onClick: () => void ed.resolvePrompt("discard") },
    { label: "保存して閉じる", variant: "primary", onClick: () => void ed.resolvePrompt("save") },
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
        onNoteChange={(note) => void useBoard.getState().setNote(project.id, note)}
      />

      <FileTree
        dirs={dirs}
        expanded={session.expanded}
        activePath={session.active}
        onToggleDir={(p) => ed.toggleDir(projectId, p)}
        onOpenFile={(p) => void ed.openFile(projectId, p)}
        onReload={() => void ed.reloadTree(projectId)}
      />

      <main className="pagemain">
        <TabBar session={session} onActivate={(p) => ed.activateTab(projectId, p)} onClose={(p) => ed.requestCloseTab(p)} />
        <DocView
          session={session}
          focusTick={focusTick}
          onEdit={(p, v) => ed.edit(projectId, p, v)}
          onSave={(p) => void ed.save(projectId, p)}
          onMdMode={(p, m) => ed.setMdMode(projectId, p, m)}
          onReload={(p) => void ed.reloadTab(projectId, p)}
        />
      </main>

      <AiPanel />

      <ChoiceDialog
        open={prompt !== null}
        title={promptTitle}
        choices={promptChoices}
        onCancel={() => void ed.resolvePrompt("cancel")}
      >
        {prompt?.kind === "closeTab" ? (
          <p>このファイルには、保存していない変更があります。</p>
        ) : (
          <p>保存していない変更が {dirtyCount} 件のファイルにあります。</p>
        )}
        <p className="confirm-safe">「保存せず閉じる」を選ぶと、保存していない変更は消えます。</p>
      </ChoiceDialog>

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
