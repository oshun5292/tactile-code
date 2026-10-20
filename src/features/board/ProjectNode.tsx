import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { ProjectSummary } from "../../api/types";
import { ProjectCard } from "../../shared/ui/ProjectCard";
import { useBoard } from "./store";

export type ProjectNodeData = {
  project: ProjectSummary;
  onRemoveRequest: (project: ProjectSummary) => void;
};
export type ProjectFlowNode = Node<ProjectNodeData, "project">;

const SIDES = [
  [Position.Top, "top"],
  [Position.Right, "right"],
  [Position.Bottom, "bottom"],
  [Position.Left, "left"],
] as const;

/**
 * React Flow のカスタムノード。中身は段階1の ProjectCard。
 * 4辺のハンドル(つなぐための小さな丸)は、ホバー時だけ見える。
 * すべて type="source" にしておき、ConnectionMode.Loose で「どの丸同士でもつなげる」ようにする。
 */
function ProjectNodeImpl({ data }: NodeProps<ProjectFlowNode>) {
  const setNote = useBoard((s) => s.setNote);
  const setDescription = useBoard((s) => s.setDescription);
  return (
    <div className="project-node">
      {SIDES.map(([pos, id]) => (
        <Handle key={id} id={id} type="source" position={pos} className="card-handle" aria-label={`つなぐ(${id})`} />
      ))}
      <ProjectCard
        project={data.project}
        onNoteChange={(id, note) => void setNote(id, note)}
        onDescriptionChange={(id, d) => void setDescription(id, d)}
        onRemoveRequest={data.onRemoveRequest}
      />
    </div>
  );
}

export const ProjectNode = memo(ProjectNodeImpl);
