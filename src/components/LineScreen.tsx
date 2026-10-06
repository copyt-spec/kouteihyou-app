import { useGantt } from "../state/GanttContext";
import { TODAY } from "../data/factory";
import { getLineRange, rangeColumns, rangeLabelText, shiftAnchorDate } from "../lib/dateRange";
import { assignLanes } from "../lib/lanes";
import { barGeom, pctOf, overlapsPrev } from "../lib/geometry";
import { passesFilter } from "../lib/filters";
import { computeLineStats } from "../lib/stats";
import { fmtDate, fmtDT, dateOnly, WD } from "../lib/dateUtils";
import { isWorkingDateWithConfig } from "../lib/capacity";
import { jobKey, type ProcessJob } from "../types/processJob";
import { useGanttInteractions } from "./useGanttInteractions";
import { FilterBar } from "./FilterBar";
import { Legend } from "./Legend";
import { GanttJobBar } from "./GanttJobBar";
import { SelectionBar } from "./SelectionBar";
import { AutoAdjustPanel } from "./AutoAdjustPanel";

export function LineScreen({ onOpenAutoAdjustRules }: { onOpenAutoAdjustRules: () => void }) {
  const { jobs, boardProvider, lines, resources, capacityConfig, view, updateView, anchor, setAnchor, expandedLineRow, setExpandedLineRow, filterSearch } = useGantt();

  const range = getLineRange(view.view, anchor);
  const totalMs = Math.max(1, range.end.getTime() - range.start.getTime());

  const gi = useGanttInteractions({
    deltaFromPx: (deltaPx, containerSizePx) => {
      const deltaMs = (deltaPx / containerSizePx) * totalMs;
      return Math.round(deltaMs / 900000) * 15; // 15分刻みにスナップ（900000ms = 15分）
    },
    applyDelta: (targetKey, deltaUnits, scope) => boardProvider.applyMinuteShift(targetKey, jobKey, deltaUnits, scope),
    arrowStepUnits: 15, // ライン工程表は時間単位のため15分刻み
    axis: view.lineAxis === "v" ? "y" : "x", // 縦表示（2026-09-22追加）ではドラッグ・矢印キーとも縦方向で判定する
  });
  const groups = view.groupBy === "line" ? lines : resources;
  const rowLabelHeader = view.groupBy === "line" ? "ライン" : "資源";
  // 資源でのグルーピングはg.name（資源名）で一致させる。ProcessJob.resourceは常にg.id（Resource.id）ではなく
  // 資源名で保持されているため（2026-09-22修正。CapacitySettings.tsx/filters.tsと同じ理由）
  const jobsForGroup = (g: { id: number | string; name: string }) =>
    jobs.filter((j) => (view.groupBy === "line" ? j.factoryLineId === g.id : j.resource === g.name));
  const visible = (j: ProcessJob) =>
    !!j.plannedStart && !!j.plannedEnd && new Date(j.plannedEnd) > range.start && new Date(j.plannedStart) < range.end && passesFilter(j, filterSearch, view.filterConditions);

  const stats = computeLineStats(jobs, TODAY, lines.length);
  const overlapJobs = jobs.filter(overlapsPrev);
  const delayJobs = jobs.filter((j) => j.status === "delay");

  const cols = rangeColumns(range);
  // 選択中ジョブが含まれる日付列の集合（横表示の日付軸ハイライトに使用。時間軸表示＝本日ビューでは対象外）
  const selectedJobs = jobs.filter((j) => gi.selKeys.has(jobKey(j)));
  const highlightedDateKeys = new Set<string>();
  if (cols) {
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
  }
  const nowInRange = TODAY >= range.start && TODAY <= range.end;
  const nowPct = pctOf(TODAY, range);
  // 縦表示（2026-09-22追加）の時間軸トラックの高さ（px）。本日＝24hを40px/hで、週・今月＝日付1件あたり70pxで
  // 確保する。バーの高さは持続時間に比例するため、この値を大きくするほど各工程のバーに文字を収めやすくなる
  const vTrackPx = range.kind === "day" ? 960 : Math.max(420, (cols?.length ?? 7) * 70);

  return (
    <div className="screenbody">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="toolbar">
          <div className="segments">
            {(
              [
                ["line", "ライン別"],
                ["resource", "資源別"],
              ] as const
            ).map(([id, l]) => (
              <button
                key={id}
                className={`segbtn ${view.groupBy === id ? "active" : ""}`}
                onClick={() => {
                  setExpandedLineRow(null);
                  updateView({ groupBy: id });
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="segments">
            {(
              [
                ["day", "本日"],
                ["week", "今週"],
                ["month", "今月"],
              ] as const
            ).map(([id, l]) => (
              <button key={id} className={`segbtn ${view.view === id ? "active" : ""}`} onClick={() => updateView({ view: id })}>
                {l}
              </button>
            ))}
          </div>
          <div className="segments" title="工程の情報を多く表示したいときは縦表示が見やすいことがあります">
            {(
              [
                ["h", "横表示"],
                ["v", "縦表示"],
              ] as const
            ).map(([id, l]) => (
              <button key={id} className={`segbtn ${view.lineAxis === id ? "active" : ""}`} onClick={() => updateView({ lineAxis: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="datejump">
          <button className="btn icon" onClick={() => setAnchor(shiftAnchorDate(anchor, view.view, -1))}>
            ◀
          </button>
          <span className="rangeLabel mono">{rangeLabelText(range)}</span>
          <button className="btn icon" onClick={() => setAnchor(shiftAnchorDate(anchor, view.view, 1))}>
            ▶
          </button>
        </div>
        <button className="btn" onClick={() => setAnchor(new Date(TODAY))}>
          今日
        </button>
      </div>

      <FilterBar />
      <AutoAdjustPanel onOpenRules={onOpenAutoAdjustRules} />
      <SelectionBar arrowStepLabel="15分" />

      <div className="stats">
        <div className={`stat ${stats.utilizationPct >= 70 ? "good" : ""}`}>
          <div className="n">{stats.utilizationPct}%</div>
          <div className="l">全体稼働率（現在時刻時点）</div>
        </div>
        <div className="stat">
          <div className="n">
            {stats.activeLines} / {lines.length}
          </div>
          <div className="l">稼働中ライン数</div>
        </div>
        <div className={`stat ${stats.delayCount > 0 ? "bad" : "good"}`}>
          <div className="n">{stats.delayCount}</div>
          <div className="l">遅延アラート数</div>
        </div>
        <div className={`stat ${stats.overlapCount > 0 ? "warn" : "good"}`}>
          <div className="n">{stats.overlapCount}</div>
          <div className="l">前工程と重複している工程</div>
        </div>
      </div>

      {overlapJobs.length === 0 && delayJobs.length === 0 ? (
        <div className="alertstrip empty">現在、前後工程の重複や遅延アラートはありません</div>
      ) : (
        <div className="alertstrip">
          {overlapJobs.map((j) => (
            <div className="row" key={jobKey(j) + "-overlap"}>
              ⚠ <b>{j.orderNumber}-{j.processSeq}</b>（{j.customer} {j.processType}）が前工程の終了（{fmtDT(j.prevProcessEnd)}）より前の {fmtDT(j.plannedStart)} に開始予定です
            </div>
          ))}
          {delayJobs.map((j) => (
            <div className="row" key={jobKey(j) + "-delay"}>
              ⚠ <b>{j.orderNumber}-{j.processSeq}</b>（{j.customer} {j.processType}）が計画終了（{fmtDT(j.plannedEnd)}）を過ぎても未完了です
            </div>
          ))}
        </div>
      )}

      <Legend />

      {groups.length === 0 ? (
        <div className="panel panel-note">
          「{rowLabelHeader}」がまだ登録されていません。「マスタ設定」タブから追加してください。
        </div>
      ) : (
      view.lineAxis === "h" ? (
      <div className="ganttpanel" onClick={gi.clearSelection}>
        <div className="gridscroll">
          <div className="ganttgrid">
            {range.kind === "day" ? (
              <div className="axisrow">
                <div className="axis-rowlabel">{rowLabelHeader}</div>
                <div className="axis-hours">
                  {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
                    <div className="axis-hour" key={h}>
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="axisrow">
                <div className="axis-rowlabel">{rowLabelHeader}</div>
                <div className="axis-cols">
                  {cols!.map((d) => {
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
            )}

            {groups.map((g) => {
              const allJobs = jobsForGroup(g);
              const rowJobs = allJobs.filter(visible);
              const isExpanded = expandedLineRow === String(g.id);
              const { laneOf, laneCount } = isExpanded
                ? assignLanes(rowJobs)
                : { laneOf: Object.fromEntries(rowJobs.map((j) => [jobKey(j), 0])), laneCount: 1 };
              const laneH = 46;
              const rowH = Math.max(56, laneCount * laneH + 10);

              const colW = cols ? 100 / cols.length : 0;
              const rowNowInRange = range.kind === "day" ? fmtDate(TODAY) === fmtDate(range.start) : nowInRange;
              const rowNowPct = range.kind === "day" ? pctOf(TODAY, range) : nowPct;
              const isRowSelected = rowJobs.some((j) => gi.selKeys.has(jobKey(j)));

              return (
                <div className={`bodyrow ${isExpanded ? "expanded" : ""} ${isRowSelected ? "rowselected" : ""}`} key={g.id}>
                  <div
                    className="row-label rowtoggle"
                    title={`クリックで${isExpanded ? "折りたたみ" : "重なりを展開"}`}
                    onClick={() => setExpandedLineRow(isExpanded ? null : String(g.id))}
                  >
                    <span className="chevron">{isExpanded ? "▼" : "▶"}</span>
                    <span className="name">{g.name}</span>
                    <span className="sub">{rowJobs.length}件</span>
                  </div>
                  <div className={`row-track gantt-track ${range.kind === "day" ? "hourgrid" : ""}`} style={{ height: rowH }}>
                    {cols &&
                      cols.map((d, i) =>
                        !isWorkingDateWithConfig(capacityConfig, d) ? <div className="weekend-bg" key={i} style={{ left: i * colW + "%", width: colW + "%" }} /> : null
                      )}
                    {rowJobs.map((j) => {
                      const geom = barGeom(j, range);
                      const jk = jobKey(j);
                      const lane = laneOf[jk];
                      const top = 5 + lane * laneH;
                      return (
                        <GanttJobBar
                          key={jk}
                          job={j}
                          geom={geom}
                          top={top}
                          height={laneH - 8}
                          label={`${j.customer} ${j.processType}`}
                          warn={overlapsPrev(j)}
                          selected={gi.selKeys.has(jk)}
                          dragOffsetPx={gi.dragPreview?.keys.has(jk) ? gi.dragPreview.deltaPx : undefined}
                          onPointerDown={(e) => gi.handleBarPointerDown(e, j)}
                          onPointerMove={gi.handleBarPointerMove}
                          onPointerUp={(e) => gi.handleBarPointerUp(e, j)}
                        />
                      );
                    })}
                    {rowNowInRange && <div className="nowline" style={{ left: rowNowPct + "%" }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      ) : (
      <div className="ganttpanel" onClick={gi.clearSelection}>
        <div className="gridscroll">
          <div className="ganttgrid-v">
            <div className="axiscol-v">
              <div className="axis-collabel">{rowLabelHeader}</div>
              <div className={`axis-vticks ${range.kind === "day" ? "hourgrid-v" : ""}`} style={{ height: vTrackPx }}>
                {range.kind === "day"
                  ? [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
                      <div className="axis-vtick" key={h}>
                        {String(h).padStart(2, "0")}:00
                      </div>
                    ))
                  : cols!.map((d) => {
                      const wknd = !isWorkingDateWithConfig(capacityConfig, d);
                      const isToday = fmtDate(d) === fmtDate(TODAY);
                      return (
                        <div className={`axis-vtick ${wknd ? "weekend" : ""} ${isToday ? "today" : ""}`} key={fmtDate(d)}>
                          <span className="wd">{WD[(d.getDay() + 6) % 7]}</span>
                          <span className="d">
                            {d.getMonth() + 1}/{d.getDate()}
                          </span>
                        </div>
                      );
                    })}
              </div>
            </div>

            {groups.map((g) => {
              const allJobs = jobsForGroup(g);
              const rowJobs = allJobs.filter(visible);
              const isExpanded = expandedLineRow === String(g.id);
              const { laneOf, laneCount } = isExpanded
                ? assignLanes(rowJobs)
                : { laneOf: Object.fromEntries(rowJobs.map((j) => [jobKey(j), 0])), laneCount: 1 };
              const laneW = 150;
              const colW_ = Math.max(160, laneCount * laneW + 10);

              const rowH = cols ? 100 / cols.length : 0;
              const rowNowInRange = range.kind === "day" ? fmtDate(TODAY) === fmtDate(range.start) : nowInRange;
              const rowNowPct = range.kind === "day" ? pctOf(TODAY, range) : nowPct;

              return (
                <div className="bodycol" key={g.id} style={{ width: colW_ }}>
                  <div
                    className="col-label coltoggle"
                    title={`クリックで${isExpanded ? "折りたたみ" : "重なりを展開"}`}
                    onClick={() => setExpandedLineRow(isExpanded ? null : String(g.id))}
                  >
                    <span className="name">{g.name}</span>
                    <span className="sub">
                      {rowJobs.length}件 <span className="chevron">{isExpanded ? "▲" : "▼"}</span>
                    </span>
                  </div>
                  <div className={`col-track gantt-track ${range.kind === "day" ? "hourgrid-v" : ""}`} style={{ height: vTrackPx }}>
                    {cols &&
                      cols.map((d, i) =>
                        !isWorkingDateWithConfig(capacityConfig, d) ? <div className="weekend-bg-v" key={i} style={{ top: i * rowH + "%", height: rowH + "%" }} /> : null
                      )}
                    {rowJobs.map((j) => {
                      const geom = barGeom(j, range);
                      const jk = jobKey(j);
                      const lane = laneOf[jk];
                      const left = 5 + lane * laneW;
                      return (
                        <GanttJobBar
                          key={jk}
                          job={j}
                          geom={geom}
                          top={left}
                          height={laneW - 8}
                          orientation="v"
                          label={`${j.customer} ${j.processType}`}
                          extraLines={[j.itemName ?? ""]}
                          warn={overlapsPrev(j)}
                          selected={gi.selKeys.has(jk)}
                          dragOffsetPx={gi.dragPreview?.keys.has(jk) ? gi.dragPreview.deltaPx : undefined}
                          onPointerDown={(e) => gi.handleBarPointerDown(e, j)}
                          onPointerMove={gi.handleBarPointerMove}
                          onPointerUp={(e) => gi.handleBarPointerUp(e, j)}
                        />
                      );
                    })}
                    {rowNowInRange && <div className="nowline-v" style={{ top: rowNowPct + "%" }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )
      )}
    </div>
  );
}
