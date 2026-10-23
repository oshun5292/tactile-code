# N3 契約書(プロジェクト内検索 Ctrl+Shift+F)

VSCode の「検索」と同じ体験: 文字列を入れると、ファイルごとにまとまった結果が出て、クリックで該当行へ移動する。コードが正。新しい依存は追加しない(正規表現は使わない=部分一致のみ)。

## API(`src/api/types.ts` / `tauri.ts` は作成済み。変えない)
`searchInProject(projectId, query, { caseSensitive, wholeWord }) -> { matches: SearchMatch[], truncated, filesSearched }`
`SearchMatch = { relPath, line(1始まり), column(0始まり、行頭からの文字数=UTF-16でなく Unicode スカラー値でよい), length(一致の文字数), preview(その行。前後の空白を除き、200文字まで), previewColumn(preview の中で一致が始まる文字位置。強調表示にはこれを使う。column とは異なる) }`

## バックエンド(src-tauri/ のみ)
- `search_in_project` コマンド(`commands/mod.rs` は薄く、処理は `services/fs.rs` か新規 `services/search.rs`)、`lib.rs` に登録。
- 対象ファイルは `list_files` と同じ列挙(`ignore`、`.git`・`node_modules`・`target` 除外、隠しファイルは含める、リンクの先へ入らない)。ファイルは 2MB 以下、先頭 8KB に NUL を含むものはバイナリとして飛ばす、UTF-8 として読めないものは飛ばす(`filesSearched` に数えない)。BOM は読み飛ばす。
- 空のクエリは空の結果(エラーにしない)。クエリは 1,000 文字まで(超えたらエラー)。`wholeWord` は、前後が英数字・`_` でない一致のみ。`caseSensitive: false` は Unicode の小文字化で比較(日本語も壊れないこと)。
- 結果は、ファイルの自然順→行順。**最大 2,000 件で打ち切り(`truncated: true`)**。`preview` は一致を含む行で、長い行は一致位置の周辺を切り出す(`column` は元の行基準のまま)。
- テスト: 基本一致、大文字小文字、単語単位、日本語、除外(`node_modules`・バイナリ・巨大ファイル)、上限、空クエリ、改行コードが CRLF の行、IPC 契約。
- 完了条件: `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`。

## フロントエンド(src/ のみ。api/types.ts と tauri.ts は変更しない)
- `mock.ts` に `searchInProject`(モックのファイル群から。同じ仕様)。
- 左のサイドバーに「ファイル / 検索」の切り替え(上部に2つのタブ風ボタン)。`Ctrl+Shift+F` で「検索」に切り替えて入力欄にフォーカス。選択中のテキストがあれば、それを入力欄に入れる(CodeMirror の選択を取る手段が難しければ省略可)。
- 検索パネル: 入力欄、「Aa(大文字小文字)」「単語単位」の切り替えボタン、結果(ファイル名の見出し+件数、行は「行番号 + プレビュー(一致を強調)」)。入力から 300ms 後に検索(デバウンス)、古い応答は捨てる。取得中・結果なし・失敗・打ち切り(「結果が多いため、先頭 2,000 件のみ表示しています」)の表示。ファイルの見出しは開閉できる。
- クリックで、そのファイルをタブで開き、該当行・桁を選択して表示(`CodeEditor` に「この行・桁を選択して表示」するための props を追加。MarkdownEditor の書く/半分モードでも動くこと。読むモードのときは「書く」に切り替えない)。開き直しで二度目以降の同じクリックも動くこと(カウンタ方式など)。
- 見た目は CSS 変数に合わせ、プロジェクト色の継承を壊さない。緑の囲み(`confirm-safe`)は使わない。
- 純粋関数(プレビューの強調の分割、結果のファイルごとのグループ化など)に Vitest。完了条件: `pnpm build` と `pnpm test`。可能ならブラウザ(モック)で確認し、dev サーバーは止める(ポート 1420 を空ける)。
