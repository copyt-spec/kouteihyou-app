import { useGantt } from "../state/GanttContext";

// 工数の表示単位切替（時間／分）。両画面・詳細シート・負荷サマリで共有する、アプリ全体で1つの設定（設計ドキュメント 3-3参照）
export function UnitToggle() {
  const { view, updateView } = useGantt();
  return (
    <div className="segments" title="予定工数・積み上げ工数・基準工数の表示単位">
      {(
        [
          ["h", "時間表示"],
          ["min", "分表示"],
        ] as const
      ).map(([id, label]) => (
        <button key={id} className={`segbtn ${view.hoursUnit === id ? "active" : ""}`} onClick={() => updateView({ hoursUnit: id })}>
          {label}
        </button>
      ))}
    </div>
  );
}
