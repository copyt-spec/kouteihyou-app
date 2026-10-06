import type { FactoryLine, ProcessJob } from "../types/processJob";
import { orderKeyOf } from "../types/processJob";
import { fmtDate } from "./dateUtils";

// 持ち工数（実効持ち工数）。2026-09-22より「稼働計画設定」タブ（設計ドキュメント7章）でボードごとに
// 編集できるようにし、この基準値・イベントを積み上げ工数・負荷率の計算に実際に反映するようにした
// （以前はダミーの固定値だった）。稼働可否（非稼働日判定）は2026-09-24より、カレンダーマスタタブの
// 固定稼働曜日・例外日（isWorkingDayByCalendar）を実際に使うようにした（旧・固定の平日パターンのみを
// 見るdateUtils.isWorkingDateは、カレンダーマスタでの設定を持たない画面側の表示専用に限定。7-7参照）。

// "item"（品目別）は2026-09-23追加。得意先とは異なり品目にも基準工数の概念がありうる（例：品目ごとに
// まとめて外注枠を管理する等）という想定で、line/resource/processTypeと同列の単位として扱う
export type CapacityBasis = "line" | "resource" | "processType" | "item";
export type CapacityUnit = CapacityBasis;
export type CapacityDisplayUnit = "hour" | "minute";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAY_KEYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface DayHours {
  mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number;
  effectiveFrom: string;
}
export function defaultDayHours(weekdayHours = 8): DayHours {
  return { mon: weekdayHours, tue: weekdayHours, wed: weekdayHours, thu: weekdayHours, fri: weekdayHours, sat: 0, sun: 0, effectiveFrom: "2026-04-01" };
}

export interface CalendarException {
  id: string;
  date: string; // ISO date
  isWorkingDay: boolean;
  note: string;
  source: "manual" | "holiday_import";
}
export interface CalendarConfig {
  fixedPattern: Record<Weekday, boolean>;
  exceptions: CalendarException[];
  calendarMonth: string; // "YYYY-MM"（プレビュー表示用）
}

export interface CapacityEvent {
  id: string;
  type: "応援" | "休暇" | "その他";
  unit: CapacityUnit;
  dateFrom: string;
  dateTo: string;
  targetId: string | null; // nullは対象単位の全アイテム
  hoursDelta: number; // 応援は+、休暇は-
  note: string;
}

export interface PriorityRule {
  criterion: "dueDate" | "customerPriority" | "specialOrderFlag" | "orderNumber";
  direction: "asc" | "desc";
}
export interface ConstraintRule {
  type: "capacityLimit" | "processSequence" | "lineEligibility" | "manualLock";
  label: string;
  enabled: boolean;
}
export interface RulesConfig {
  eligibility: { col: "processType" | "factoryLineCode" | "resource" | "statusCode"; op: "equals" | "notEquals"; values: string[] };
  respectManualLock: boolean;
  priorityRules: PriorityRule[];
  constraints: ConstraintRule[];
}

// 得意先優先度マスタ（2026-09-24追加）。上（先頭）ほど優先度が高い＝自動調整で動かされにくい、という
// 順序リストとして持つ（customerPriority基準はこの並び順を参照する。priorityValueOf参照）。
// 一覧に無い得意先は最下位（最優先度低）として扱う

// 対象単位ごとの、曜日別基本工数（アイテムID→DayHours）。存在しないアイテムは規定値（平日8h・土日0h）扱い
export type BaselineTable = Record<string, DayHours>;

// ユーザーが①持ち工数・②イベント登録の対象選択に自分で追加した任意項目（2026-09-23追加）。
// マスタ設定・工程データ・連携設定から自動的に出てくる候補に無いもの（想定外の品目や、
// まだ工程データに現れていない対象など）を、単位を問わず登録できるようにするためのもの
export interface CustomCapacityItem {
  id: string;
  name: string;
}
export type CustomItemsTable = Record<CapacityUnit, CustomCapacityItem[]>;

export interface CapacityConfig {
  capacityUnit: CapacityUnit;
  capacityDisplayUnit: CapacityDisplayUnit;
  calendar: CalendarConfig;
  baselineByUnit: Record<CapacityUnit, BaselineTable>;
  customItemsByUnit: CustomItemsTable;
  events: CapacityEvent[];
  rules: RulesConfig;
  customerPriorityOrder: string[]; // 得意先優先度マスタ（2026-09-24追加）。先頭ほど優先度が高い
}

export function defaultCapacityConfig(): CapacityConfig {
  return {
    capacityUnit: "line",
    capacityDisplayUnit: "hour",
    calendar: {
      fixedPattern: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      exceptions: [],
      calendarMonth: "2026-10",
    },
    baselineByUnit: { line: {}, resource: {}, processType: {}, item: {} },
    customItemsByUnit: { line: [], resource: [], processType: [], item: [] },
    events: [],
    rules: {
      eligibility: { col: "processType", op: "notEquals", values: ["調整中"] },
      respectManualLock: true,
      priorityRules: [
        { criterion: "dueDate", direction: "asc" },
        { criterion: "customerPriority", direction: "desc" },
      ],
      constraints: [
        { type: "capacityLimit", label: "持ち工数の上限を超えない", enabled: true },
        { type: "processSequence", label: "前後工程の順序を守る（前工程を追い越さない）", enabled: true },
        { type: "lineEligibility", label: "品目⇔対応ラインマスタの範囲内でのみライン変更を許可", enabled: true },
        { type: "manualLock", label: "手動調整済みの工程は動かさない", enabled: true },
      ],
    },
    customerPriorityOrder: [],
  };
}

const DEFAULT_DAY_HOURS = defaultDayHours(8);

export function baselineFor(config: CapacityConfig, unit: CapacityUnit, itemId: string): DayHours {
  return config.baselineByUnit[unit]?.[itemId] ?? DEFAULT_DAY_HOURS;
}

function weekdayKey(day: Date): Weekday {
  return WEEKDAY_KEYS[(day.getDay() + 6) % 7];
}

// キャプション等での「基準は何h/日か」という単一の代表値表示用（月曜日の値を代表として使う。
// 曜日ごとの実際の値は下のhoursForDay/rowCapacityForDayが使う）
export function capacityHoursPerWorkingDay(config: CapacityConfig, basis: CapacityBasis, value: string | number): number {
  return baselineFor(config, basis, String(value)).mon ?? 8;
}
export function hoursForDay(config: CapacityConfig, basis: CapacityBasis, value: string | number, day: Date): number {
  return baselineFor(config, basis, String(value))[weekdayKey(day)] ?? 0;
}
export function totalCapacityHoursPerWorkingDay(config: CapacityConfig, lines: FactoryLine[]): number {
  return lines.reduce((sum, l) => sum + capacityHoursPerWorkingDay(config, "line", l.id), 0);
}

export function eventsForDay(config: CapacityConfig, basis: CapacityUnit, value: string | number, day: Date): CapacityEvent[] {
  const ds = fmtDate(day);
  return config.events.filter((ev) => ev.unit === basis && (ev.targetId == null || String(ev.targetId) === String(value)) && ds >= ev.dateFrom && ds <= ev.dateTo);
}
export function eventsHoursDelta(config: CapacityConfig, basis: CapacityUnit, value: string | number, day: Date): number {
  return eventsForDay(config, basis, value, day).reduce((s, ev) => s + ev.hoursDelta, 0);
}
export function effectiveCapacityForDay(config: CapacityConfig, basis: CapacityBasis, value: string | number, day: Date): number {
  const base = hoursForDay(config, basis, value, day);
  if (basis === "line" || basis === "resource") {
    return Math.max(0, base + eventsHoursDelta(config, basis, value, day));
  }
  return base; // processTypeにはイベントを適用しない（プロトタイプと同じ仕様）
}

export type LoadRowBasis = CapacityBasis | "customer";

// 負荷サマリ行（GanttLoadSummary）の1行分
export interface LoadRow {
  id: string;
  basis: LoadRowBasis | null; // null = 「全体」
  value: string | number | null;
  label: string;
}
// 得意先基準には基準工数の概念がない（積み上げ工数のみ表示。負荷率は算出しない）
export function capKnownForRow(row: LoadRow): boolean {
  return row.basis !== "customer";
}
// 行の基準工数（その日の分母）。非稼働日は0。呼び出し側は capKnownForRow(row) が false の間は呼ばない想定
export function rowCapacityForDay(config: CapacityConfig, row: LoadRow, day: Date, lines: FactoryLine[]): number {
  if (!capKnownForRow(row)) return 0;
  if (!isWorkingDateWithConfig(config, day)) return 0;
  if (!row.basis) return lines.reduce((sum, l) => sum + effectiveCapacityForDay(config, "line", l.id, day), 0);
  return effectiveCapacityForDay(config, row.basis as CapacityBasis, row.value!, day);
}
export function rowEventsForDay(config: CapacityConfig, row: LoadRow, day: Date, lines: FactoryLine[]): CapacityEvent[] {
  if (!capKnownForRow(row)) return [];
  if (!isWorkingDateWithConfig(config, day)) return [];
  if (row.basis === "line" || row.basis === "resource") return eventsForDay(config, row.basis, row.value!, day);
  if (!row.basis) return lines.reduce<CapacityEvent[]>((acc, l) => acc.concat(eventsForDay(config, "line", l.id, day)), []);
  return [];
}

/* ---------- カレンダー（固定稼働曜日＋例外日） ---------- */
export function isWorkingDayByCalendar(config: CapacityConfig, dateISO: string): boolean {
  const ex = config.calendar.exceptions.find((e) => e.date === dateISO);
  if (ex) return ex.isWorkingDay;
  const wd = WEEKDAY_KEYS[(new Date(dateISO + "T00:00:00").getDay() + 6) % 7];
  return !!config.calendar.fixedPattern[wd];
}
// isWorkingDayByCalendarのDate版（呼び出し側の多くがDateを扱うため）。2026-09-24追加：
// 持ち工数・負荷率計算、③自動調整の実行、ライン工程表・オーダー進捗表の非稼働日網掛けが、
// このボードのカレンダーマスタ設定（固定稼働曜日・例外日）を実際に見るようにした（旧・dateUtils.isWorkingDate
// の固定パターンのみを見る版は、カレンダー設定を持たない文脈でのみ引き続き使用）
export function isWorkingDateWithConfig(config: CapacityConfig, d: Date): boolean {
  return isWorkingDayByCalendar(config, fmtDate(d));
}

/* ---------- ③条件フロー：優先順位判定・対象単位判定（2026-09-24、autoAdjust.tsとCapacitySettings.tsxで共用） ---------- */
// 得意先優先度マスタでの順位（0=最優先）。一覧に無い得意先は最下位扱い
export function customerPriorityRank(config: CapacityConfig, customer: string): number {
  const idx = config.customerPriorityOrder.indexOf(customer);
  return idx === -1 ? config.customerPriorityOrder.length : idx;
}
export function priorityValueOf(job: ProcessJob, criterion: PriorityRule["criterion"], config: CapacityConfig): string {
  if (criterion === "dueDate") return job.dueDate || "9999-99-99";
  if (criterion === "orderNumber") return orderKeyOf(job);
  if (criterion === "customerPriority") return String(customerPriorityRank(config, job.customer)).padStart(6, "0");
  if (criterion === "specialOrderFlag") return job.specialOrderNo1 || job.specialOrderNo2 ? "0" : "1";
  return "";
}
// 優先順位ルール（上から順に評価、同点なら次の基準へ）での比較関数。負なら a を先（＝優先度が高い）に
export function comparePriority(a: ProcessJob, b: ProcessJob, rules: PriorityRule[], config: CapacityConfig): number {
  for (const p of rules) {
    const av = priorityValueOf(a, p.criterion, config);
    const bv = priorityValueOf(b, p.criterion, config);
    if (av < bv) return p.direction === "asc" ? -1 : 1;
    if (av > bv) return p.direction === "asc" ? 1 : -1;
  }
  return 0;
}

export function jobFieldForUnit(unit: CapacityUnit, job: ProcessJob): string | null {
  if (unit === "line") return job.factoryLineId == null ? null : String(job.factoryLineId);
  if (unit === "resource") return job.resource;
  if (unit === "item") return job.itemName || job.itemCode || null;
  return job.processType;
}
export function hoursBetween(a: string, b: string): number {
  const d = (new Date(b.replace(" ", "T")).getTime() - new Date(a.replace(" ", "T")).getTime()) / 3600000;
  return isFinite(d) && d > 0 ? d : 0;
}
export function eachDate(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let d = new Date(fromISO + "T00:00:00");
  const end = new Date(toISO + "T00:00:00");
  while (d <= end) {
    out.push(fmtDate(d));
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
