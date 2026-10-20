// Tauri の中なら本物、ブラウザ(pnpm dev)ならモックに切り替える。
import { mockApi } from "./mock";
import { tauriApi } from "./tauri";
import type { Api } from "./types";

const insideTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api: Api = insideTauri ? tauriApi : mockApi;
export type {
  Api,
  ProjectSummary,
  LangShare,
  GitInfo,
  Stroke,
  Viewport,
  BoardState,
  FsEntry,
  FileContent,
  SavedFile,
} from "./types";
