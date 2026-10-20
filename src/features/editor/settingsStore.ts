import { create } from "zustand";
import { api } from "../../api";
import type { EditorSettings } from "../../api/types";
import { useEditor } from "./editorStore";
import { DEFAULT_SETTINGS, FONT_DEFAULT, normalizeSettings, stepFontSize } from "./settingsLogic";

const SAVE_DEBOUNCE_MS = 400;

type SettingsState = {
  settings: EditorSettings;
  /** 読み込み済みか(読み込み前の操作を、後から来た保存値で上書きしないための印) */
  loaded: boolean;
  load: () => Promise<void>;
  /** 一部の項目を変える。即時に画面へ反映し、保存は少し待ってまとめて行う(N10 もここから項目を足す) */
  update: (patch: Partial<EditorSettings>) => void;
  zoom: (delta: 1 | -1) => void;
  resetFont: () => void;
  toggleWrap: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let touched = false; // 読み込み完了前にユーザーが変えたか

export const useSettings = create<SettingsState>((set, get) => {
  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      api.saveSettings(get().settings).catch((e) => {
        useEditor.getState().notify("error", `設定を保存できませんでした: ${typeof e === "string" ? e : e instanceof Error ? e.message : String(e)}`);
      });
    }, SAVE_DEBOUNCE_MS);
  };

  return {
    settings: { ...DEFAULT_SETTINGS },
    loaded: false,

    load: async () => {
      if (get().loaded) return;
      try {
        const saved = await api.getSettings();
        // 読み込み中に操作されていたら、操作を優先する
        if (!touched) set({ settings: normalizeSettings(saved) });
      } catch {
        // 読めなければ既定値のまま続ける(エディタを使えなくしない)
      }
      set({ loaded: true });
    },

    update: (patch) => {
      touched = true;
      set((s) => ({ settings: normalizeSettings({ ...s.settings, ...patch }) }));
      scheduleSave();
    },
    zoom: (delta) => get().update({ fontSize: stepFontSize(get().settings.fontSize, delta) }),
    resetFont: () => get().update({ fontSize: FONT_DEFAULT }),
    toggleWrap: () => get().update({ wordWrap: !get().settings.wordWrap }),
  };
});
