//! 手書き・表示位置の検証と更新(段階2契約 §3)。
//! 保存や排他は Store 側の責務。ここは StoreFile を直接書き換える純粋な処理にして、単体でテストできるようにする。
use crate::domain::{BoardState, StoreFile, Stroke, Viewport};

pub const MAX_STROKES: usize = 2000;
pub const MAX_POINTS: usize = 5000;
pub const MIN_WIDTH: f64 = 1.0;
pub const MAX_WIDTH: f64 = 12.0;
pub const MIN_ZOOM: f64 = 0.2;
pub const MAX_ZOOM: f64 = 2.0;

pub fn board_state(data: &StoreFile) -> BoardState {
    BoardState {
        strokes: data.strokes.clone(),
        viewport: data.viewport,
    }
}

/// `#rrggbb`(英数の16進6桁)だけ許す。画面側でそのまま色として使うので、余計な文字を通さない。
fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn add_stroke(
    data: &mut StoreFile,
    color: &str,
    width: f64,
    points: Vec<[f64; 2]>,
) -> Result<Stroke, String> {
    if !is_hex_color(color) {
        return Err("色は #rrggbb の形で指定してください".to_string());
    }
    if !width.is_finite() || !(MIN_WIDTH..=MAX_WIDTH).contains(&width) {
        return Err("線の太さは1〜12にしてください".to_string());
    }
    if points.len() < 2 || points.len() > MAX_POINTS {
        return Err(format!("点の数は2〜{MAX_POINTS}にしてください"));
    }
    if points
        .iter()
        .any(|p| !p[0].is_finite() || !p[1].is_finite())
    {
        return Err("点の座標が不正です".to_string());
    }
    if data.strokes.len() >= MAX_STROKES {
        return Err(format!("手書きは{MAX_STROKES}本までです"));
    }
    let stroke = Stroke {
        id: uuid::Uuid::new_v4().to_string(),
        color: color.to_string(),
        width,
        points,
    };
    data.strokes.push(stroke.clone());
    Ok(stroke)
}

pub fn remove_stroke(data: &mut StoreFile, id: &str) -> Result<(), String> {
    let before = data.strokes.len();
    data.strokes.retain(|s| s.id != id);
    if data.strokes.len() == before {
        return Err("手書きが見つかりません".to_string());
    }
    Ok(())
}

pub fn save_viewport(data: &mut StoreFile, v: Viewport) -> Result<(), String> {
    if !v.x.is_finite() || !v.y.is_finite() || !v.zoom.is_finite() {
        return Err("表示位置が不正です".to_string());
    }
    // 範囲外は丸めずにエラー(画面側のバグに気づけるように)
    if !(MIN_ZOOM..=MAX_ZOOM).contains(&v.zoom) {
        return Err("ズームは0.2〜2にしてください".to_string());
    }
    data.viewport = Some(v);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Position, StoredProject};

    fn proj(id: &str) -> StoredProject {
        StoredProject {
            id: id.into(),
            path: format!("/p/{id}"),
            note: String::new(),
            description_override: None,
            position: Position { x: 0.0, y: 0.0 },
        }
    }

    fn data() -> StoreFile {
        StoreFile {
            projects: vec![proj("a"), proj("b"), proj("c")],
            ..Default::default()
        }
    }

    fn pts() -> Vec<[f64; 2]> {
        vec![[0.0, 0.0], [10.0, 4.0]]
    }

    fn vp(zoom: f64) -> Viewport {
        Viewport {
            x: 0.0,
            y: 0.0,
            zoom,
        }
    }

    #[test]
    fn add_stroke_validations() {
        let mut d = data();
        assert!(add_stroke(&mut d, "#34302b", 3.0, pts()).is_ok());
        assert!(add_stroke(&mut d, "#ABCDEF", 1.0, pts()).is_ok());
        assert!(add_stroke(&mut d, "#FFF", 3.0, pts()).is_err());
        assert!(add_stroke(&mut d, "34302b0", 3.0, pts()).is_err());
        assert!(add_stroke(&mut d, "#34302g", 3.0, pts()).is_err());
        assert!(add_stroke(&mut d, "#34302b", 0.5, pts()).is_err());
        assert!(add_stroke(&mut d, "#34302b", 12.5, pts()).is_err());
        assert!(add_stroke(&mut d, "#34302b", f64::NAN, pts()).is_err());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![[0.0, 0.0]]).is_err());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![]).is_err());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![[0.0, 0.0], [f64::NAN, 1.0]]).is_err());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![[0.0, f64::INFINITY]; 2]).is_err());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![[1.0, 1.0]; MAX_POINTS]).is_ok());
        assert!(add_stroke(&mut d, "#34302b", 3.0, vec![[1.0, 1.0]; MAX_POINTS + 1]).is_err());
        assert_eq!(d.strokes.len(), 3);
    }

    #[test]
    fn stroke_count_limit() {
        let mut d = data();
        for _ in 0..MAX_STROKES {
            add_stroke(&mut d, "#34302b", 3.0, pts()).unwrap();
        }
        assert!(add_stroke(&mut d, "#34302b", 3.0, pts()).is_err());
        assert_eq!(d.strokes.len(), MAX_STROKES);
    }

    #[test]
    fn remove_stroke_works() {
        let mut d = data();
        let s1 = add_stroke(&mut d, "#34302b", 3.0, pts()).unwrap();
        let s2 = add_stroke(&mut d, "#e2708a", 3.0, pts()).unwrap();
        assert!(remove_stroke(&mut d, "nope").is_err());
        remove_stroke(&mut d, &s1.id).unwrap();
        assert_eq!(d.strokes, vec![s2]);
    }

    #[test]
    fn viewport_validation() {
        let mut d = data();
        let v = Viewport {
            x: -12.5,
            y: 40.0,
            zoom: 0.8,
        };
        save_viewport(&mut d, v).unwrap();
        assert_eq!(board_state(&d).viewport, Some(v));
        for zoom in [0.19, 2.01, f64::NAN, f64::INFINITY] {
            assert!(save_viewport(&mut d, vp(zoom)).is_err());
        }
        let bad_x = Viewport {
            x: f64::NAN,
            y: 0.0,
            zoom: 1.0,
        };
        assert!(save_viewport(&mut d, bad_x).is_err());
        // 失敗では前の値が残る。境界値は通る
        assert_eq!(d.viewport, Some(v));
        save_viewport(&mut d, vp(0.2)).unwrap();
        save_viewport(&mut d, vp(2.0)).unwrap();
        assert_eq!(d.viewport.unwrap().zoom, 2.0);
    }
}
