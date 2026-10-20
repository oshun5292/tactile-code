import { useEffect, useRef } from "react";
import { useBoard } from "../board/store";
import type { MdMode } from "./editorLogic";
import { useEditor } from "./editorStore";

const normalize = (s: string) => s.toLowerCase().replace(/[_-]/g, "");

/**
 * 開発用: URL に ?open=<プロジェクトのid か名前>&file=<相対パス>&mode=<edit|split|preview> があれば、
 * 起動直後にエディタを開く(画面の撮影・確認用)。本番ビルドでは何もしない。
 */
export function useDevOpen() {
  const status = useBoard((s) => s.status);
  const done = useRef(false);

  useEffect(() => {
    if (!import.meta.env.DEV || done.current || status !== "ready") return;
    const q = new URLSearchParams(window.location.search);
    const open = q.get("open");
    if (!open) return;
    done.current = true;
    const project = useBoard.getState().projects.find((p) => p.id === open || normalize(p.name) === normalize(open));
    if (!project) return;
    const m = q.get("mode");
    const mdMode: MdMode | undefined = m === "edit" || m === "split" || m === "preview" ? m : undefined;
    void useEditor.getState().openEditor(project.id, { file: q.get("file") ?? undefined, mdMode });
  }, [status]);
}
