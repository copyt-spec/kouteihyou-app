import { type ProcessJob, isScheduled } from "../types/processJob";
import { toDate, dateOnly, dayDiff } from "./dateUtils";

export interface DateRange {
  start: Date;
  end: Date;
}

export function overlapsPrev(j: ProcessJob): boolean {
  return !!(j.prevProcessEnd && j.plannedStart && toDate(j.plannedStart) < toDate(j.prevProcessEnd));
}

export function pctOf(d: Date, range: DateRange): number {
  return ((d.getTime() - range.start.getTime()) / (range.end.getTime() - range.start.getTime())) * 100;
}

export interface BarGeom {
  leftPct: number;
  widthPct: number;
  clipL: boolean;
  clipR: boolean;
}

// LineScreen（時間単位）用のバー位置計算
export function barGeom(job: ProcessJob, range: DateRange): BarGeom {
  const s = toDate(job.plannedStart!);
  const e = toDate(job.plannedEnd!);
  let l = pctOf(s, range);
  let r = pctOf(e, range);
  const clipL = l < 0;
  const clipR = r > 100;
  l = Math.max(0, l);
  r = Math.min(100, r);
  const w = Math.max(r - l, 0.8);
  return { leftPct: l, widthPct: w, clipL, clipR };
}

// OrderScreen（日次単位）用のバー位置計算：時刻は見ず、日付の範囲だけで幅を決める
export function orderBarGeom(job: ProcessJob, range: DateRange): BarGeom {
  const totalDays = dayDiff(range.start, range.end);
  let lDay = dayDiff(range.start, dateOnly(job.plannedStart!));
  let rDay = dayDiff(range.start, dateOnly(job.plannedEnd!)) + 1;
  const clipL = lDay < 0;
  const clipR = rDay > totalDays;
  lDay = Math.max(0, lDay);
  rDay = Math.min(totalDays, rDay);
  const l = (lDay / totalDays) * 100;
  const r = (rDay / totalDays) * 100;
  const w = Math.max(r - l, (100 / totalDays) * 0.8);
  return { leftPct: l, widthPct: w, clipL, clipR };
}

// 1日あたりの負荷（工数）算出：複数日にまたがる工程は予定工数をまたがる日数で均等に割り付ける
export function jobDailyHours(j: ProcessJob): number {
  if (!isScheduled(j)) return 0;
  const spanDays = Math.max(1, dayDiff(dateOnly(j.plannedStart!), dateOnly(j.plannedEnd!)) + 1);
  return (Number(j.plannedManHours) || 0) / spanDays;
}
