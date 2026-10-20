import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../../api/types";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ProjectCard } from "../../shared/ui/ProjectCard";
import { Header } from "./Header";
import { useBoard } from "./store";
import "./board.css";

// ボードの左上の余白。契約書の position (px) は、この余白からの相対位置として扱う。
const ORIGIN = { x: 72, y: 150 };
const CARD_W = 420;
const CARD_H = 300; // 高さの目安(スクロール領域の見積もり用)

export function Board() {
  const { projects, status, error, notice, adding, load, addFromDialog, remove, setNote, setDescription, dismissNotice } =
    useBoard();
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // カードを絶対配置するので、スクロール領域の大きさは位置の最大値から見積もる
  const canvas = useMemo(() => {
    const w = Math.max(0, ...projects.map((p) => p.position.x)) + ORIGIN.x + CARD_W + 72;
    const h = Math.max(0, ...projects.map((p) => p.position.y)) + ORIGIN.y + CARD_H + 120;
    return { w, h };
  }, [projects]);

  return (
    <main className="board">
      <div className="canvas" style={{ minWidth: canvas.w, minHeight: canvas.h }}>
        <Header projects={projects} />

        {status === "loading" && (
          <p className="state" role="status">
            <span className="spinner" aria-hidden="true" />
            プロジェクトを読み込んでいます…
          </p>
        )}

        {status === "error" && (
          <div className="state state-error" role="alert">
            <p>
              <b>読み込めませんでした。</b>
              <br />
              {error}
            </p>
            <button type="button" className="btn" onClick={() => void load()}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === "ready" && projects.length === 0 && <EmptyState />}

        {status === "ready" &&
          projects.map((p) => (
            <div
              key={p.id}
              className="slot"
              style={{ left: ORIGIN.x + p.position.x, top: ORIGIN.y + p.position.y, width: CARD_W }}
            >
              <ProjectCard
                project={p}
                onNoteChange={(id, note) => void setNote(id, note)}
                onDescriptionChange={(id, d) => void setDescription(id, d)}
                onRemoveRequest={setRemoving}
              />
            </div>
          ))}
      </div>

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice} aria-label="メッセージを閉じる">
            ×
          </button>
        </div>
      )}

      <div className="tools">
        <button type="button" className="btn btn-primary" onClick={() => void addFromDialog()} disabled={adding}>
          <span aria-hidden="true">＋</span> {adding ? "追加しています…" : "プロジェクトを追加"}
        </button>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="このカードを記憶から外しますか?"
        confirmLabel="記憶から外す"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing.id);
          setRemoving(null);
        }}
      >
        <p>
          <b>{removing?.name}</b> をボードから外します。
        </p>
        <p className="confirm-safe">フォルダは消えません。あとで「プロジェクトを追加」からいつでも戻せます。</p>
      </ConfirmDialog>
    </main>
  );
}
