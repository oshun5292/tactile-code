import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Stroke } from "../../api/types";
import { finishStroke, smoothPath, strokesHitBySegment, zoomViewportAt, type Point } from "../../shared/handdrawn";
import { snapIfEllipse } from "../../shared/shapeSnap";
import { useBoard } from "../board/store";
import { commitErase, commitStroke, hideStrokes } from "./penActions";
import { ERASER_RADIUS_PX, PEN_WIDTH, usePen } from "./penStore";

const MIN_SCREEN_DIST = 1.5; // 画面上でこれより近い点は捨てる(px)
const MAX_POINTS = 5000; // 契約の上限

type Props = {
  strokes: Stroke[];
};

/** 保存済みの手書き。strokes が変わらない限り再描画しない(描画中の更新を軽くするため)。 */
const SavedStrokes = memo(function SavedStrokes({ strokes }: { strokes: Stroke[] }) {
  const paths = useMemo(() => strokes.map((s) => ({ id: s.id, color: s.color, width: s.width, d: smoothPath(s.points) })), [strokes]);
  return (
    <>
      {paths.map((p) => (
        <path key={p.id} d={p.d} stroke={p.color} strokeWidth={p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
});

/**
 * 手書きの表示(常時)と、描く操作(ペンON中だけ)。
 * 線はフロー座標で ViewportPortal に描くので、ズーム・パンに追従し、カードより前面に出る。
 * ペンOFFのとき、手書きはクリックを邪魔しない(pointer-events: none)。
 */
export function PenLayer({ strokes }: Props) {
  const { on, tool, color, setOn } = usePen();
  const rf = useReactFlow();
  const overlay = useRef<HTMLDivElement>(null);
  const raw = useRef<Point[]>([]);
  const drawing = useRef<{ pointerId: number; color: string } | null>(null);
  // 消しゴム: なぞっている間に画面から外した線(離したときにまとめて保存する)
  const erasing = useRef<{ pointerId: number; last: Point; gone: Stroke[] } | null>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{ color: string; points: Point[] } | null>(null);

  // Esc でペンをOFF(描いている途中なら、その1本は捨てる)
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      drawing.current = null;
      raw.current = [];
      setLive(null);
      if (erasing.current) void commitErase(erasing.current.gone); // 消した分は残す
      erasing.current = null;
      setOn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, setOn]);

  // ペンON中でも、ホイールでの拡大縮小はできるようにする(オーバーレイがホイールを受けてしまうため)
  useEffect(() => {
    const el = overlay.current;
    if (!on || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      void rf.setViewport(zoomViewportAt(rf.getViewport(), factor, e.clientX - r.left, e.clientY - r.top, 0.2, 2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [on, rf]);

  const toFlow = (e: { clientX: number; clientY: number }): Point => {
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  };

  /** 消しゴムの円を、ポインタの位置に出す(再描画せず直接動かす) */
  const moveCursor = (e: { clientX: number; clientY: number }) => {
    const el = cursor.current;
    const box = overlay.current?.getBoundingClientRect();
    if (!el || !box) return;
    el.style.transform = `translate(${e.clientX - box.left - ERASER_RADIUS_PX}px, ${e.clientY - box.top - ERASER_RADIUS_PX}px)`;
    el.style.opacity = "1";
  };

  /** a → b をなぞった消しゴムが触れた線を、画面から外す */
  const eraseSegment = (a: Point, b: Point) => {
    const st = erasing.current;
    if (!st) return;
    const r = ERASER_RADIUS_PX / rf.getViewport().zoom;
    const ids = strokesHitBySegment(useBoard.getState().strokes, a, b, r);
    if (ids.length > 0) st.gone.push(...hideStrokes(ids));
    st.last = b;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawing.current || erasing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      const p = toFlow(e);
      erasing.current = { pointerId: e.pointerId, last: p, gone: [] };
      moveCursor(e);
      eraseSegment(p, p);
      return;
    }
    drawing.current = { pointerId: e.pointerId, color };
    raw.current = [toFlow(e)];
    setLive({ color, points: raw.current });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === "eraser") {
      moveCursor(e);
      const st = erasing.current;
      if (!st || st.pointerId !== e.pointerId) return;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length > 0 ? events : [e.nativeEvent]) eraseSegment(st.last, toFlow(ev));
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // 速く動かすと途中の点が抜けるので、まとめて届いた点を全部使う
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const list = events.length > 0 ? events : [e.nativeEvent];
    const minDist = MIN_SCREEN_DIST / rf.getViewport().zoom;
    let changed = false;
    for (const ev of list) {
      if (raw.current.length >= MAX_POINTS - 1) break;
      const p = toFlow(ev);
      const last = raw.current[raw.current.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) {
        raw.current.push(p);
        changed = true;
      }
    }
    if (changed) setLive({ color: d.color, points: [...raw.current] });
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const er = erasing.current;
    if (er && er.pointerId === e.pointerId) {
      erasing.current = null;
      void commitErase(er.gone);
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawing.current = null;
    const last = toFlow(e);
    if (raw.current.length < MAX_POINTS) raw.current.push(last);
    const minDist = MIN_SCREEN_DIST / rf.getViewport().zoom;
    const finished = finishStroke(raw.current, minDist);
    // 「整える」ON なら、ほぼ閉じた丸を手書き風の楕円に置き換える(丸でなければそのまま)
    const points = (usePen.getState().snap ? snapIfEllipse(finished, { zoom: rf.getViewport().zoom }).points : finished).slice(0, MAX_POINTS);
    raw.current = [];
    setLive(null);
    if (points.length >= 2) void commitStroke(d.color, PEN_WIDTH, points);
  };

  const liveD = live ? smoothPath(live.points) : "";

  return (
    <>
      <ViewportPortal>
        <svg className="pen-strokes" width="1" height="1" aria-hidden="true">
          <SavedStrokes strokes={strokes} />
          {live && (
            <path d={liveD} stroke={live.color} strokeWidth={PEN_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </ViewportPortal>
      {on && (
        <div
          ref={overlay}
          className={`pen-overlay${tool === "eraser" ? " pen-overlay-eraser" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={() => {
            if (cursor.current) cursor.current.style.opacity = "0";
          }}
          aria-hidden="true"
        >
          {tool === "eraser" && <div ref={cursor} className="pen-eraser-cursor" style={{ width: ERASER_RADIUS_PX * 2, height: ERASER_RADIUS_PX * 2 }} />}
        </div>
      )}
    </>
  );
}
