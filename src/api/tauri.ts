// Tauri の invoke を包む薄いラッパー。React から直接 invoke を呼ばないための窓口。
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Api, BoardState, Edge, ProjectSummary, Stroke } from "./types";

export const tauriApi: Api = {
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  addProject: (path) => invoke<ProjectSummary>("add_project", { path }),
  removeProject: async (id) => {
    await invoke("remove_project", { id });
  },
  updateProjectNote: async (id, note) => {
    await invoke("update_project_note", { id, note });
  },
  updateProjectDescription: async (id, description) => {
    await invoke("update_project_description", { id, description });
  },
  moveProject: async (id, x, y) => {
    await invoke("move_project", { id, x, y });
  },
  refreshProject: (id) => invoke<ProjectSummary>("refresh_project", { id }),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },
  getBoard: () => invoke<BoardState>("get_board"),
  addEdge: (source, target) => invoke<Edge>("add_edge", { source, target }),
  removeEdge: async (id) => {
    await invoke("remove_edge", { id });
  },
  addStroke: (color, width, points) => invoke<Stroke>("add_stroke", { color, width, points }),
  removeStroke: async (id) => {
    await invoke("remove_stroke", { id });
  },
  clearStrokes: async () => {
    await invoke("clear_strokes");
  },
  saveViewport: async (x, y, zoom) => {
    await invoke("save_viewport", { x, y, zoom });
  },
};
