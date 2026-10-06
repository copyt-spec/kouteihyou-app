import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import { FILTER_FIELD_DEFS } from "../lib/filters";

// フリーワード検索＋どの項目でも条件を追加できるAND条件フィルタ。両画面で共有（設計ドキュメント 3-0 GanttFilterBar参照）
export function FilterBar() {
  const { jobs, lines, resources, view, updateView, filterSearch, setFilterSearch } = useGantt();
  const [draftField, setDraftField] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const ctx = { jobs, lines, resources };
  const conditions = view.filterConditions;
  const activeDef = FILTER_FIELD_DEFS.find((d) => d.key === draftField);

  function addCondition() {
    if (!draftField || draftValue === "") return;
    const def = FILTER_FIELD_DEFS.find((d) => d.key === draftField);
    if (!def) return;
    const displayValue = def.kind === "select" ? def.options?.(ctx).find((o) => o.value === draftValue)?.label ?? draftValue : draftValue;
    updateView({ filterConditions: conditions.filter((c) => c.field !== draftField).concat([{ field: draftField, value: draftValue, displayValue }]) });
    setDraftField("");
    setDraftValue("");
  }
  function removeCondition(field: string) {
    updateView({ filterConditions: conditions.filter((c) => c.field !== field) });
  }
  function clearAll() {
    setFilterSearch("");
    updateView({ filterConditions: [] });
    setDraftField("");
    setDraftValue("");
  }

  return (
    <div className="filterbar">
      <div className="ffield">
        <label>フリーワード</label>
        <input type="search" placeholder="オーダーNo・指図番号・得意先・工程名" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} />
      </div>

      {conditions.length > 0 && (
        <div className="fchips">
          {conditions.map((c) => {
            const def = FILTER_FIELD_DEFS.find((d) => d.key === c.field);
            const label = def ? def.label.replace("（前方一致）", "") : c.field;
            return (
              <span className="fchip" key={c.field}>
                {label}: {c.displayValue ?? c.value}
                <button className="fchipx" title="この条件を削除" onClick={() => removeCondition(c.field)}>
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="faddrow">
        <select
          value={draftField}
          onChange={(e) => {
            setDraftField(e.target.value);
            setDraftValue("");
          }}
        >
          <option value="">＋ 条件を追加…</option>
          {FILTER_FIELD_DEFS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        {!activeDef && <span className="lrhint">条件にする項目を選んでください</span>}
        {activeDef?.kind === "select" && (
          <select value={draftValue} onChange={(e) => setDraftValue(e.target.value)}>
            <option value="">選択…</option>
            {activeDef.options?.(ctx).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {activeDef?.kind === "prefix" && (
          <input type="text" placeholder="前方一致する文字列" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
        )}
        <button className="btn small" onClick={addCondition}>
          追加
        </button>
      </div>
      <button className="btn small ghost fclear" onClick={clearAll}>
        条件をすべてクリア
      </button>
    </div>
  );
}
