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
            write_file
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
            "content", "eol", "hasBom", "kind", "modified", "relPath", "size"
        ]
    );
    assert_eq!(r["kind"], json!("text"));
    assert_eq!(r["content"], json!("# t\nb\n"));
    assert_eq!(r["eol"], json!("crlf"));
    assert_eq!(r["hasBom"], json!(false));
    assert_eq!(r["relPath"], json!("sub/x.md"));

    // 種類の名前(camelCase)
    std::fs::write(d.path().join("b.bin"), [0u8, 1]).unwrap();
    std::fs::write(d.path().join("s.txt"), [0x82u8, 0xA0]).unwrap();
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
                "expectedModified": r["modified"], "eol": "crlf", "hasBom": true, "force": false }),
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
                "expectedModified": "2000-01-01T00:00:00Z", "eol": "lf", "hasBom": false, "force": false }),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().starts_with("競合:"));
    call(
        &h,
        "write_file",
        json!({ "projectId": id, "relPath": "sub/x.md", "content": "z",
                "expectedModified": null, "eol": "lf", "hasBom": false, "force": true }),
    )
    .unwrap();

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
