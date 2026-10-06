import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import { LOAD_GROUP_BASES } from "../lib/filters";
import { capKnownForRow, capacityHoursPerWorkingDay, totalCapacityHoursPerWorkingDay } from "../lib/capacity";
import { fmtHours } from "../lib/format";
import type { LoadRow, LoadRowBasis } from "../lib/capacity";

// 積み上げ工数・負荷率の表示設定パネル（表示行の追加・削除。設計ドキュメント 3-2 GanttLoadSummary参照）
export function LoadRowsPanel() {
  const [open, setOpen] = useState(false);
  const { jobs, lines, resources, view, updateView, capacityConfig } = useGantt();
  const [draftBasis, setDraftBasis] = useState<LoadRowBasis | "">("");
  const [draftValue, setDraftValue] = useState("");

  const ctx = { jobs, lines, resources };
  const basisDef = LOAD_GROUP_BASES.find((b) => b.key === draftBasis);

  function addRow() {
    if (!draftBasis || !draftValue) return;
    const def = LOAD_GROUP_BASES.find((b) => b.key === draftBasis);
    if (!def) return;
    const item = def.items(ctx).find((it) => it.value === draftValue);
    const id = draftBasis + ":" + draftValue;
    if (view.loadRows.some((r) => r.id === id)) return; // 同じ対象の重複追加を防ぐ
    const newRow: LoadRow = { id, basis: draftBasis, value: draftValue, label: def.label.replace("別", "") + "：" + (item ? item.label : draftValue) };
    updateView({ loadRows: [...view.loadRows, newRow] });
    setDraftBasis("");
    setDraftValue("");
  }
  function removeRow(id: string) {
    updateView({ loadRows: view.loadRows.filter((r) => r.id !== id) });
  }

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="segments">
          <button className={`segbtn ${open ? "active" : ""}`} onClick={() => setOpen((v) => !v)}>
            積み上げ工数・負荷率の表示設定 {open ? "▲" : "▼"}
          </button>
        </div>
      </div>
      {open && (
        <div className="loadrowspanel">
          <div className="loadrowspanel-note">
            基準工数（分母）は「稼働計画設定」タブの①持ち工数（曜日別）から自動算出します。得意先別の行には基準工数の概念がないため、積み上げ工数のみを表示します。
          </div>
          <div className="loadrowspanel-note">
            休暇・応援などのイベントで基準工数がその日だけ増減する仕様に対応しています（下表に反映中）。イベント自体の登録・編集は「稼働計画設定」タブの②イベント登録で行います。
            {capacityConfig.events.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {capacityConfig.events.map((ev) => {
                  const basisLabel = ev.unit === "line" ? "ライン" : ev.unit === "resource" ? "資源" : "工程";
                  const rangeLabel = ev.dateFrom === ev.dateTo ? ev.dateFrom : ev.dateFrom + "〜" + ev.dateTo;
                  return (
                    <li key={ev.id}>
                      {ev.type}／{basisLabel}
                      {ev.targetId ?? "全体"}／{rangeLabel}／{ev.note}（{ev.hoursDelta > 0 ? "+" : ""}
                      {fmtHours(ev.hoursDelta, view.hoursUnit)}）
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="loadrowslist">
            {view.loadRows.map((row) => {
              const removable = row.id !== "total";
              const capKnown = capKnownForRow(row);
              const capText = !capKnown
                ? "得意先は対象外（積み上げ工数のみ）"
                : row.basis
                ? `${fmtHours(capacityHoursPerWorkingDay(capacityConfig, row.basis as "line" | "resource" | "processType", row.value!), view.hoursUnit)}/日`
                : `${fmtHours(totalCapacityHoursPerWorkingDay(capacityConfig, lines), view.hoursUnit)}/日`;
              return (
                <div className="loadrowitem" key={row.id}>
                  <span className="lrlabel">{row.label}</span>
                  <span className="lrcap">
                    基準工数：{capText}
                    {capKnown && <span className="lrcapsrc">（持ち工数より自動算出）</span>}
                  </span>
                  {removable && (
                    <button className="lrremove" title="この行を削除" onClick={() => removeRow(row.id)}>
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="loadrowadd">
            <select
              value={draftBasis}
              onChange={(e) => {
                setDraftBasis(e.target.value as LoadRowBasis);
                setDraftValue("");
              }}
            >
              <option value="">＋ 表示行を追加（基準を選択）…</option>
              {LOAD_GROUP_BASES.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
            {basisDef ? (
              <select value={draftValue} onChange={(e) => setDraftValue(e.target.value)}>
                <option value="">対象を選択…</option>
                {basisDef.items(ctx).map((it) => (
                  <option key={it.value} value={it.value}>
                    {it.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="lrhint">まず基準を選んでください</span>
            )}
            <button className="btn small" onClick={addRow}>
              追加
            </button>
          </div>
        </div>
      )}
    </>
  );
}
