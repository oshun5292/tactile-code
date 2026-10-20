import { useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import { useMemo } from "react";
import { connectEndpoints, handDrawnLine, hashString, smoothPath, type Rect } from "../../shared/handdrawn";

export type HandDrawnEdgeData = { color: string };
export type HandDrawnFlowEdge = Edge<HandDrawnEdgeData, "handdrawn">;

const GAP = 3; // 端の丸がカードの縁に半分隠れないよう、少し外に出す
const DOT_R = 3.6;

function rectOf(n: ReturnType<typeof useInternalNode>): Rect | null {
  if (!n) return null;
  const w = n.measured.width ?? n.width;
  const h = n.measured.height ?? n.height;
  if (!w || !h) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
}

/**
 * 手書き風のつなぎ線(36 の ML.link)。
 * ハンドルの位置ではなく、2枚のカードの中心どうしを結ぶ線が縁と交わる点を端にする。
 * 揺らぎは edge.id から作る固定の値なので、描き直しても形が変わらない。
 */
export function HandDrawnEdge({ id, source, target, selected, data }: EdgeProps<HandDrawnFlowEdge>) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));

  const geo = useMemo(() => {
    if (!a || !b) return null;
    const [p0, p1] = connectEndpoints(a, b, GAP);
    const pts = handDrawnLine(p0, p1, { seed: hashString(id), curve: 0.1 });
    return { d: smoothPath(pts), p0, p1 };
    // a, b は毎回新しい object なので、数値を依存にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, a?.x, a?.y, a?.w, a?.h, b?.x, b?.y, b?.w, b?.h]);

  if (!geo) return null;
  const color = data?.color ?? "var(--ink2)";
  const width = selected ? 3.4 : 2;

  return (
    <g className="hd-edge" data-selected={selected ? "" : undefined} style={{ color }}>
      {/* つかみやすいよう、見えない太い線を重ねる(クリック・選択用) */}
      <path d={geo.d} fill="none" stroke="transparent" strokeWidth={22} className="react-flow__edge-interaction" />
      {selected && <path d={geo.d} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={11} strokeLinecap="round" />}
      <path d={geo.d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={geo.p0[0]} cy={geo.p0[1]} r={selected ? DOT_R + 1.2 : DOT_R} fill="currentColor" />
      <circle cx={geo.p1[0]} cy={geo.p1[1]} r={selected ? DOT_R + 1.2 : DOT_R} fill="currentColor" />
    </g>
  );
}
