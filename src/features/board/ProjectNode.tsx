import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { ProjectSummary } from "../../api/types";
import { ProjectCard } from "../../shared/ui/ProjectCard";
import { useBoard } from "./store";

export type ProjectNodeData = {
  project: ProjectSummary;
  onRemoveRequest: (project: ProjectSummary) => void;
};
export type ProjectFlowNode = Node<ProjectNodeData, "project">;

function ProjectNodeImpl({ data }: NodeProps<ProjectFlowNode>) {
  const setNote = useBoard((s) => s.setNote);
  const setDescription = useBoard((s) => s.setDescription);
  return (
    <div className="project-node">
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
