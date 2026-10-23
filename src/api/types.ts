// 契約書(docs/stage1-contract.md §2)の型。Rust 側の JSON(camelCase)と1対1で対応させる。

export type LangShare = { name: string; percent: number };

export type GitInfo = {
  branch: string | null;
  remote: { repo: string } | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommitAt: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  displayPath: string;
  exists: boolean;
  description: string | null;
  note: string;
  languages: LangShare[];
  mainLanguage: string | null;
  git: GitInfo | null;
  lastUpdated: string | null;
  position: { x: number; y: number };
};

// 段階2(docs/stage2-contract.md §2)。座標はすべてフロー座標。
export type Stroke = { id: string; color: string; width: number; points: [number, number][] };
export type Viewport = { x: number; y: number; zoom: number };
export type BoardState = { strokes: Stroke[]; viewport: Viewport | null };

// 段階3(docs/stage3-contract.md §2)。パスはプロジェクトのルートからの相対パス("/" 区切り、ルートは空文字)。
export type FsEntry = { name: string; relPath: string; kind: "dir" | "file"; size: number; modified: string | null };
/** 扱える文字コード(段階3b-3)。ラベルは encoding_rs の名前。 */
export const ENCODINGS = ["utf-8", "shift_jis", "euc-jp", "utf-16le", "utf-16be", "windows-1252", "gbk", "big5", "euc-kr"] as const;
export type EncodingName = (typeof ENCODINGS)[number];
export type FileKind = "text" | "binary" | "tooLarge" | "unsupportedEncoding";
export type Eol = "lf" | "crlf";
export type FileContent = {
  relPath: string;
  kind: FileKind;
  content: string | null; // kind が "text" のときだけ文字列(改行は "\n"、BOM なし)
  size: number;
  modified: string; // 保存時の競合検出に使う
  eol: Eol;
  hasBom: boolean;
  /** 判定した(または指定された)文字コード。kind が "text" のときだけ意味を持つ。 */
  encoding: EncodingName;
};
/** クイックオープン用。ファイルだけの相対パス一覧(".gitignore と重いフォルダを除く")。 */
export type FileList = { relPaths: string[]; truncated: boolean };
export type SavedFile = { modified: string; size: number };

// 段階3b-1(docs/stage3b1-contract.md §2)。
export type FileStat = { relPath: string; exists: boolean; modified: string | null };
export type SessionTab = { relPath: string; mdMode: "write" | "split" | "read" };
/** プロジェクトごとに保存する、エディタの再起動後に復元する状態。 */
export type EditorSessionData = { tabs: SessionTab[]; active: string | null; expanded: string[] };

/** フロントが使う窓口。Tauri 版とモック版が同じ形を満たす。 */
export interface Api {
  listProjects(): Promise<ProjectSummary[]>;
  addProject(path: string): Promise<ProjectSummary>;
  removeProject(id: string): Promise<void>;
  updateProjectNote(id: string, note: string): Promise<void>;
  updateProjectDescription(id: string, description: string | null): Promise<void>;
  moveProject(id: string, x: number, y: number): Promise<void>;
  refreshProject(id: string): Promise<ProjectSummary>;
  /** フォルダ選択ダイアログ。キャンセルなら null。 */
  pickFolder(): Promise<string | null>;

  getBoard(): Promise<BoardState>;
  addStroke(color: string, width: number, points: [number, number][]): Promise<Stroke>;
  removeStroke(id: string): Promise<void>;
  clearStrokes(): Promise<void>;
  saveViewport(x: number, y: number, zoom: number): Promise<void>;

  /** 1階層だけ返す。フォルダが先、あとにファイル。 */
  listDir(projectId: string, relPath: string): Promise<FsEntry[]>;
  /** encoding を渡すと、自動判定せずにその文字コードで読む(VSCode の「エンコード付きで再度開く」)。 */
  readFile(projectId: string, relPath: string, encoding?: EncodingName): Promise<FileContent>;
  /** 既存ファイルの上書き。競合のときは "競合:" で始まる文字列で失敗する(force: true で無視して保存)。 */
  writeFile(
    projectId: string,
    relPath: string,
    content: string,
    expectedModified: string | null,
    eol: Eol,
    hasBom: boolean,
    encoding: EncodingName,
    force: boolean,
  ): Promise<SavedFile>;
  /** プロジェクト内のファイルを再帰で列挙(上限 5 万件。超えたら truncated:true)。Ctrl+P で使う。 */
  listFiles(projectId: string): Promise<FileList>;
  /** 外部変更の検知用。ファイルが無い/読めないときは exists:false(失敗にしない)。 */
  statFiles(projectId: string, relPaths: string[]): Promise<FileStat[]>;
  /** 空のファイルを作る。すでにあれば "既存:" で始まる文字列で失敗。親フォルダは存在していること。 */
  createFile(projectId: string, relPath: string): Promise<FsEntry>;
  createDir(projectId: string, relPath: string): Promise<FsEntry>;
  /** 名前変更・移動(同じプロジェクトの内側)。行き先が既にあれば "既存:" で失敗。 */
  renameEntry(projectId: string, fromRelPath: string, toRelPath: string): Promise<FsEntry>;
  /** 完全には消さず、ごみ箱へ移す。 */
  deleteEntry(projectId: string, relPath: string): Promise<void>;
  /** VSCode の `code` コマンドで開く。relPath が空ならプロジェクトのフォルダ。見つからなければ "VSCode:" で始まる文字列で失敗。 */
  openInVscode(projectId: string, relPath: string): Promise<void>;
  getEditorSession(projectId: string): Promise<EditorSessionData | null>;
  saveEditorSession(projectId: string, data: EditorSessionData): Promise<void>;
  /**
   * ウィンドウを閉じようとしたときに呼ばれる。handler が false を返すと閉じるのをやめる。
   * 戻り値は登録解除の関数。ブラウザ(モック)では beforeunload に結びつける。
   */
  onCloseRequested(handler: () => Promise<boolean>): Promise<() => void>;
}
