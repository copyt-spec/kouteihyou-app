import { useGantt } from "../state/GanttContext";
import { fmtDate } from "../lib/dateUtils";
import { capKnownForRow, capacityHoursPerWorkingDay, totalCapacityHoursPerWorkingDay } from "../lib/capacity";
import { computeDayLoads, loadStateFor } from "../lib/loadCalc";
import { fmtHours } from "../lib/format";

// 日付列の直上に出す積み上げ工数・負荷率のサマリ行（設計ドキュメント 3-2 GanttLoadSummary参照）。
// 下のオーダー一覧に対するGanttFilterBarの絞り込みとは独立に、常にスケジュール済みの全ジョブから算出する。
// セルごとの計算自体はsrc/lib/loadCalc.tsのcomputeDayLoadsに抽出済み（2026-09-23、俯瞰ビュー新設に伴い
// 複数画面で使い回せるようにした。算出結果は従来と同一）
export function LoadSummaryRows({ cols, highlightedDateKeys }: { cols: Date[]; highlightedDateKeys?: Set<string> }) {
  const { jobs, lines, view, capacityConfig } = useGantt();
  const unit = view.hoursUnit;
  const showText = cols.length <= 45; // 表示期間が短いときだけセル内に数値・％を出す

  return (
    <>
      {view.loadRows.map((row) => {
        const capKnown = capKnownForRow(row);
        const dayLoads = computeDayLoads(jobs, lines, capacityConfig, row, cols);

        const capLabel = !capKnown
          ? "得意先は対象外"
          : row.basis
          ? `${fmtHours(capacityHoursPerWorkingDay(capacityConfig, row.basis as "line" | "resource" | "processType", row.value!), unit)}/日（持ち工数）`
          : `${fmtHours(totalCapacityHoursPerWorkingDay(capacityConfig, lines), unit)}/日（持ち工数合計）`;
        const capTitle = !capKnown
          ? "得意先には基準工数（持ち工数）の概念がないため、負荷率は算出せず積み上げ工数のみ表示します"
          : row.basis
          ? "稼働計画設定タブの①持ち工数（曜日別）から算出。休暇・応援等のイベント（②）がある日はその分だけ増減し、非稼働日は0になります"
          : "全ラインの持ち工数を合計した値。各ラインの休暇・応援等のイベントも反映します。非稼働日は0になります";

        return (
          <div className="loadrow" key={row.id}>
            <div className="loadrow-label">
              <span className="lname">{row.label}</span>
              <span className="loadrow-cap" title={capTitle}>
                {capLabel}
              </span>
            </div>
            <div className="loadrow-cells">
              {dayLoads.map((day) => {
                const state = loadStateFor(day);
                let cls = "loadcell";
                if (state !== "none") cls += " " + state;
                if (day.events.length) cls += " hasevent";
                if (highlightedDateKeys?.has(day.dateKey)) cls += " colselected";
                const hoursText = day.hours > 0 && showText ? fmtHours(day.hours, unit) : "";
                const rateText = day.hours > 0 && showText && day.rate != null ? day.rate + "%" : "";
                const eventText = day.events.length
                  ? "／" + day.events.map((ev) => `${ev.note} ${ev.hoursDelta > 0 ? "+" : ""}${fmtHours(ev.hoursDelta, unit)}`).join("、")
                  : "";
                const title =
                  `${fmtDate(day.date)}：積み上げ工数 ${fmtHours(day.hours, unit)}` +
                  (day.capacity != null
                    ? `／基準工数 ${fmtHours(day.capacity, unit)}／負荷率 ${day.rate}%`
                    : capKnown
                    ? "（非稼働日）"
                    : "（得意先には基準工数の概念がないため負荷率は算出しません）") +
                  eventText;
                return (
                  <div className={cls} style={{ flex: 1 }} title={title} key={day.dateKey}>
                    <span className="lc-hours">{hoursText}</span>
                    {rateText && <span className="lc-rate">{rateText}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
