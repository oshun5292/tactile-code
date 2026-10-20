import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Stroke } from "../../api/types";
import { finishStroke, smoothPath, zoomViewportAt, type Point } from "../../shared/handdrawn";
import { PEN_WIDTH, usePen } from "./penStore";

const MIN_SCREEN_DIST = 1.5; // 画面上でこれより近い点は捨てる(px)
const MAX_POINTS = 5000; // 契約の上限

type Props = {
  strokes: Stroke[];
  onCommit: (color: string, width: number, points: [number, number][]) => void;
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
export function PenLayer({ strokes, onCommit }: Props) {
  const { on, color, setOn } = usePen();
  const rf = useReactFlow();
  const overlay = useRef<HTMLDivElement>(null);
  const raw = useRef<Point[]>([]);
  const drawing = useRef<{ pointerId: number; color: string } | null>(null);
  const [live, setLive] = useState<{ color: string; points: Point[] } | null>(null);

  // Esc でペンをOFF(描いている途中なら、その1本は捨てる)
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      drawing.current = null;
      raw.current = [];
      setLive(null);
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { pointerId: e.pointerId, color };
    raw.current = [toFlow(e)];
    setLive({ color, points: raw.current });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawing.current = null;
    const last = toFlow(e);
    if (raw.current.length < MAX_POINTS) raw.current.push(last);
    const minDist = MIN_SCREEN_DIST / rf.getViewport().zoom;
    const points = finishStroke(raw.current, minDist).slice(0, MAX_POINTS);
    raw.current = [];
    setLive(null);
    if (points.length >= 2) onCommit(d.color, PEN_WIDTH, points);
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
          className="pen-overlay"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
        />
      )}
    </>
  );
}
