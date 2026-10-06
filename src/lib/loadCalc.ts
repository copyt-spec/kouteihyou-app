import type { FactoryLine, ProcessJob } from "../types/processJob";
import { isScheduled } from "../types/processJob";
import { dateOnly, fmtDate } from "./dateUtils";
import { jobDailyHours } from "./geometry";
import { LOAD_GROUP_BASES } from "./filters";
import {
  capKnownForRow,
  isWorkingDateWithConfig,
  type CapacityConfig,
  type CapacityEvent,
  type LoadRow,
  rowCapacityForDay,
  rowEventsForDay,
} from "./capacity";

// 日別の積み上げ工数・基準工数・負荷率の算出（2026-09-23、複数工程表の俯瞰ビュー新設に伴い
// LoadSummaryRows.tsxに書かれていたセルごとの計算をここへ抽出。同じロジックを俯瞰ビュー
// （OverviewScreen.tsx）でも使い回すため、jobs/lines/capacityConfigを直接受け取る純粋関数にしてある
// （useGantt()に依存しないので、GanttProviderの外＝複数ボード横断の画面からも呼べる）

export interface DayLoad {
  date: Date;
  dateKey: string; // fmtDate(date)
  working: boolean; // isWorkingDateWithConfig(capacityConfig, date)：カレンダーマスタの固定稼働曜日・例外日を反映
  hours: number; // その日の積み上げ工数
  capacity: number | null; // その日の基準工数（得意先行など、基準工数の概念が無い場合はnull）
  rate: number | null; // 負荷率(%)。capacityが0またはnullのときはnull
  events: CapacityEvent[];
}

export function computeDayLoads(jobs: ProcessJob[], lines: FactoryLine[], capacityConfig: CapacityConfig, row: LoadRow, days: Date[]): DayLoad[] {
  const basisDef = row.basis ? LOAD_GROUP_BASES.find((b) => b.key === row.basis) : null;
  const jobsForRow = jobs.filter((j) => isScheduled(j) && (!basisDef || basisDef.test(j, String(row.value))));
  const capKnown = capKnownForRow(row);

  return days.map((d) => {
    const hours = jobsForRow.reduce((sum, j) => {
      const s = dateOnly(j.plannedStart!);
      const e = dateOnly(j.plannedEnd!);
      return d >= s && d <= e ? sum + jobDailyHours(j) : sum;
    }, 0);
    const capacity = capKnown ? rowCapacityForDay(capacityConfig, row, d, lines) : null;
    const rate = capacity != null && capacity > 0 ? Math.round((hours / capacity) * 100) : null;
    const events = capKnown ? rowEventsForDay(capacityConfig, row, d, lines) : [];
    return { date: d, dateKey: fmtDate(d), working: isWorkingDateWithConfig(capacityConfig, d), hours, capacity, rate, events };
  });
}

// 負荷率に応じた状態区分（既存のGanttLoadSummaryと同じ閾値：80%未満=ok／80〜100%=warn／100%超=over）
export type LoadState = "none" | "ok" | "warn" | "over";
export function loadStateFor(day: DayLoad): LoadState {
  if (day.hours <= 0) return "none";
  if (day.rate == null) return "ok";
  if (day.rate > 100) return "over";
  if (day.rate >= 80) return "warn";
  return "ok";
}

/* ---------- 俯瞰ビュー（複数工程表の負荷率サマリー）向け：粒度切替・年度対応・合体行の集計 ----------
   2026-09-23新設。「横に日付軸一本で、日／月／年を切り替えられるように」という要望に対応するため、
   常に日単位でcomputeDayLoadsを計算した上で、表示粒度（日／月／年）に応じてバケット集計する方式にした。
   年度は日本の一般的な会計年度に合わせて4月始まり固定（要ユーザー確認の上で決定） */

export type OverviewGranularity = "day" | "month" | "year";
export type YearMode = "calendar" | "fiscal"; // 暦年（1月始まり）／ 年度（4月始まり固定）

const FISCAL_START_MONTH = 3; // 0-indexed。4月

export function fiscalYearOf(d: Date): number {
  return d.getMonth() >= FISCAL_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
}

export function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export interface AxisRange {
  start: Date;
  end: Date; // inclusive
}

// 年（年度）粒度のときに一度に表示する年数
export const YEAR_WINDOW_SIZE = 6;

// 粒度・年度設定・基準日から、実際に集計対象とする日付範囲を決める
export function axisRangeFor(granularity: OverviewGranularity, yearMode: YearMode, anchor: Date): AxisRange {
  if (granularity === "day") {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  }
  if (granularity === "month") {
    if (yearMode === "calendar") {
      const y = anchor.getFullYear();
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
    }
    const fy = fiscalYearOf(anchor);
    return { start: new Date(fy, FISCAL_START_MONTH, 1), end: new Date(fy + 1, FISCAL_START_MONTH - 1, 31) };
  }
  // year：anchorはウィンドウ開始年の代表日（calendarなら1/1、fiscalなら4/1）として渡される想定
  const startYear = anchor.getFullYear();
  if (yearMode === "calendar") {
    return { start: new Date(startYear, 0, 1), end: new Date(startYear + YEAR_WINDOW_SIZE - 1, 11, 31) };
  }
  return { start: new Date(startYear, FISCAL_START_MONTH, 1), end: new Date(startYear + YEAR_WINDOW_SIZE, FISCAL_START_MONTH - 1, 31) };
}

export interface PeriodLoad {
  key: string;
  label: string; // 列見出し（日=日番号／月=月番号／年=年 or 年度）
  yearHint?: string; // 暦年をまたぐ月列の先頭にだけ添える年の小ラベル（例："2027"）
  start: Date;
  hours: number;
  capacity: number;
  rate: number | null;
}

function periodKey(d: Date, granularity: OverviewGranularity, yearMode: YearMode): string {
  if (granularity === "day") return fmtDate(d);
  if (granularity === "month") return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  return yearMode === "fiscal" ? "FY" + fiscalYearOf(d) : "CY" + d.getFullYear();
}

// 日別のDayLoad[]を、表示粒度（日／月／年）ごとのPeriodLoad[]にまとめる。月・年粒度では
// 積み上げ工数・基準工数をその期間分すべて合算し、負荷率は合算後の値から算出し直す
// （日ごとの負荷率を単純平均するより、期間全体の実態に近いため）
export function bucketDayLoads(days: DayLoad[], granularity: OverviewGranularity, yearMode: YearMode): PeriodLoad[] {
  if (granularity === "day") {
    return days.map((d) => ({ key: d.dateKey, label: String(d.date.getDate()), start: d.date, hours: d.hours, capacity: d.capacity ?? 0, rate: d.rate }));
  }
  const order: string[] = [];
  const map = new Map<string, { start: Date; hours: number; capacity: number }>();
  for (const d of days) {
    const key = periodKey(d.date, granularity, yearMode);
    if (!map.has(key)) {
      map.set(key, { start: d.date, hours: 0, capacity: 0 });
      order.push(key);
    }
    const b = map.get(key)!;
    b.hours += d.hours;
    if (d.capacity != null) b.capacity += d.capacity;
  }
  let prevCalYear: number | null = null;
  return order.map((key) => {
    const b = map.get(key)!;
    const rate = b.capacity > 0 ? Math.round((b.hours / b.capacity) * 100) : null;
    let label: string;
    let yearHint: string | undefined;
    if (granularity === "month") {
      label = b.start.getMonth() + 1 + "月";
      const cy = b.start.getFullYear();
      if (prevCalYear != null && cy !== prevCalYear) yearHint = String(cy);
      prevCalYear = cy;
    } else {
      label = yearMode === "fiscal" ? fiscalYearOf(b.start) + "年度" : String(b.start.getFullYear());
    }
    return { key, label, yearHint, start: b.start, hours: b.hours, capacity: b.capacity, rate };
  });
}

export function periodStateFor(p: PeriodLoad): LoadState {
  if (p.hours <= 0) return "none";
  if (p.rate == null) return "ok";
  if (p.rate > 100) return "over";
  if (p.rate >= 80) return "warn";
  return "ok";
}

// 合体行用：同じ日付軸（同じdays配列）で計算された複数ボード分のDayLoad[]を、日ごとに合算する
export function sumDayLoads(seriesList: DayLoad[][]): DayLoad[] {
  if (seriesList.length === 0) return [];
  const len = seriesList[0].length;
  const out: DayLoad[] = [];
  for (let i = 0; i < len; i++) {
    let hours = 0;
    let capacity = 0;
    let capacityKnown = false;
    const events: CapacityEvent[] = [];
    for (const series of seriesList) {
      const d = series[i];
      hours += d.hours;
      if (d.capacity != null) {
        capacity += d.capacity;
        capacityKnown = true;
      }
      events.push(...d.events);
    }
    const base = seriesList[0][i];
    const rate = capacityKnown && capacity > 0 ? Math.round((hours / capacity) * 100) : null;
    out.push({ date: base.date, dateKey: base.dateKey, working: base.working, hours, capacity: capacityKnown ? capacity : null, rate, events });
  }
  return out;
}

// ある期間（複数日）を通じた集計。俯瞰ビューの月間見出し統計（稼働率・超過日数）に使う
export interface PeriodLoadSummary {
  totalHours: number;
  totalCapacity: number;
  utilizationRate: number | null; // 集計負荷率(%) = totalHours/totalCapacity。totalCapacityが0ならnull
  overDays: number; // rate > 100 の日数
}
export function summarizePeriod(days: DayLoad[]): PeriodLoadSummary {
  let totalHours = 0;
  let totalCapacity = 0;
  let overDays = 0;
  for (const d of days) {
    totalHours += d.hours;
    if (d.capacity != null) totalCapacity += d.capacity;
    if (d.rate != null && d.rate > 100) overDays++;
  }
  const utilizationRate = totalCapacity > 0 ? Math.round((totalHours / totalCapacity) * 100) : null;
  return { totalHours, totalCapacity, utilizationRate, overDays };
}
