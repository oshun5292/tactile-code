# N9 契約書(表示の設定: 文字サイズ・折り返し・行へ移動)

VSCode と同じ体験。設定はアプリ全体で共通(プロジェクトごとではない)。コードが正。新しい依存は追加しない。N10(すべて保存・自動保存)が、この設定の仕組みを使う(`autoSave` 系の項目は型に先に含めてある)。

## API(`src/api/types.ts` / `tauri.ts` は作成済み。変えない)
- `getSettings() -> EditorSettings | null`(保存が無ければ null。既定値はフロントが持つ)
- `saveSettings(settings)`: 範囲外は丸めて保存(fontSize 10〜28、autoSaveDelayMs 200〜10000、autoSave は列挙以外ならエラー)。

## バックエンド(src-tauri/ のみ)
- `commands/mod.rs` に `get_settings` / `save_settings`、`lib.rs` に登録。
- 保存先は `projects.json` の最上位の任意項目 `settings`(camelCase、`#[serde(default)]`、`skip_serializing_if = "Option::is_none"`)。`schemaVersion` は 2 のまま(追加のみで互換)。既存の `StoreFile` と、一時ファイル経由の原子的保存を使う。古いファイル・壊れたファイルの扱いは既存のまま。
- テスト: 往復、古いファイルの互換、範囲外の丸め、不正な autoSave、IPC 契約(camelCase)。
- 完了条件: `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`。

## フロントエンド(src/ のみ。api/types.ts と tauri.ts は変更しない)
- `mock.ts`: `getSettings` / `saveSettings`(メモリ)。
- 設定の状態: Zustand(`src/features/editor/settingsStore.ts`)。起動時(エディタを開くとき)に `getSettings` を読み、変更は即時に反映して、短いデバウンスで `saveSettings`。既定値: fontSize は**現在の見た目と同じ値**、wordWrap は false(マークダウンは従来どおり折り返す場合は、その挙動を保つ)、autoSave は "off"、autoSaveDelayMs は 1000。
- 文字サイズ: `Ctrl+=` / `Ctrl++`(拡大)、`Ctrl+-`(縮小)、`Ctrl+0`(既定に戻す)、1段階=1px。CodeMirror(コード・マークダウン)に反映(行番号・行の高さが追従。プレビュー(読む)側の文字サイズは変えない)。WebView のページ拡大と競合しないよう preventDefault。
- 折り返し: `Alt+Z` で切り替え(CodeMirror の `EditorView.lineWrapping` を Compartment で入れ替え)。
- 行へ移動: `Ctrl+G` で小さな入力パレット(QuickOpen と同じ流儀のオーバーレイ)。`12` で12行目、`12:5` で12行5桁。範囲外は端に丸める。Enter で移動してエディタへフォーカス、Esc で閉じる。日本語変換中の Enter/Esc は無視。移動は N3 の検索結果の「reveal」の仕組み(行・桁の選択表示)を再利用してよい。
- 設定の入口: ヘッダーに「設定」ボタン(小さなポップオーバー)。文字サイズ(−/＋ とリセット)、折り返しのオン/オフ。**N10 が自動保存の項目をここへ足すので、項目を追加しやすい作りにする**。状態バーのクリックでもよいが、ヘッダーのボタンを正とする。
- 純粋関数(文字サイズの丸め、行・桁の解析 `parseGoto`)に Vitest。
- 見た目は CSS 変数に合わせ、プロジェクト色の継承を壊さない。緑の囲み(`confirm-safe`)は使わない。
- 完了条件: `pnpm build` と `pnpm test`。可能ならブラウザ(モック)で確認し、dev サーバーは止める(ポート 1420 を空ける)。
