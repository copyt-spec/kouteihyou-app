interface Props {
  onOpenBoards: () => void;
  onOpenSettings: () => void;
  onOpenOverview: () => void;
}

export function MainMenu({ onOpenBoards, onOpenSettings, onOpenOverview }: Props) {
  return (
    <div className="shell menushell">
      <div className="topbar">
        <div className="topbar-title">
          <span className="eyebrow">
            <span className="livedot" />FactorySlot
          </span>
          <h1>工程表</h1>
          <span className="topbar-sub">工場の工程表を管理します。一覧から工程表を開くか、新しく作成してください。</span>
        </div>
      </div>

      <div className="menugrid">
        <button className="menucard" onClick={onOpenBoards}>
          <span className="menucard-icon" aria-hidden="true">
            📋
          </span>
          <span className="menucard-title">工程表一覧</span>
          <span className="menucard-desc">既存の工程表を開く、または新しく作成します</span>
        </button>
        <button className="menucard" onClick={onOpenOverview}>
          <span className="menucard-icon" aria-hidden="true">
            📊
          </span>
          <span className="menucard-title">俯瞰ビュー</span>
          <span className="menucard-desc">全工程表の負荷率を横断してひと目で確認します</span>
        </button>
        <button className="menucard" onClick={onOpenSettings}>
          <span className="menucard-icon" aria-hidden="true">
            ⚙️
          </span>
          <span className="menucard-title">設定</span>
          <span className="menucard-desc">画面の配色など、アプリ全体の設定です</span>
        </button>
      </div>
    </div>
  );
}
