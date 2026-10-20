# 段階3b-1 契約書(エディタの保護: 閉じる確認・外部変更の検知・タブの復元)

方針(ユーザー決定): エディタは「VSCode でできることと同じ」を目指す。キーボードだけでの画面移動(アクセシビリティ)は後回し。
コードが正。この文書と食い違ったらこちらを直す。

## 1. 範囲
1. 未保存のままウィンドウを閉じるときの確認(保存して閉じる/破棄して閉じる/やめる)。
2. 外部で変更されたファイルの検知(ウィンドウにフォーカスが戻ったときと、一定間隔)。
3. 前回開いていたタブ・開いていたフォルダ・アクティブなタブの復元(プロジェクトごと)。
4. (既存確認のみ)Tab キーの字下げは `indentWithTab` で実装済み。

## 2. API(`src/api/types.ts` と `src/api/tauri.ts` は作成済み。変えない)
- `statFiles(projectId, relPaths) -> FileStat[]`: `{relPath, exists, modified}`。入力と同じ順序。無い・読めない・パスが不正は `exists:false, modified:null`(全体を失敗にしない)。パス検証は `resolve()` を通す。一度に最大 200 件。
- `getEditorSession(projectId) -> EditorSessionData | null`: 保存が無ければ null。
- `saveEditorSession(projectId, data)`: 上書き保存。`tabs` 最大 200、`expanded` 最大 500、パス文字列は 1,000 文字まで(超えたら先頭から切り詰め。エラーにしない)。プロジェクトが無ければエラー。
- `onCloseRequested(handler) -> unlisten`: handler が false を返すとウィンドウを閉じない。

## 3. バックエンド(Rust)
- `commands/mod.rs` に `stat_files` / `get_editor_session` / `save_editor_session`。`lib.rs` の handler に登録。
- セッションは `projects.json` の各プロジェクトに任意項目 `editorSession`(camelCase)として保存。`#[serde(default)]` で古いファイルも読める。`schemaVersion` は 2 のまま(追加のみで互換)。
- 復元時に存在しないパスは、フロント側で捨てる(Rust は検証しない)。ただし保存値は `validate_rel` 相当の字句チェックを通し、不正なパスは保存時に落とす。
- テスト: stat(存在/不在/`..`/リンク)、セッションの保存・読み出し・古いファイルの互換・上限の切り詰め、IPC 契約テスト(`tests/ipc_contract.rs`)に3コマンドを追加。
- 完了条件: `cargo test` / `cargo clippy -- -D warnings` / `cargo fmt --check` が通る。

## 4. フロントエンド
- `src/api/mock.ts`: 3つの新メソッドを実装(セッションは `localStorage` ではなくメモリでよい。`onCloseRequested` は `beforeunload` に未保存があるときの警告を結びつける)。
- 閉じる確認: `onCloseRequested` を、エディタ画面のマウント時に登録する(ボード表示中は、どのプロジェクトも未保存が無いので素通し)。未保存が複数のプロジェクトにあってもよいよう、全プロジェクトの未保存タブを見る。既存の `ChoiceDialog` の3択(保存/破棄/やめる)を再利用。保存に失敗したら閉じない。
- 外部変更の検知: ウィンドウの `focus` と、エディタ表示中は 5 秒おきに、開いているタブの `statFiles` を呼ぶ。`modified` が保存時の値と違うとき:
  - 未保存の変更が無いタブ → 自動で読み込み直す(気づかせるため、タブに短い表示を出してよい)。
  - 未保存の変更があるタブ → 勝手に上書きしない。タブに「外部で変更されました」の印を出し、保存時の競合ダイアログに任せる(既存の仕組み)。
  - `exists:false` になったタブ → 「ファイルが削除されました」の印。タブは閉じない(内容を救えるように)。
  - ファイルツリーも、フォーカス時に再読み込み(開いているフォルダのみ)。
  - 自分の保存で更新した `modified` を、変更として誤検知しないこと。
- タブの復元: タブ・アクティブ・展開フォルダが変わったら、短い間(500ms 程度)まとめて `saveEditorSession`。`openEditor` で初めて開くとき(`isNew`)に `getEditorSession` を読み、存在するファイルだけタブを開く(復元するときは README の自動オープンはしない。復元が空なら従来どおり README)。
- 純粋関数(復元データの組み立て、外部変更の判定)は `editorLogic.ts` に置き、Vitest でテスト。
- 完了条件: `pnpm build` と `pnpm test` が通る。

## 5. 触るファイルの分担(衝突を避ける)
- バックエンド担当: `src-tauri/` のみ。
- フロント担当: `src/` のみ(`src/api/types.ts` と `src/api/tauri.ts` は変更しない)。
