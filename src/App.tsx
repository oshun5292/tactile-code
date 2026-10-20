import { lazy, Suspense } from "react";
import { Board } from "./features/board/Board";
import { useDevOpen } from "./features/editor/devOpen";
import { EditorScreen } from "./features/editor/EditorScreen";
import { useEditor } from "./features/editor/editorStore";

// 開発用デモ(?demo=cm)。本番ビルドでは import.meta.env.DEV が false で、読み込まれない
const CmDemo = import.meta.env.DEV ? lazy(() => import("./features/editor/cm/CmDemo")) : null;

function Main() {
  const view = useEditor((s) => s.view);
  const projectId = useEditor((s) => s.editorProjectId);
  const inEditor = view === "editor" && projectId !== null;
  useDevOpen();

  return (
    <>
      {/* エディタ表示中も、ボードはマウントしたまま隠す(ズーム・パン・手書きがそのまま残る) */}
      <div className="board-layer" data-hidden={inEditor ? "" : undefined} inert={inEditor}>
        <Board />
      </div>
      {inEditor && <EditorScreen key={projectId} projectId={projectId} />}
    </>
  );
}

export default function App() {
  if (CmDemo && new URLSearchParams(window.location.search).get("demo") === "cm") {
    return <Suspense fallback={null}><CmDemo /></Suspense>;
  }
  return <Main />;
}
