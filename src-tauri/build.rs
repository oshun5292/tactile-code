fn main() {
    tauri_build::build();

    // Windows の統合テスト exe には Common Controls v6 のマニフェストが無く、
    // tauri を含むと起動時に STATUS_ENTRYPOINT_NOT_FOUND で落ちる。
    // テスト exe にだけマニフェストを埋め込んで避ける(本体 exe は tauri-build が埋め込み済み)。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        // mt.exe は verbatim 接頭辞(\\?\)付きのパスを読めないので外す
        let dir = dir.trim_start_matches(r"\\?\");
        println!("cargo:rerun-if-changed=test.manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{dir}\\test.manifest");
    }
}
