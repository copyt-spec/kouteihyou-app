import { useGantt } from "../state/GanttContext";

// マスタ設定／連携設定／稼働計画設定は2026-09-23より設定画面（歯車アイコン、BoardView.tsx参照）に
// 移動したため、ここはライン工程表／オーダー進捗表の2タブのみ
export function ScreenNav() {
  const { view, updateView } = useGantt();
  return (
    <div className="segments">
      {(
        [
          ["line", "ライン工程表（時間単位）"],
          ["order", "オーダー進捗表（日次）"],
        ] as const
      ).map(([id, label]) => (
        <button key={id} className={`segbtn ${view.screen === id ? "active" : ""}`} onClick={() => updateView({ screen: id })}>
          {label}
        </button>
      ))}
    </div>
  );
}
