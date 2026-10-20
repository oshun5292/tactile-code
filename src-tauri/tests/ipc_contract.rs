//! tauri::test のモックIPCで、コマンドの呼び出しと JSON の形が契約書(docs/stage1-contract.md)どおりか確認する。
//! 統合テストにしているのは、Windows ではテスト exe にマニフェストを埋め込む必要があるため(build.rs 参照)。
use serde_json::{Value, json};
use tactile_code_lib::commands::*;
use tactile_code_lib::storage::Store;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

struct Harness {
    _app: App<tauri::test::MockRuntime>,
    win: WebviewWindow<tauri::test::MockRuntime>,
    _data: tempfile::TempDir,
}

fn harness() -> Harness {
    let data = tempfile::tempdir().unwrap();
    let app = mock_builder()
        .manage(Store::new(data.path().join("projects.json")))
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            update_project_note,
            update_project_description,
            move_project,
            refresh_project,
            get_board,
            add_stroke,
            remove_stroke,
            clear_strokes,
            save_viewport,
            list_dir,
            read_file,
            write_file,
            stat_files,
            get_editor_session,
            save_editor_session,
            create_file,
            create_dir,
            rename_entry,
            delete_entry,
            open_in_vscode,
            list_files
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let win = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Harness {
        _app: app,
        win,
        _data: data,
    }
}

fn call(h: &Harness, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        &h.win,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|r: InvokeResponseBody| r.deserialize::<Value>().unwrap())
}

#[test]
fn contract_shape_and_flow() {
    let h = harness();
    let proj = tempfile::tempdir().unwrap();
    std::fs::write(proj.path().join("a.py"), "x".repeat(900)).unwrap();
    std::fs::write(proj.path().join("README.md"), "# T\n\nこれは説明です\n").unwrap();
    let p = proj.path().to_str().unwrap();

    assert_eq!(call(&h, "list_projects", json!({})).unwrap(), json!([]));

    let added = call(&h, "add_project", json!({ "path": p })).unwrap();
    let obj = added.as_object().unwrap();
    let mut keys: Vec<String> = obj.keys().cloned().collect();
    keys.sort();
    let mut expected: Vec<String> = [
        "description",
        "displayPath",
        "exists",
        "git",
        "id",
        "languages",
        "lastUpdated",
        "mainLanguage",
        "name",
        "note",
        "path",
        "position",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    expected.sort();
    assert_eq!(keys, expected);
    assert_eq!(obj["exists"], json!(true));
    assert_eq!(obj["description"], json!("これは説明です"));
    assert_eq!(obj["mainLanguage"], json!("Python"));
    // README(Markdown)も数えるので Python は100%ではない。合計は100
    assert_eq!(obj["languages"][0]["name"], json!("Python"));
    assert!(obj["languages"][0]["percent"].is_u64());
    let total: u64 = obj["languages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["percent"].as_u64().unwrap())
        .sum();
    assert_eq!(total, 100);
    assert!(obj["git"].is_null());
    assert!(obj["lastUpdated"].is_string());
    assert_eq!(obj["position"], json!({ "x": 0.0, "y": 0.0 }));
    assert!(obj["displayPath"].as_str().unwrap().contains('/'));
    assert!(uuid::Uuid::parse_str(obj["id"].as_str().unwrap()).is_ok());
    let id = obj["id"].as_str().unwrap().to_string();

    // 二重登録・存在しない・ファイル
    let dup = call(&h, "add_project", json!({ "path": p })).unwrap_err();
    assert_eq!(dup, json!("すでに登録されています"));
    assert!(call(&h, "add_project", json!({ "path": "/no/such/xyz" })).is_err());
    let file = proj.path().join("a.py");
    assert!(call(&h, "add_project", json!({ "path": file.to_str().unwrap() })).is_err());

    // 更新系は null を返す
    assert_eq!(
        call(
            &h,
            "update_project_note",
            json!({ "id": id, "note": "メモ" })
        )
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        call(
            &h,
            "update_project_description",
            json!({ "id": id, "description": "上書き" })
        )
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        call(&h, "move_project", json!({ "id": id, "x": 100.5, "y": 20 })).unwrap(),
        Value::Null
    );
    let too_long = "あ".repeat(201);
    assert!(
        call(
            &h,
            "update_project_note",
            json!({ "id": id, "note": too_long })
        )
        .is_err()
    );

    let r = call(&h, "refresh_project", json!({ "id": id })).unwrap();
    assert_eq!(r["note"], json!("メモ"));
    assert_eq!(r["description"], json!("上書き"));
    assert_eq!(r["position"], json!({ "x": 100.5, "y": 20.0 }));

    // null で README 由来に戻る
    call(
        &h,
        "update_project_description",
        json!({ "id": id, "description": null }),
    )
    .unwrap();
    let r = call(&h, "refresh_project", json!({ "id": id })).unwrap();
    assert_eq!(r["description"], json!("これは説明です"));

    // 2件目は(1件目が動いたので)最初の格子位置に入る
    let proj2 = tempfile::tempdir().unwrap();
    let second = call(
        &h,
        "add_project",
        json!({ "path": proj2.path().to_str().unwrap() }),
    )
    .unwrap();
    assert_eq!(second["position"], json!({ "x": 0.0, "y": 0.0 }));
    assert!(second["mainLanguage"].is_null());

    // フォルダが消えても list は失敗しない
    drop(proj2);
    let list = call(&h, "list_projects", json!({})).unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[1]["exists"], json!(false));

    // remove は記憶から外すだけでフォルダは残る
    let sid = arr[1]["id"].as_str().unwrap().to_string();
    assert_eq!(
        call(&h, "remove_project", json!({ "id": sid })).unwrap(),
        Value::Null
    );
    assert!(proj.path().join("a.py").exists());
    assert_eq!(
        call(&h, "list_projects", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(call(&h, "remove_project", json!({ "id": "nope" })).is_err());
}

fn add_dir(h: &Harness, dir: &tempfile::TempDir) -> String {
    let p = call(
        h,
        "add_project",
        json!({ "path": dir.path().to_str().unwrap() }),
    )
    .unwrap();
    p["id"].as_str().unwrap().to_string()
}

/// 段階2契約 §2, §3: get_board と各コマンドの JSON の形(camelCase)と、カード削除で手書きが残ること。
#[test]
fn stage2_board_contract() {
    let h = harness();
    // 空の状態
    assert_eq!(
        call(&h, "get_board", json!({})).unwrap(),
        json!({ "strokes": [], "viewport": null })
    );

    let d1 = tempfile::tempdir().unwrap();
    let a = add_dir(&h, &d1);

    // add_stroke: {id, color, width, points: [[x,y],...]}
    let s = call(
        &h,
        "add_stroke",
        json!({ "color": "#e2708a", "width": 3, "points": [[0, 0], [10.5, 4]] }),
    )
    .unwrap();
    let mut keys: Vec<&str> = s.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    assert_eq!(keys, ["color", "id", "points", "width"]);
    assert_eq!(s["color"], json!("#e2708a"));
    assert_eq!(s["width"], json!(3.0));
    assert_eq!(s["points"], json!([[0.0, 0.0], [10.5, 4.0]]));
    assert!(
        call(
            &h,
            "add_stroke",
            json!({ "color": "red", "width": 3, "points": [[0, 0], [1, 1]] })
        )
        .is_err()
    );
    assert!(
        call(
            &h,
            "add_stroke",
            json!({ "color": "#000000", "width": 13, "points": [[0, 0], [1, 1]] })
        )
        .is_err()
    );
    assert!(
        call(
            &h,
            "add_stroke",
            json!({ "color": "#000000", "width": 3, "points": [[0, 0]] })
        )
        .is_err()
    );
    let s1 = s["id"].as_str().unwrap().to_string();
    let s2 = call(
        &h,
        "add_stroke",
        json!({ "color": "#34302b", "width": 3, "points": [[0, 0], [1, 1]] }),
    )
    .unwrap();

    // save_viewport の往復。範囲外ズームはエラー
    assert_eq!(
        call(
            &h,
            "save_viewport",
            json!({ "x": -10.5, "y": 20, "zoom": 0.75 })
        )
        .unwrap(),
        Value::Null
    );
    assert!(call(&h, "save_viewport", json!({ "x": 0, "y": 0, "zoom": 3 })).is_err());

    let board = call(&h, "get_board", json!({})).unwrap();
    assert_eq!(board["strokes"].as_array().unwrap().len(), 2);
    assert_eq!(
        board["viewport"],
        json!({ "x": -10.5, "y": 20.0, "zoom": 0.75 })
    );

    // remove_stroke / clear_strokes
    assert_eq!(
        call(&h, "remove_stroke", json!({ "id": s1 })).unwrap(),
        Value::Null
    );
    assert!(call(&h, "remove_stroke", json!({ "id": s1 })).is_err());
    assert_eq!(
        call(&h, "get_board", json!({})).unwrap()["strokes"][0]["id"],
        s2["id"]
    );

    // カードを消しても、手書きは残る
    call(&h, "remove_project", json!({ "id": a })).unwrap();
    let board = call(&h, "get_board", json!({})).unwrap();
    assert_eq!(board["strokes"].as_array().unwrap().len(), 1);
    assert!(board.get("edges").is_none());

    assert_eq!(call(&h, "clear_strokes", json!({})).unwrap(), Value::Null);
    let board = call(&h, "get_board", json!({})).unwrap();
    assert_eq!(board["strokes"], json!([]));
}

/// 段階3契約 §2, §3: list_dir / read_file / write_file の JSON の形(camelCase)と、エラー。
#[test]
fn stage3_editor_contract() {
    let h = harness();
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir(d.path().join("sub")).unwrap();
    std::fs::write(d.path().join("sub").join("x.md"), "# t\r\nb\r\n").unwrap();
    std::fs::write(d.path().join("a.txt"), "hello").unwrap();
    let id = add_dir(&h, &d);

    let list = call(&h, "list_dir", json!({ "projectId": id, "relPath": "" })).unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let mut keys: Vec<&str> = arr[0]
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    keys.sort();
    assert_eq!(keys, ["kind", "modified", "name", "relPath", "size"]);
    assert_eq!(arr[0]["kind"], json!("dir"));
    assert_eq!(arr[0]["relPath"], json!("sub"));
    assert_eq!(arr[1]["kind"], json!("file"));
    assert_eq!(arr[1]["size"], json!(5));
    assert!(arr[1]["modified"].is_string());

    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "sub/x.md" }),
    )
    .unwrap();
    let mut keys: Vec<&str> = r.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "content", "encoding", "eol", "hasBom", "kind", "modified", "relPath", "size"
        ]
    );
    assert_eq!(r["kind"], json!("text"));
    assert_eq!(r["content"], json!("# t\nb\n"));
    assert_eq!(r["eol"], json!("crlf"));
    assert_eq!(r["hasBom"], json!(false));
    assert_eq!(r["encoding"], json!("utf-8"));
    assert_eq!(r["relPath"], json!("sub/x.md"));

    // 種類の名前(camelCase)
    std::fs::write(d.path().join("b.bin"), [0u8, 1]).unwrap();
    std::fs::write(d.path().join("s.txt"), [0x81u8, 0x20]).unwrap();
    std::fs::write(d.path().join("big.txt"), vec![b'a'; 2 * 1024 * 1024 + 1]).unwrap();
    let kind = |rel: &str| {
        call(&h, "read_file", json!({ "projectId": id, "relPath": rel })).unwrap()["kind"].clone()
    };
    assert_eq!(kind("b.bin"), json!("binary"));
    assert_eq!(kind("s.txt"), json!("unsupportedEncoding"));
    assert_eq!(kind("big.txt"), json!("tooLarge"));

    // 保存(引数は camelCase)
    let saved = call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sub/x.md", "content": "new\n",
                "expectedModified": r["modified"], "eol": "crlf", "hasBom": true, "encoding": "utf-8", "force": false }),
    )
    .unwrap();
    assert_eq!(saved["size"], json!(8)); // BOM 3 + "new\r\n" 5
    assert!(saved["modified"].is_string());
    assert_eq!(
        std::fs::read(d.path().join("sub").join("x.md")).unwrap(),
        b"\xEF\xBB\xBFnew\r\n"
    );

    // 競合は「競合:」で始まる文字列、force で通る(expectedModified は null 可)
    let err = call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sub/x.md", "content": "z",
                "expectedModified": "2000-01-01T00:00:00Z", "eol": "lf", "hasBom": false, "encoding": "utf-8", "force": false }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("競合:"));
    call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sub/x.md", "content": "z",
                "expectedModified": null, "eol": "lf", "hasBom": false, "encoding": "utf-8", "force": true }),
    )
    .unwrap();

    // 文字コード(段階3b-3): 自動判定・指定読み・変更保存・変換エラー。名前は ENCODINGS と一致する
    let (sj, _, _) = encoding_rs::SHIFT_JIS.encode("日本語");
    std::fs::write(d.path().join("sj.txt"), &sj).unwrap();
    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "sj.txt" }),
    )
    .unwrap();
    assert_eq!(r["encoding"], json!("shift_jis"));
    assert_eq!(r["content"], json!("日本語"));
    // encoding: null(省略相当)は自動判定、指定すればその文字コードで読む
    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "sj.txt", "encoding": null }),
    )
    .unwrap();
    assert_eq!(r["encoding"], json!("shift_jis"));
    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "sj.txt", "encoding": "utf-8" }),
    )
    .unwrap();
    assert_eq!(r["kind"], json!("unsupportedEncoding"));
    assert_eq!(r["encoding"], json!("utf-8"));
    // 変換できない文字は「変換:」で失敗し、ファイルは変わらない
    let err = call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sj.txt", "content": "😀",
                "expectedModified": null, "eol": "lf", "hasBom": false, "encoding": "shift_jis", "force": true }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("変換:"));
    assert_eq!(std::fs::read(d.path().join("sj.txt")).unwrap(), sj.as_ref());
    // 文字コードを変えて保存(UTF-16LE は BOM 付き)
    call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sj.txt", "content": "a",
                "expectedModified": null, "eol": "lf", "hasBom": false, "encoding": "utf-16le", "force": true }),
    )
    .unwrap();
    assert_eq!(
        std::fs::read(d.path().join("sj.txt")).unwrap(),
        [0xFF, 0xFE, 0x61, 0x00]
    );
    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "sj.txt" }),
    )
    .unwrap();
    assert_eq!(r["encoding"], json!("utf-16le"));
    assert_eq!(r["hasBom"], json!(true));
    // 未知の文字コード名は拒否
    assert!(
        call(
            &h,
            "read_file",
            json!({ "projectId": id, "relPath": "sj.txt", "encoding": "latin2" })
        )
        .is_err()
    );

    // 拒否・未登録のプロジェクトは日本語の文字列エラー
    let err = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "../x" }),
    )
    .unwrap_err();
    assert!(err.is_string());
    let err = call(
        &h,
        "list_dir",
        json!({ "projectId": "nope", "relPath": "" }),
    )
    .unwrap_err();
    assert_eq!(err, json!("プロジェクトが見つかりません"));
}

/// 段階3b-1契約 §2, §3: stat_files / get_editor_session / save_editor_session の JSON の形と挙動。
#[test]
fn stage3b1_session_and_stat_contract() {
    let h = harness();
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("a.txt"), "hello").unwrap();
    let id = add_dir(&h, &d);

    // stat: 入力順・camelCase、不在と不正は exists:false(全体は成功)
    let st = call(
        &h,
        "stat_files",
        json!({ "projectId": id, "relPaths": ["a.txt", "nope.txt", "../a.txt"] }),
    )
    .unwrap();
    let arr = st.as_array().unwrap();
    assert_eq!(arr.len(), 3);
    let mut keys: Vec<&str> = arr[0]
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    keys.sort();
    assert_eq!(keys, ["exists", "modified", "relPath"]);
    assert_eq!(arr[0]["relPath"], json!("a.txt"));
    assert_eq!(arr[0]["exists"], json!(true));
    assert!(arr[0]["modified"].is_string());
    assert_eq!(
        arr[1],
        json!({ "relPath": "nope.txt", "exists": false, "modified": null })
    );
    assert_eq!(arr[2]["exists"], json!(false));
    // read_file の modified と同じ文字列(誤検知しない)
    let r = call(
        &h,
        "read_file",
        json!({ "projectId": id, "relPath": "a.txt" }),
    )
    .unwrap();
    assert_eq!(arr[0]["modified"], r["modified"]);
    // 201件はエラー、未登録のプロジェクトも日本語エラー
    let many: Vec<String> = (0..201).map(|i| format!("f{i}")).collect();
    assert!(
        call(
            &h,
            "stat_files",
            json!({ "projectId": id, "relPaths": many })
        )
        .is_err()
    );
    assert_eq!(
        call(
            &h,
            "stat_files",
            json!({ "projectId": "nope", "relPaths": [] })
        )
        .unwrap_err(),
        json!("プロジェクトが見つかりません")
    );

    // セッション: 保存が無ければ null
    assert_eq!(
        call(&h, "get_editor_session", json!({ "projectId": id })).unwrap(),
        Value::Null
    );
    let data = json!({
        "tabs": [{ "relPath": "a.txt", "mdMode": "split" }, { "relPath": "../evil", "mdMode": "read" }],
        "active": "a.txt",
        "expanded": ["sub", "a//b"]
    });
    assert_eq!(
        call(
            &h,
            "save_editor_session",
            json!({ "projectId": id, "data": data })
        )
        .unwrap(),
        Value::Null
    );
    // 不正なパスは保存時に落ちる
    assert_eq!(
        call(&h, "get_editor_session", json!({ "projectId": id })).unwrap(),
        json!({
            "tabs": [{ "relPath": "a.txt", "mdMode": "split" }],
            "active": "a.txt",
            "expanded": ["sub"]
        })
    );
    // 上書き。active は null 可
    call(
        &h,
        "save_editor_session",
        json!({ "projectId": id, "data": {
            "tabs": [{ "relPath": "a.txt", "mdMode": "write" }], "active": null, "expanded": [] } }),
    )
    .unwrap();
    let got = call(&h, "get_editor_session", json!({ "projectId": id })).unwrap();
    assert_eq!(got["active"], Value::Null);
    assert_eq!(got["tabs"][0]["mdMode"], json!("write"));
    // 未登録のプロジェクトは、保存も取得もエラー
    assert_eq!(
        call(
            &h,
            "save_editor_session",
            json!({ "projectId": "nope", "data": { "tabs": [], "active": null, "expanded": [] } })
        )
        .unwrap_err(),
        json!("プロジェクトが見つかりません")
    );
    assert!(call(&h, "get_editor_session", json!({ "projectId": "nope" })).is_err());
    // 他のプロジェクトのセッションには影響しない
    let d2 = tempfile::tempdir().unwrap();
    let id2 = add_dir(&h, &d2);
    assert_eq!(
        call(&h, "get_editor_session", json!({ "projectId": id2 })).unwrap(),
        Value::Null
    );
    // 上限: 件数の超過は切り詰め(エラーにしない)
    let tabs: Vec<Value> = (0..250)
        .map(|i| json!({ "relPath": format!("f{i}.txt"), "mdMode": "split" }))
        .collect();
    call(
        &h,
        "save_editor_session",
        json!({ "projectId": id, "data": { "tabs": tabs, "active": null, "expanded": [] } }),
    )
    .unwrap();
    let got = call(&h, "get_editor_session", json!({ "projectId": id })).unwrap();
    assert_eq!(got["tabs"].as_array().unwrap().len(), 200);
    // 一覧用の要約には editorSession を含めない(既存の形を変えない)
    let p = call(&h, "refresh_project", json!({ "id": id })).unwrap();
    assert!(p.get("editorSession").is_none());
}

/// 段階3b-2契約 §2: create_file / create_dir / rename_entry / delete_entry / open_in_vscode。
#[test]
fn stage3b2_file_ops_contract() {
    let h = harness();
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir(d.path().join("sub")).unwrap();
    let id = add_dir(&h, &d);

    // create_file: FsEntry の形(camelCase)
    let f = call(
        &h,
        "create_file",
        json!({ "projectId": id, "relPath": "sub/new.md" }),
    )
    .unwrap();
    let mut keys: Vec<&str> = f.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    assert_eq!(keys, ["kind", "modified", "name", "relPath", "size"]);
    assert_eq!(f["relPath"], json!("sub/new.md"));
    assert_eq!(f["name"], json!("new.md"));
    assert_eq!(f["kind"], json!("file"));
    assert_eq!(f["size"], json!(0));
    assert!(f["modified"].is_string());
    assert!(d.path().join("sub").join("new.md").is_file());

    // 既存は「既存:」、親なしはエラー
    let err = call(
        &h,
        "create_file",
        json!({ "projectId": id, "relPath": "sub/new.md" }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("既存:"), "{err}");
    assert!(
        call(
            &h,
            "create_dir",
            json!({ "projectId": id, "relPath": "nope/x" })
        )
        .is_err()
    );

    // create_dir
    let dir = call(
        &h,
        "create_dir",
        json!({ "projectId": id, "relPath": "sub/inner" }),
    )
    .unwrap();
    assert_eq!(dir["kind"], json!("dir"));
    let err = call(
        &h,
        "create_dir",
        json!({ "projectId": id, "relPath": "sub/inner" }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("既存:"), "{err}");

    // rename_entry: 引数名は fromRelPath / toRelPath(src/api/tauri.ts と一致)
    let r = call(
        &h,
        "rename_entry",
        json!({ "projectId": id, "fromRelPath": "sub/new.md", "toRelPath": "moved.md" }),
    )
    .unwrap();
    assert_eq!(r["relPath"], json!("moved.md"));
    assert!(d.path().join("moved.md").is_file());
    let err = call(
        &h,
        "rename_entry",
        json!({ "projectId": id, "fromRelPath": "moved.md", "toRelPath": "sub" }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("既存:"), "{err}");
    assert!(
        call(
            &h,
            "rename_entry",
            json!({ "projectId": id, "fromRelPath": "sub", "toRelPath": "sub/inner/sub" }),
        )
        .is_err()
    );
    assert!(
        call(
            &h,
            "rename_entry",
            json!({ "projectId": id, "fromRelPath": "", "toRelPath": "x" }),
        )
        .is_err()
    );

    // delete_entry: 拒否系(ルート・不在・外・.git)。成功は単体テストのごみ箱で確認
    for bad in ["", "nope.txt", "../x", ".git"] {
        assert!(
            call(
                &h,
                "delete_entry",
                json!({ "projectId": id, "relPath": bad })
            )
            .is_err(),
            "{bad}"
        );
    }
    assert!(d.path().exists() && d.path().join("moved.md").exists());

    // open_in_vscode: 起動しない拒否系だけ(不正なパス)
    for bad in ["../x", "nope"] {
        assert!(
            call(
                &h,
                "open_in_vscode",
                json!({ "projectId": id, "relPath": bad })
            )
            .is_err(),
            "{bad}"
        );
    }

    // 未登録のプロジェクトは、どれもファイルに触れず日本語エラー
    let nope = json!("プロジェクトが見つかりません");
    for (cmd, body) in [
        (
            "create_file",
            json!({ "projectId": "nope", "relPath": "a" }),
        ),
        ("create_dir", json!({ "projectId": "nope", "relPath": "a" })),
        (
            "rename_entry",
            json!({ "projectId": "nope", "fromRelPath": "a", "toRelPath": "b" }),
        ),
        (
            "delete_entry",
            json!({ "projectId": "nope", "relPath": "a" }),
        ),
        (
            "open_in_vscode",
            json!({ "projectId": "nope", "relPath": "" }),
        ),
    ] {
        assert_eq!(call(&h, cmd, body).unwrap_err(), nope, "{cmd}");
    }
}

/// N2契約: list_files の JSON の形と挙動。
#[test]
fn stage_n2_list_files_contract() {
    let h = harness();
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("src")).unwrap();
    std::fs::create_dir_all(d.path().join("node_modules/x")).unwrap();
    std::fs::write(d.path().join("src/b.rs"), "x").unwrap();
    std::fs::write(d.path().join("日本語.md"), "x").unwrap();
    std::fs::write(d.path().join("node_modules/x/i.js"), "x").unwrap();
    let id = add_dir(&h, &d);

    let r = call(&h, "list_files", json!({ "projectId": id })).unwrap();
    let mut keys: Vec<&str> = r.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    assert_eq!(keys, ["relPaths", "truncated"]);
    assert_eq!(r["truncated"], json!(false));
    assert_eq!(r["relPaths"], json!(["src/b.rs", "日本語.md"]));

    // 未登録のプロジェクトは日本語エラー
    assert_eq!(
        call(&h, "list_files", json!({ "projectId": "nope" })).unwrap_err(),
        json!("プロジェクトが見つかりません")
    );
}
