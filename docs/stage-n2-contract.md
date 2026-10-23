# N2 契約書(Ctrl+P クイックオープン)

VSCode の `Ctrl+P` と同じ体験: ファイル名を打つと、曖昧一致で候補が出て、Enter で開く。コードが正。新しい依存は追加しない。

## API(`src/api/types.ts` / `tauri.ts` は作成済み。変えない)
`listFiles(projectId) -> { relPaths: string[]; truncated: boolean }`

## バックエンド(src-tauri/ のみ)
- `list_files` コマンド(`commands/mod.rs`、処理は `services/fs.rs`、`lib.rs` に登録)。
- `ignore` クレート(導入済み)で再帰。**言語判定と同じ除外**(`.gitignore` を尊重、`.git` / `node_modules` / `target` など重いフォルダ、リンクの中へ入らない)に揃える。既存の除外設定があれば再利用する。
- ファイルのみ(フォルダは含めない)。相対パスは `/` 区切り。並びは、パスの自然順(`natural_cmp`)。上限 50,000 件で打ち切り、`truncated: true`。
- パス検証: ルートは `project_root`、各エントリは `relative_inside` で内側確認。
- テスト: 除外(`.gitignore`・`node_modules`)、リンクの非追従、上限、日本語名、IPC 契約テストへの追加。
- 完了条件: `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`。

## フロントエンド(src/ のみ。api/types.ts と tauri.ts は変更しない)
- `mock.ts` に `listFiles`(モックのファイル群から)。
- パレット部品 `src/features/editor/QuickOpen.tsx`: 画面上部中央のオーバーレイ(`Esc` で閉じる、背景クリックで閉じる)、入力欄、候補リスト(最大 50 件表示)、↑↓ で選択、Enter で開く。日本語変換中の Enter/Esc は無視。見た目は CSS 変数(tokens.css、overlay.css の流儀)。
- 曖昧一致の純粋関数 `fuzzyMatch(query, path)`(`editorLogic.ts` か新規 `quickOpenLogic.ts`): 文字が順番に含まれていれば一致。スコアは、ファイル名部分への一致・連続一致・先頭一致を優先、短いパスを優先。一致した文字の位置を返し、候補で強調表示。大文字小文字は区別しない。空の入力のときは、最近開いたファイル(タブの順)を先頭に。
- ショートカット: エディタ画面で `Ctrl+P`(CodeMirror の検索と競合しない。ブラウザの印刷は `preventDefault`)。ヘッダーかツリー上部に、押せる入口(「ファイルを探す」ボタンと、ショートカットの表示)も置く。
- 一覧は、開くたびに取得(結果は、開いている間だけ保持)。取得中・失敗・`truncated` の注記(「件数が多いため、一部のみ表示しています」)を表示。
- 純粋関数に Vitest。完了条件: `pnpm build` と `pnpm test`。可能ならブラウザ(モック)で確認し、dev サーバーは止める(ポート 1420 を空ける)。
