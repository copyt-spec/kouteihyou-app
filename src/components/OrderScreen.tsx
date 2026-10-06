import type { ReactNode } from "react";
import { useGantt } from "../state/GanttContext";
import { TODAY } from "../data/factory";
import { ORDER_SPAN_OPTIONS, getOrderRange } from "../lib/dateRange";
import { assignLanesByDay } from "../lib/lanes";
import { orderBarGeom, pctOf, overlapsPrev } from "../lib/geometry";
import { passesFilter } from "../lib/filters";
import { fmtDate, dateOnly, dayDiff, WD } from "../lib/dateUtils";
import { isWorkingDateWithConfig } from "../lib/capacity";
import { jobKey, orderKeyOf, isScheduled, type ProcessJob } from "../types/processJob";
import { orderGroups } from "../lib/orderGroups";
import { fmtHours } from "../lib/format";
import { useGanttInteractions } from "./useGanttInteractions";
import { FilterBar } from "./FilterBar";
import { Legend } from "./Legend";
import { GanttJobBar } from "./GanttJobBar";
import { LoadSummaryRows } from "./LoadSummaryRows";
import { UnscheduledPanel } from "./UnscheduledPanel";
import { SelectionBar } from "./SelectionBar";
import { AutoAdjustPanel } from "./AutoAdjustPanel";

export function OrderScreen({ onOpenAutoAdjustRules }: { onOpenAutoAdjustRules: () => void }) {
  const { jobs, boardProvider, lines, capacityConfig, view, updateView, orderAnchor, setOrderAnchor, expandedOrder, setExpandedOrder, filterSearch } = useGantt();

  const range = getOrderRange(view.orderSpanKey, orderAnchor);
  const cols: Date[] = [];
  {
    let d = new Date(range.start);
    while (d < range.end) {
      cols.push(new Date(d));
      d = new Date(d);
      d.setDate(d.getDate() + 1);
    }
  }
  const colW = 100 / cols.length;
  const totalDays = Math.max(1, dayDiff(range.start, range.end));

  const gi = useGanttInteractions({
    deltaFromPx: (deltaPx, containerWidthPx) => Math.round((deltaPx / containerWidthPx) * totalDays),
    applyDelta: (targetKey, deltaUnits, scope) => boardProvider.applyShift(targetKey, jobKey, deltaUnits, scope),
    arrowStepUnits: 1, // オーダー進捗表は1日刻み
  });

  // 選択中ジョブが含まれる日付列の集合（エクセルの行・列ハイライトに相当、負荷サマリ行・軸行の列ハイライトに使用）
  const selectedJobs = jobs.filter((j) => gi.selKeys.has(jobKey(j)));
  const highlightedDateKeys = new Set<string>();
  selectedJobs.forEach((j) => {
    if (!j.plannedStart || !j.plannedEnd) return;
    let d = dateOnly(j.plannedStart);
    const end = dateOnly(j.plannedEnd);
    while (d <= end) {
      highlightedDateKeys.add(fmtDate(d));
      d = new Date(d);
      d.setDate(d.getDate() + 1);
    }
  });

  const jobPasses = (j: ProcessJob) => passesFilter(j, filterSearch, view.filterConditions);
  const groups = orderGroups(jobs).filter((g) => jobs.some((j) => orderKeyOf(j) === g.id && isScheduled(j) && jobPasses(j)));

  const delayOrders = new Set(jobs.filter((j) => j.status === "delay").map(orderKeyOf));
  const riskOrders = new Set<string>();
  groups.forEach((g) => {
    const js = jobs.filter((j) => orderKeyOf(j) === g.id && isScheduled(j));
    const maxEnd = js.reduce((m, j) => Math.max(m, dateOnly(j.plannedEnd!).getTime()), 0);
    const due = js[0] && js[0].dueDate ? dateOnly(js[0].dueDate).getTime() : null;
    if (due && maxEnd > due) riskOrders.add(g.id);
  });
  const unscheduledOrders = new Set(jobs.filter((j) => !isScheduled(j) && jobPasses(j)).map((j) => j.orderNo));

  const alertRows: { key: string; node: ReactNode }[] = [];
  groups.forEach((g) => {
    if (delayOrders.has(g.id)) alertRows.push({ key: g.id + "-delay", node: <>⚠ <b>{g.name}</b>（{g.customer}）で遅延している工程があります</> });
    else if (riskOrders.has(g.id)) alertRows.push({ key: g.id + "-risk", node: <>⚠ <b>{g.name}</b>（{g.customer}）の計画完了日が納期を超える見込みです</> });
  });

  const nowInRange = TODAY >= range.start && TODAY <= range.end;
  const nowPct = pctOf(TODAY, range);
  const lf = view.orderLabelFields;
  const eLabel = new Date(range.end);
  eLabel.setDate(eLabel.getDate() - 1);

  return (
    <div className="screenbody">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="datejump">
          <button
            className="btn icon"
            onClick={() => {
              const a = new Date(orderAnchor);
              a.setDate(a.getDate() - 7);
              setOrderAnchor(a);
            }}
          >
            ◀
          </button>
          <span className="rangeLabel mono">
            {fmtDate(range.start)} 〜 {fmtDate(eLabel)}
          </span>
          <button
            className="btn icon"
            onClick={() => {
              const a = new Date(orderAnchor);
              a.setDate(a.getDate() + 7);
              setOrderAnchor(a);
            }}
          >
            ▶
          </button>
        </div>
        <div className="toolbar">
          <div className="segments">
            {ORDER_SPAN_OPTIONS.map((o) => (
              <button key={o.key} className={`segbtn ${view.orderSpanKey === o.key ? "active" : ""}`} onClick={() => updateView({ orderSpanKey: o.key })}>
                {o.label}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setOrderAnchor(new Date(TODAY))}>
            今日
          </button>
        </div>
      </div>

      <FilterBar />
      {/* オーダー行表示項目・積み上げ工数/負荷率設定は2026-09-23より設定画面（歯車アイコン）に移動（BoardSettings.tsx参照） */}
      <AutoAdjustPanel onOpenRules={onOpenAutoAdjustRules} />
      <SelectionBar arrowStepLabel="1日" />

      <div className="stats">
        <div className="stat">
          <div className="n">{groups.length}</div>
          <div className="l">スケジュール済オーダー数</div>
        </div>
        <div className={`stat ${unscheduledOrders.size > 0 ? "warn" : "good"}`}>
          <div className="n">{unscheduledOrders.size}</div>
          <div className="l">未指図オーダー数</div>
        </div>
        <div className={`stat ${delayOrders.size > 0 ? "bad" : "good"}`}>
          <div className="n">{delayOrders.size}</div>
          <div className="l">遅延中のオーダー</div>
        </div>
        <div className={`stat ${riskOrders.size > 0 ? "warn" : "good"}`}>
          <div className="n">{riskOrders.size}</div>
          <div className="l">納期超過リスクのあるオーダー</div>
        </div>
      </div>

      {alertRows.length === 0 ? (
        <div className="alertstrip empty">現在、遅延や納期超過リスクのあるオーダーはありません</div>
      ) : (
        <div className="alertstrip">
          {alertRows.map((r) => (
            <div className="row" key={r.key}>
              {r.node}
            </div>
          ))}
        </div>
      )}

      <UnscheduledPanel />
      <Legend withOrderExtras />

      <div className="ganttpanel" onClick={gi.clearSelection}>
        <div className="gridscroll">
          <div className="ganttgrid" style={{ minWidth: Math.max(720, cols.length * 30) }}>
            <div className="stickyhead">
              <LoadSummaryRows cols={cols} highlightedDateKeys={highlightedDateKeys} />

              <div className="axisrow">
                <div className="axis-rowlabel">オーダー</div>
                <div className="axis-cols">
                  {cols.map((d) => {
                    const wknd = !isWorkingDateWithConfig(capacityConfig, d);
                    const isToday = fmtDate(d) === fmtDate(TODAY);
                    const isColSelected = highlightedDateKeys.has(fmtDate(d));
                    return (
                      <div className={`axis-col ${wknd ? "weekend" : ""} ${isToday ? "today" : ""} ${isColSelected ? "colselected" : ""}`} key={fmtDate(d)}>
                        <span className="wd">{WD[(d.getDay() + 6) % 7]}</span>
                        <span className="d">
                          {d.getMonth() + 1}/{d.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {groups.length === 0 ? (
              <div className="bodyrow">
                <div className="row-label" style={{ width: "100%", borderRight: "none" }}>
                  <span className="sub">条件に一致するスケジュール済みのオーダーがありません</span>
                </div>
              </div>
            ) : (
              groups.map((g) => {
                const allJobs = jobs.filter((j) => orderKeyOf(j) === g.id && isScheduled(j) && jobPasses(j));
                const rowJobs = allJobs.filter((j) => dateOnly(j.plannedEnd!) >= range.start && dateOnly(j.plannedStart!) < range.end);
                const isExpanded = expandedOrder === g.id;
                const { laneOf, laneCount } = isExpanded
                  ? assignLanesByDay(rowJobs)
                  : { laneOf: Object.fromEntries(rowJobs.map((j) => [jobKey(j), 0])), laneCount: 1 };
                const laneH = 40;
                const rowH = Math.max(52, laneCount * laneH + 10);

                const subParts: string[] = [];
                if (lf.customer) subParts.push(g.customer);
                if (lf.itemCode && allJobs[0]?.itemCode) subParts.push("品目CD " + allJobs[0].itemCode);
                if (lf.itemName && allJobs[0]?.itemName) subParts.push(allJobs[0].itemName);
                if (lf.specialOrderNo) {
                  const nos = Array.from(new Set(allJobs.flatMap((j) => [j.specialOrderNo1, j.specialOrderNo2]).filter(Boolean))) as string[];
                  if (nos.length) subParts.push("特注No " + nos.join("／"));
                }
                if (lf.dueDate && allJobs[0]?.dueDate) subParts.push("納期 " + allJobs[0].dueDate);
                if (lf.plannedQuantity && allJobs[0]) subParts.push("予定数量 " + (allJobs[0].plannedQuantity || 0));
                if (lf.plannedManHours) {
                  const sumH = allJobs.reduce((s, j) => s + (Number(j.plannedManHours) || 0), 0);
                  subParts.push("予定工数 " + fmtHours(sumH, view.hoursUnit));
                }
                if (lf.progress && allJobs.length) {
                  const avgP = Math.round(allJobs.reduce((s, j) => s + (Number(j.progress) || 0), 0) / allJobs.length);
                  subParts.push("進捗 " + avgP + "%");
                }
                const subText = subParts.length ? subParts.join(" ／ ") : "表示項目が選択されていません";
                const isRowSelected = rowJobs.some((j) => gi.selKeys.has(jobKey(j)));

                return (
                  <div className={`bodyrow ${isExpanded ? "expanded" : ""} ${isRowSelected ? "rowselected" : ""}`} key={g.id}>
                    <div
                      className="row-label rowtoggle"
                      title={`クリックで${isExpanded ? "折りたたみ" : "工程内訳を表示"}`}
                      onClick={() => setExpandedOrder(isExpanded ? null : g.id)}
                    >
                      <span className="chevron">{isExpanded ? "▼" : "▶"}</span>
                      <span className="name">{g.name}</span>
                      <span className="sub">{subText}</span>
                    </div>
                    <div className="row-track gantt-track" style={{ height: rowH }}>
                      {cols.map((d, i) => (!isWorkingDateWithConfig(capacityConfig, d) ? <div className="weekend-bg" key={i} style={{ left: i * colW + "%", width: colW + "%" }} /> : null))}
                      {rowJobs.map((j) => {
                        const geom = orderBarGeom(j, range);
                        const lane = laneOf[jobKey(j)];
                        const top = 5 + lane * laneH;
                        const line = lines.find((l) => l.id === j.factoryLineId);
                        const jk = jobKey(j);
                        return (
                          <GanttJobBar
                            key={jk}
                            job={j}
                            geom={geom}
                            top={top}
                            height={laneH - 8}
                            label={`${line ? line.name : "—"} ${j.processType}`}
                            warn={overlapsPrev(j)}
                            selected={gi.selKeys.has(jk)}
                            dragOffsetPx={gi.dragPreview?.keys.has(jk) ? gi.dragPreview.deltaPx : undefined}
                            onPointerDown={(e) => gi.handleBarPointerDown(e, j)}
                            onPointerMove={gi.handleBarPointerMove}
                            onPointerUp={(e) => gi.handleBarPointerUp(e, j)}
                          />
                        );
                      })}
                      {nowInRange && <div className="nowline" style={{ left: nowPct + "%" }} />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
