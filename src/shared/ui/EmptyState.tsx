/** 0件のときの空の状態。手書き風の矢印で、左下の「プロジェクトを追加」ボタンへ導く。 */
export function EmptyState() {
  return (
    <div className="empty">
      <svg className="empty-arrow" width="150" height="190" viewBox="0 0 150 190" fill="none" aria-hidden="true">
        <path d="M120 10 C 150 60, 90 90, 70 120 S 30 160, 22 176" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="1 7" />
        <path d="M22 176 L 24 152 M22 176 L 44 168" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="empty-text">
        <h2>まだプロジェクトがありません</h2>
        <p>
          左下の「プロジェクトを追加」から、フォルダを選んでみましょう。
          <br />
          言語は自動で見つけて、カードに並べます。
        </p>
      </div>
    </div>
  );
}
