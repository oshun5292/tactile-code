import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AutoSaveMode } from "../../api/types";
import { AUTO_SAVE_DELAY_CHOICES } from "./autoSaveLogic";
import { FONT_DEFAULT, FONT_MAX, FONT_MIN } from "./settingsLogic";
import { useSettings } from "./settingsStore";

/** 設定の1行。N10 などが項目を足すときは、SettingsMenu の中にこれを1つ足すだけでよい。 */
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** ヘッダーの「設定」ボタンと、そのポップオーバー。 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popId = useId();
  const { fontSize, wordWrap, autoSave, autoSaveDelayMs } = useSettings((s) => s.settings);
  const { zoom, resetFont, toggleWrap, update } = useSettings.getState();

  // 外側のクリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      className="settings"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open && !e.nativeEvent.isComposing) {
          e.preventDefault(); // 画面全体の Esc(ボードへ戻る)に渡さない
          setOpen(false);
          root.current?.querySelector<HTMLElement>(".settings-btn")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="btn btn-ghost settings-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        title="表示の設定"
      >
        設定
      </button>
      {open && (
        <div className="settings-pop" id={popId} role="dialog" aria-label="表示の設定">
          <SettingRow label="文字サイズ" hint="Ctrl + / Ctrl -">
            <button type="button" className="step-btn" onClick={() => zoom(-1)} disabled={fontSize <= FONT_MIN} aria-label="文字を小さくする">
              −
            </button>
            <output className="setting-value" aria-live="polite">
              {fontSize}px
            </output>
            <button type="button" className="step-btn" onClick={() => zoom(1)} disabled={fontSize >= FONT_MAX} aria-label="文字を大きくする">
              ＋
            </button>
            <button type="button" className="btn btn-ghost setting-reset" onClick={resetFont} disabled={fontSize === FONT_DEFAULT} title="既定に戻す(Ctrl+0)">
              戻す
            </button>
          </SettingRow>
          <SettingRow label="折り返し" hint="Alt+Z">
            <label className="setting-switch">
              <input type="checkbox" checked={wordWrap} onChange={toggleWrap} />
              <span>{wordWrap ? "オン" : "オフ"}</span>
            </label>
          </SettingRow>
          <p className="setting-note">マークダウンの「書く」側は、読みやすさのため常に折り返します。</p>
          <SettingRow label="自動保存">
            <select
              className="setting-select"
              value={autoSave}
              aria-label="自動保存"
              onChange={(e) => update({ autoSave: e.target.value as AutoSaveMode })}
            >
              <option value="off">オフ</option>
              <option value="afterDelay">一定時間後</option>
              <option value="onFocusChange">フォーカスが外れたとき</option>
            </select>
          </SettingRow>
          {autoSave === "afterDelay" && (
            <SettingRow label="待ち時間" hint="最後の入力から">
              <select
                className="setting-select"
                value={autoSaveDelayMs}
                aria-label="自動保存の待ち時間"
                onChange={(e) => update({ autoSaveDelayMs: Number(e.target.value) })}
              >
                {/* 設定ファイルに一覧外の値があっても、そのまま選択肢に出して表示がずれないようにする */}
                {(AUTO_SAVE_DELAY_CHOICES as readonly number[]).includes(autoSaveDelayMs) ? null : (
                  <option value={autoSaveDelayMs}>{autoSaveDelayMs / 1000} 秒</option>
                )}
                {AUTO_SAVE_DELAY_CHOICES.map((ms) => (
                  <option key={ms} value={ms}>
                    {ms / 1000} 秒
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
        </div>
      )}
    </div>
  );
}
