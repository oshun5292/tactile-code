# N11 契約書(ツリーへの git 状態の表示)

VSCode のエクスプローラーと同じ体験: 変更(M)・新規(U)・追加(A)・削除・競合の印を、ファイル名の横に色つきで出す。フォルダは、配下に変更があれば印(ドット)を出す。コードが正。新しい依存は追加しない(git CLI を使う。`services/git.rs` の `run_git` の流儀)。

## API(`src/api/types.ts` / `tauri.ts` は作成済み。変えない)
`getGitStatus(projectId) -> { isRepo, files: [{relPath, state}], truncated }`
`state` = `modified | added | deleted | renamed | untracked | conflicted`

## バックエンド(src-tauri/ のみ)
- `get_git_status` コマンド(`commands/mod.rs` は薄く、処理は `services/git.rs`)、`lib.rs` に登録。
- プロジェクトのルート直下に `.git` があるときだけ対象(親フォルダのリポジトリを拾わない。`read_git_info` と同じ)。無ければ `isRepo: false`、`files: []`(エラーにしない)。git が無い環境も同様。
- `git -C <root> status --porcelain=v1 -z --untracked-files=all`(`-z` で日本語・空白のパスを正しく扱う。`core.quotepath` に依存しない)。XY の 2 文字を分類: `??`→untracked、`A`/`AM` など→added、`D` を含む→deleted、`R`→renamed(新しいほうのパスを返す。`-z` では「新パス\0旧パス」の順)、`U`/`AA`/`DD` など競合→conflicted、それ以外の `M` を含むもの→modified。ステージ済み・未ステージの区別はしない。
- 相対パスは `/` 区切り。`resolve` 系の検証は不要(git の出力を、プロジェクトの内側であることだけ確認する: `..` や絶対パスは捨てる)。上限 5,000 件で打ち切り(`truncated: true`)。
- リンク(リパースポイント)の先は出さない(git が出すのはリポジトリの内側のパスのみ。念のため確認)。
- テスト: 一時フォルダで `git init` して、各状態(新規・変更・削除・リネーム・競合は作れなければ分類関数の単体テストで)、日本語・空白のパス、git 管理外のフォルダ(isRepo:false)、上限。git が使えない環境ではテストをスキップする(CI 想定)。分類の関数は、porcelain の文字列を直接渡す単体テストを中心にする。IPC 契約テスト。
- 完了条件: `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`。

## フロントエンド(src/ のみ。api/types.ts と tauri.ts は変更しない)
- `mock.ts`: `getGitStatus`(モックのプロジェクトのうち 1〜2 個に、数件の変更を返す。残りは isRepo:false)。
- ストア: プロジェクトごとの git 状態を保持。取得のタイミング: エディタを開いたとき、ウィンドウのフォーカス復帰、ファイルの保存成功後(デバウンス 500ms)、作成・名前変更・削除・複製・移動の後、ツリーの再読み込みボタン。取得は重複させない(進行中なら待つ)。失敗しても画面は壊さない(印を出さないだけ)。
- ツリー(`FileTree.tsx`): ファイル名の右に、状態の文字(M / U / A / D / R / !)を色つきで。色は CSS 変数(M=琥珀、U/A=緑、D=赤、R=青、競合=赤の濃い色。`tokens.css` の既存の変数を使い、足りなければ `--git-*` を `tokens.css` に追加)。ファイル名自体も、薄く色を付けてよい(VSCode 同様)。フォルダは、配下に変更がある場合、右にドット(最も優先度の高い状態の色)。削除された(`deleted`)ファイルは、ツリー上に存在しないので、フォルダのドットにだけ反映する。
- タブにも、変更ありの文字色または小さな印(任意)。
- 純粋関数(フォルダへの集計、状態の優先度、パスの親フォルダ列挙)に Vitest。
- 見た目は CSS 変数に合わせ、プロジェクト色の継承を壊さない。緑の囲み(`confirm-safe`)は使わない。完了条件: `pnpm build` と `pnpm test`。可能なら、ブラウザ(モック)で確認し、dev サーバーは止める(ポート 1420 を空ける)。
