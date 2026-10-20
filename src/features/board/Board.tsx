import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type Viewport as FlowViewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "../../api/types";
import { languageColor } from "../../shared/languageColors";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PenLayer } from "../pen/PenLayer";
import { PenToolbar } from "../pen/PenToolbar";
import { usePen } from "../pen/penStore";
import { HandDrawnEdge, type HandDrawnFlowEdge } from "./HandDrawnEdge";
import { Header } from "./Header";
import { ProjectNode, type ProjectFlowNode } from "./ProjectNode";
import { useBoard } from "./store";
import "./board.css";

// ノード・エッジの種類は、再描画のたびに作り直さないよう外に置く
const nodeTypes: NodeTypes = { project: ProjectNode };
const edgeTypes: EdgeTypes = { handdrawn: HandDrawnEdge };

// 保存が無いときの表示位置。左上に余白を作る(段階1のボードの余白と同じ)
const INITIAL_VIEWPORT: FlowViewport = { x: 72, y: 150, zoom: 1 };
const VIEWPORT_SAVE_DELAY = 500; // 止まってからこの時間(ms)後に保存する

const ARIA_LABELS = {
  "controls.ariaLabel": "ズーム操作",
  "controls.zoomIn.ariaLabel": "拡大",
  "controls.zoomOut.ariaLabel": "縮小",
  "controls.fitView.ariaLabel": "すべてのカードが見えるように表示",
  "node.a11yDescription.default": "Enter でカードを選択、選択後に矢印キーで移動できます",
  "edge.a11yDescription.default": "Enter で線を選択。選択後に Delete キーで外せます",
};

export function Board() {
  const projects = useBoard((s) => s.projects);
  const storeEdges = useBoard((s) => s.edges);
  const strokes = useBoard((s) => s.strokes);
  const savedViewport = useBoard((s) => s.viewport);
  const status = useBoard((s) => s.status);
  const error = useBoard((s) => s.error);
  const notice = useBoard((s) => s.notice);
  const adding = useBoard((s) => s.adding);
  const { load, addFromDialog, remove, moveProject, connect, disconnect, addStroke, undoStroke, clearStrokes, saveViewport, dismissNotice } =
    useBoard.getState();
  const penOn = usePen((s) => s.on);

  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  const [clearing, setClearing] = useState(false);
  const onRemoveRequest = useCallback((p: ProjectSummary) => setRemoving(p), []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- ノード: store の projects をもとに作り、選択状態などは React Flow 側のものを引き継ぐ ---
  const [nodes, setNodes] = useState<ProjectFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) =>
      projects.map((p) => {
        const old = prev.find((n) => n.id === p.id);
        return {
          ...old,
          id: p.id,
          type: "project",
          // ドラッグ中は、保存済みの位置で上書きして飛ばないようにする
          position: old?.dragging ? old.position : p.position,
          data: { project: p, onRemoveRequest },
          deletable: false, // Delete キーで消えるのは「線」だけ
        } satisfies ProjectFlowNode;
      }),
    );
  }, [projects, onRemoveRequest]);
  const onNodesChange = useCallback((changes: NodeChange<ProjectFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  // --- エッジ: 色は「つなぎ元のカードのメイン言語色の濃いトーン」 ---
  const [edges, setEdges] = useState<HandDrawnFlowEdge[]>([]);
  useEffect(() => {
    setEdges((prev) =>
      storeEdges.map((e) => {
        const src = projects.find((p) => p.id === e.source);
        const d = languageColor(src?.mainLanguage).d;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "handdrawn",
          selected: prev.find((x) => x.id === e.id)?.selected,
          data: { color: `color-mix(in srgb, ${d} 72%, var(--ink))` },
        } satisfies HandDrawnFlowEdge;
      }),
    );
  }, [storeEdges, projects]);
  const onEdgesChange = useCallback((changes: EdgeChange<HandDrawnFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const onConnect = useCallback((c: Connection) => void connect(c.source, c.target), [connect]);
  const onEdgesDelete = useCallback((es: HandDrawnFlowEdge[]) => void disconnect(es.map((e) => e.id)), [disconnect]);
  const onNodeDragStop = useCallback(
    (_: unknown, _node: unknown, dragged: ProjectFlowNode[]) => {
      for (const n of dragged) void moveProject(n.id, Math.round(n.position.x), Math.round(n.position.y));
    },
    [moveProject],
  );

  // --- 表示位置の保存: 止まってから 500ms 後に1回だけ ---
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const onMoveEnd = useCallback(
    (_: unknown, vp: FlowViewport) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveViewport(vp), VIEWPORT_SAVE_DELAY);
    },
    [saveViewport],
  );

  const connectionLineStyle = useMemo(
    () => ({ stroke: "var(--ink2)", strokeWidth: 2, strokeLinecap: "round" as const, strokeDasharray: "1 6" }),
    [],
  );

  return (
    <main className="board" data-pen={penOn ? "on" : "off"}>
      {status === "ready" && (
        <ReactFlow<ProjectFlowNode, HandDrawnFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          defaultViewport={savedViewport ?? INITIAL_VIEWPORT}
          minZoom={0.2}
          maxZoom={2}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          connectionLineStyle={connectionLineStyle}
          deleteKeyCode={["Delete", "Backspace"]}
          selectNodesOnDrag={false}
          nodeDragThreshold={3}
          zoomOnDoubleClick={false}
          // ペンON中は、パン・ドラッグ・選択・つなぎをすべて止めて、ボード全面をペンに渡す
          panOnDrag={!penOn}
          nodesDraggable={!penOn}
          nodesConnectable={!penOn}
          elementsSelectable={!penOn}
          ariaLabelConfig={ARIA_LABELS}
        >
          <Background variant={BackgroundVariant.Dots} gap={32} size={1.4} color="rgba(52, 48, 43, 0.09)" />
          {projects.length > 0 && <Controls className="zoom-controls" orientation="horizontal" showInteractive={false} position="bottom-left" />}
          <PenLayer strokes={strokes} onCommit={(c, w, pts) => void addStroke(c, w, pts)} />
        </ReactFlow>
      )}

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

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice} aria-label="メッセージを閉じる">
            ×
          </button>
        </div>
      )}

      <div className="dock">
        <div className="tools">
          <button type="button" className="btn btn-primary" onClick={() => void addFromDialog()} disabled={adding}>
            <span aria-hidden="true">＋</span> {adding ? "追加しています…" : "プロジェクトを追加"}
          </button>
        </div>
        <PenToolbar
          canUndo={strokes.length > 0}
          canClear={strokes.length > 0}
          onUndo={() => void undoStroke()}
          onClearRequest={() => setClearing(true)}
        />
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
          <b>{removing?.name}</b> をボードから外します。つながっていた線も消えます(手書きは残ります)。
        </p>
        <p className="confirm-safe">フォルダは消えません。あとで「プロジェクトを追加」からいつでも戻せます。</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={clearing}
        title="手書きをすべて消しますか?"
        confirmLabel="すべて消す"
        onCancel={() => setClearing(false)}
        onConfirm={() => {
          void clearStrokes();
          setClearing(false);
        }}
      >
        <p>ボード上の手書きが全部消えます。カードと線はそのまま残ります。</p>
      </ConfirmDialog>
    </main>
  );
}
