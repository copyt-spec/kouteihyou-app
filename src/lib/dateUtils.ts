// 日付・時刻ユーティリティ。プロトタイプ（FactorySlot 工程表 Artifact）の同名関数をそのまま移植。
export const WD = ["月", "火", "水", "木", "金", "土", "日"];

// 稼働日パターン（カレンダーマスタの簡易版。設計ドキュメント 7-2 の CalendarFixedPattern に相当）
// getDay(): 0=日
const FIXED_PATTERN: Record<number, boolean> = { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false };

export function toDate(s: string): Date {
  return new Date(String(s).replace(" ", "T"));
}
export function isWorkingDate(d: Date): boolean {
  return FIXED_PATTERN[d.getDay()];
}
export function fmtDate(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function fmtDT(s?: string | null): string {
  if (!s) return "—";
  const d = toDate(s);
  return fmtDate(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function dateOnly(s: string): Date {
  const d = toDate(s);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
// 工程調整（日程シフト）用：日付だけを動かし、時刻（HH:mm）は保持する
export function addDaysToISO(iso: string, deltaDays: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + deltaDays);
  return fmtDate(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
// ライン工程表（時間単位）でのドラッグ・矢印キー操作用：分単位でシフトする（2026-09-22追加）
export function addMinutesToISO(iso: string, deltaMinutes: number): string {
  const d = toDate(iso);
  d.setMinutes(d.getMinutes() + deltaMinutes);
  return fmtDate(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
