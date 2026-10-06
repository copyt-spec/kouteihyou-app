import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import type { OrderLabelFields } from "../state/types";

const ORDER_LABEL_FIELD_DEFS: [keyof OrderLabelFields, string][] = [
  ["customer", "得意先"],
  ["itemCode", "品目CD"],
  ["itemName", "品名"],
  ["specialOrderNo", "特注No"],
  ["dueDate", "納期"],
  ["plannedQuantity", "予定数量"],
  ["plannedManHours", "予定工数（合計）"],
  ["progress", "進捗（平均）"],
];

// オーダー行の左ラベルに何を出すかを選ぶ設定パネル（値の手入力ではなく表示項目の選択。設計ドキュメント 3-2参照）
export function LabelFieldsPanel() {
  const [open, setOpen] = useState(false);
  const { view, updateView } = useGantt();

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="segments">
          <button className={`segbtn ${open ? "active" : ""}`} onClick={() => setOpen((v) => !v)}>
            オーダー行に表示する項目 {open ? "▲" : "▼"}
          </button>
        </div>
      </div>
      {open && (
        <div className="labelfieldspanel">
          {ORDER_LABEL_FIELD_DEFS.map(([k, l]) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={view.orderLabelFields[k]}
                onChange={(e) => updateView({ orderLabelFields: { ...view.orderLabelFields, [k]: e.target.checked } })}
              />
              {l}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
