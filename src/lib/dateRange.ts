import { WD, startOfWeek } from "./dateUtils";
import type { LineViewId } from "../state/types";
import type { DateRange } from "./geometry";

export interface LineRange extends DateRange {
  kind: "day" | "week" | "month";
}

export function getLineRange(view: LineViewId, anchor: Date): LineRange {
  if (view === "day") {
    const s = new Date(anchor);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s, end: e, kind: "day" };
  }
  if (view === "week") {
    const s = startOfWeek(anchor);
    const e = new Date(s);
    e.setDate(e.getDate() + 7);
    return { start: s, end: e, kind: "week" };
  }
  const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const e = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { start: s, end: e, kind: "month" };
}

export function rangeColumns(range: LineRange): Date[] | null {
  if (range.kind === "day") return null; // 時間軸は別レンダリング
  const cols: Date[] = [];
  let d = new Date(range.start);
  while (d < range.end) {
    cols.push(new Date(d));
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return cols;
}

function fmtDateJP(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function rangeLabelText(range: LineRange): string {
  if (range.kind === "day") return fmtDateJP(range.start) + "（" + WD[(range.start.getDay() + 6) % 7] + "）";
  if (range.kind === "week") {
    const e = new Date(range.end);
    e.setDate(e.getDate() - 1);
    return fmtDateJP(range.start) + " 〜 " + fmtDateJP(e);
  }
  return range.start.getFullYear() + "年" + (range.start.getMonth() + 1) + "月";
}

export function shiftAnchorDate(anchor: Date, view: LineViewId, dir: number): Date {
  const a = new Date(anchor);
  if (view === "day") a.setDate(a.getDate() + dir);
  else if (view === "week") a.setDate(a.getDate() + 7 * dir);
  else a.setMonth(a.getMonth() + dir);
  return a;
}

// OrderScreen（日次単位）の表示期間オプション
export interface OrderSpanOption {
  key: string;
  label: string;
  weeks?: number;
  months?: number;
}
export const ORDER_SPAN_OPTIONS: OrderSpanOption[] = [
  { key: "2w", label: "2週間", weeks: 2 },
  { key: "4w", label: "4週間", weeks: 4 },
  { key: "2m", label: "2ヶ月", months: 2 },
  { key: "4m", label: "4ヶ月", months: 4 },
  { key: "6m", label: "6ヶ月", months: 6 },
  { key: "1y", label: "1年", months: 12 },
];
export function getOrderRange(orderSpanKey: string, orderAnchor: Date): DateRange {
  const opt = ORDER_SPAN_OPTIONS.find((o) => o.key === orderSpanKey) || ORDER_SPAN_OPTIONS[0];
  const start = startOfWeek(orderAnchor);
  const end = new Date(start);
  if (opt.months) end.setMonth(end.getMonth() + opt.months);
  else end.setDate(end.getDate() + (opt.weeks ?? 2) * 7);
  return { start, end };
}
