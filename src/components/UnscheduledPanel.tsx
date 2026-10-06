import { useGantt } from "../state/GanttContext";
import { isScheduled } from "../types/processJob";
import { passesFilter } from "../lib/filters";
import { fmtHours } from "../lib/format";

export function UnscheduledPanel() {
  const { jobs, view, filterSearch } = useGantt();
  const allUnscheduled = jobs.filter((j) => !isScheduled(j));
  const filtered = allUnscheduled.filter((j) => passesFilter(j, filterSearch, view.filterConditions));

  if (allUnscheduled.length === 0) return null;
  if (filtered.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2>未指図・未スケジュール（オーダー単位）</h2>
        </div>
        <div className="panel-note">条件に一致する未指図オーダーはありません</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>未指図・未スケジュール（オーダー単位）</h2>
        <span className="panel-note">指図番号が発行されるまではオーダーNoのまま扱います。指図後にライン・資源・日時が確定すると、下の工程表に反映されます</span>
      </div>
      {filtered.map((j) => (
        <div className="unschedrow" key={j.orderNo}>
          <div>
            <strong className="mono">{j.orderNo}</strong> <span className="rowbadge">未指図</span> {j.customer} {j.processType || ""}
            <div className="mono" style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>
              予定数量 {j.plannedQuantity || 0} ／ 予定工数 {fmtHours(j.plannedManHours || 0, view.hoursUnit)} ／ 納期 {j.dueDate || "—"}
            </div>
          </div>
          <span className="badge-pending">指図待ち</span>
        </div>
      ))}
    </div>
  );
}
