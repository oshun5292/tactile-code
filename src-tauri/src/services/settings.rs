//! エディタ設定の範囲チェック(N9 契約)。保存や排他は Store 側の責務。
use crate::domain::EditorSettings;

pub const MIN_FONT_SIZE: u32 = 10;
pub const MAX_FONT_SIZE: u32 = 28;
pub const MIN_AUTO_SAVE_DELAY_MS: u32 = 200;
pub const MAX_AUTO_SAVE_DELAY_MS: u32 = 10_000;

/// 範囲外はエラーにせず端へ丸める(画面側の入力ゆれで保存を失敗させないため)。
pub fn clamp(s: EditorSettings) -> EditorSettings {
    EditorSettings {
        font_size: s.font_size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE),
        auto_save_delay_ms: s
            .auto_save_delay_ms
            .clamp(MIN_AUTO_SAVE_DELAY_MS, MAX_AUTO_SAVE_DELAY_MS),
        ..s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::AutoSaveMode;

    fn st(font: u32, delay: u32) -> EditorSettings {
        EditorSettings {
            font_size: font,
            word_wrap: false,
            auto_save: AutoSaveMode::Off,
            auto_save_delay_ms: delay,
        }
    }

    #[test]
    fn clamps_to_range() {
        assert_eq!(clamp(st(0, 0)), st(10, 200));
        assert_eq!(clamp(st(100, 99_999)), st(28, 10_000));
        assert_eq!(clamp(st(14, 1000)), st(14, 1000));
        assert_eq!(clamp(st(10, 200)), st(10, 200));
        assert_eq!(clamp(st(28, 10_000)), st(28, 10_000));
    }

    #[test]
    fn lenient_numbers_and_enum_validation() {
        // 小数は丸め、負数は 0 に寄ってから下限へ丸まる
        let s: EditorSettings = serde_json::from_str(
            r#"{"fontSize":13.6,"wordWrap":true,"autoSave":"onFocusChange","autoSaveDelayMs":-5}"#,
        )
        .unwrap();
        assert_eq!(s.font_size, 14);
        assert_eq!(clamp(s).auto_save_delay_ms, 200);
        assert_eq!(clamp(s).auto_save, AutoSaveMode::OnFocusChange);
        // 列挙以外の autoSave はエラー
        assert!(
            serde_json::from_str::<EditorSettings>(
                r#"{"fontSize":14,"wordWrap":false,"autoSave":"always","autoSaveDelayMs":1000}"#
            )
            .is_err()
        );
    }
}
