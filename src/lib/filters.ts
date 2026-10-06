import type { FactoryLine, ProcessJob, Resource } from "../types/processJob";

// ライン・資源マスタはボードごとに異なるため、一覧を組み立てる関数はjobsだけでなくlines/resourcesも受け取る（2026-09-22更新）
export interface FilterCtx {
  jobs: ProcessJob[];
  lines: FactoryLine[];
  resources: Resource[];
}

export function distinctCustomers(jobs: ProcessJob[]): string[] {
  return Array.from(new Set(jobs.map((j) => j.customer))).sort();
}
export function distinctProcessTypes(jobs: ProcessJob[]): string[] {
  return Array.from(new Set(jobs.map((j) => j.processType).filter(Boolean))).sort();
}

export const STATUS_OPTIONS: [string, string][] = [
  ["done", "完了"],
  ["active", "稼働中"],
  ["reserved", "確定予約"],
  ["delay", "遅延"],
  ["tentative", "仮押さえ"],
  ["unscheduled", "未指図"],
];

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterFieldDef {
  key: string;
  label: string;
  kind: "select" | "prefix";
  options?: (ctx: FilterCtx) => FilterOption[];
  test: (j: ProcessJob, v: string) => boolean;
}

// フィルタ条件ビルダーの項目カタログ（どの項目でフィルターするかを選べる。設計ドキュメント 3-0 GanttFilterBar参照）
export const FILTER_FIELD_DEFS: FilterFieldDef[] = [
  { key: "customer", label: "得意先", kind: "select", options: (ctx) => distinctCustomers(ctx.jobs).map((c) => ({ value: c, label: c })), test: (j, v) => j.customer === v },
  { key: "lineId", label: "ライン", kind: "select", options: (ctx) => ctx.lines.map((l) => ({ value: String(l.id), label: l.name })), test: (j, v) => String(j.factoryLineId) === v },
  { key: "resource", label: "資源", kind: "select", options: (ctx) => ctx.resources.map((r) => ({ value: r.id, label: r.name })), test: (j, v) => j.resource === v },
  { key: "processType", label: "工程名", kind: "select", options: (ctx) => distinctProcessTypes(ctx.jobs).map((p) => ({ value: p, label: p })), test: (j, v) => j.processType === v },
  { key: "status", label: "状態", kind: "select", options: () => STATUS_OPTIONS.map(([v, l]) => ({ value: v, label: l })), test: (j, v) => j.status === v },
  { key: "specialOrderNo1", label: "特注No.1（前方一致）", kind: "prefix", test: (j, v) => String(j.specialOrderNo1 || "").toLowerCase().startsWith(v.toLowerCase()) },
  { key: "specialOrderNo2", label: "特注No.2（前方一致）", kind: "prefix", test: (j, v) => String(j.specialOrderNo2 || "").toLowerCase().startsWith(v.toLowerCase()) },
  { key: "orderNo", label: "オーダーNo（前方一致）", kind: "prefix", test: (j, v) => String(j.orderNo || "").toLowerCase().startsWith(v.toLowerCase()) },
  { key: "orderNumber", label: "製造指図番号（前方一致）", kind: "prefix", test: (j, v) => String(j.orderNumber || "").toLowerCase().startsWith(v.toLowerCase()) },
];

export interface FilterCondition {
  field: string;
  value: string;
  displayValue: string;
}

export function passesFilter(j: ProcessJob, search: string, conditions: FilterCondition[]): boolean {
  if (search) {
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [j.orderNo, j.orderNumber, j.customer, j.processType, j.specialOrderNo1, j.specialOrderNo2].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  for (const c of conditions) {
    const def = FILTER_FIELD_DEFS.find((d) => d.key === c.field);
    if (def && !def.test(j, c.value)) return false;
  }
  return true;
}

// 負荷サマリ行のグルーピング基準カタログ（設計ドキュメント 3-2 GanttLoadSummary参照）
export interface LoadGroupBaseDef {
  key: "line" | "resource" | "processType" | "customer";
  label: string;
  items: (ctx: FilterCtx) => FilterOption[];
  test: (j: ProcessJob, v: string) => boolean;
}
export const LOAD_GROUP_BASES: LoadGroupBaseDef[] = [
  { key: "line", label: "ライン別", items: (ctx) => ctx.lines.map((l) => ({ value: String(l.id), label: l.name })), test: (j, v) => String(j.factoryLineId) === v },
  // valueは資源名（Resource.idではない）。ProcessJob.resourceは常に資源名で保持されているため、名前で揃えないと
  // testが一致しない（2026-09-22修正。CapacitySettings.tsxのunitItemsForと同じ理由）
  { key: "resource", label: "資源別", items: (ctx) => ctx.resources.map((r) => ({ value: r.name, label: r.name })), test: (j, v) => j.resource === v },
  { key: "processType", label: "工程別", items: (ctx) => distinctProcessTypes(ctx.jobs).map((p) => ({ value: p, label: p })), test: (j, v) => j.processType === v },
  { key: "customer", label: "得意先別", items: (ctx) => distinctCustomers(ctx.jobs).map((c) => ({ value: c, label: c })), test: (j, v) => j.customer === v },
];
