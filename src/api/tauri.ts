// Tauri の invoke を包む薄いラッパー。React から直接 invoke を呼ばないための窓口。
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { Api, BoardState, EditorSessionData, FileContent, FileList, FileStat, FsEntry, ProjectSummary, SavedFile, SearchResult, Stroke } from "./types";

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
  listDir: (projectId, relPath) => invoke<FsEntry[]>("list_dir", { projectId, relPath }),
  readFile: (projectId, relPath, encoding) => invoke<FileContent>("read_file", { projectId, relPath, encoding: encoding ?? null }),
  writeFile: (projectId, relPath, content, expectedModified, eol, hasBom, encoding, force) =>
    invoke<SavedFile>("write_file", { projectId, relPath, content, expectedModified, eol, hasBom, encoding, force }),
  createFile: (projectId, relPath) => invoke<FsEntry>("create_file", { projectId, relPath }),
  createDir: (projectId, relPath) => invoke<FsEntry>("create_dir", { projectId, relPath }),
  renameEntry: (projectId, fromRelPath, toRelPath) => invoke<FsEntry>("rename_entry", { projectId, fromRelPath, toRelPath }),
  duplicateEntry: (projectId, relPath) => invoke<FsEntry>("duplicate_entry", { projectId, relPath }),
  deleteEntry: async (projectId, relPath) => {
    await invoke("delete_entry", { projectId, relPath });
  },
  openInVscode: async (projectId, relPath) => {
    await invoke("open_in_vscode", { projectId, relPath });
  },
  listFiles: (projectId) => invoke<FileList>("list_files", { projectId }),
  searchInProject: (projectId, query, options) => invoke<SearchResult>("search_in_project", { projectId, query, options }),
  statFiles: (projectId, relPaths) => invoke<FileStat[]>("stat_files", { projectId, relPaths }),
  getEditorSession: (projectId) => invoke<EditorSessionData | null>("get_editor_session", { projectId }),
  saveEditorSession: async (projectId, data) => {
    await invoke("save_editor_session", { projectId, data });
  },
  // 閉じる要求を止めるか通すかは handler が決める。通すときは何もしなければウィンドウが閉じる。
  onCloseRequested: (handler) =>
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    }),
};
