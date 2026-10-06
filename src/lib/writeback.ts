import Encoding from "encoding-japanese";
import type { FactoryLine, ProcessJob, Resource } from "../types/processJob";

// 書き戻し（mcframeへの反映）用CSV出力。設計ドキュメント参照。
// mcframe側には工程データを書き込む手段（API・取込バッチ）が無く、画面からの手入力のみと確認済み。
// 既に運用中のRPAがmcframe画面への入力を担当しており、そのRPAが読み込む入力ファイルとしてCSVを出力する。
// RPA側が期待する列構成はボードや運用によって変わりうるため、列（項目・見出し・日付書式）は
// ボードごとに完全に設定（コンフィグ）で決められるようにする。エンコーディングもmcframe周辺の
// 一般的な慣習に合わせてShift-JISを選べるようにしておく（1-1のCSV取込側の想定と揃える）。

export type WritebackFieldKey =
  | "orderNo"
  | "orderNumber"
  | "processSeq"
  | "processType"
  | "factoryLineCode"
  | "resourceCode"
  | "customer"
  | "itemCode"
  | "itemName"
  | "specialOrderNo1"
  | "specialOrderNo2"
  | "plannedQuantity"
  | "actualQuantity"
  | "plannedManHours"
  | "plannedStart"
  | "plannedEnd"
  | "dueDate"
  | "status";

// 内部項目カタログ（出力側）。mapping.tsのCATALOG.process_data（取込側）と対になる項目名を使い、
// 見出しの初期値も揃えている。ラインCD・資源CDはProcessJob上ではfactoryLineId／resource（名称）で
// 持っているため、出力時にlines/resourcesを引いてコードへ変換する（resolveFieldValue参照）。
export const WRITEBACK_FIELD_CATALOG: [WritebackFieldKey, string][] = [
  ["orderNo", "オーダーNo"],
  ["orderNumber", "製造指図番号"],
  ["processSeq", "工程番号"],
  ["processType", "工程名"],
  ["factoryLineCode", "ラインCD"],
  ["resourceCode", "資源CD"],
  ["customer", "得意先名"],
  ["itemCode", "品目CD"],
  ["itemName", "品名"],
  ["specialOrderNo1", "特注No.1"],
  ["specialOrderNo2", "特注No.2"],
  ["plannedQuantity", "計画数量"],
  ["actualQuantity", "実績数量"],
  ["plannedManHours", "予定工数"],
  ["plannedStart", "計画開始日時"],
  ["plannedEnd", "計画終了日時"],
  ["dueDate", "納期"],
  ["status", "状態"],
];

export function writebackFieldLabel(field: WritebackFieldKey): string {
  return WRITEBACK_FIELD_CATALOG.find((c) => c[0] === field)?.[1] ?? field;
}

export type DateFormatId = "iso" | "ymd_slash" | "ymd_hms_slash" | "ymd_dot" | "ymd_hms_dot" | "ymd" | "hms";

export const DATE_FORMAT_OPTIONS: [DateFormatId, string][] = [
  ["iso", "そのまま（例：2026-10-06T13:00）"],
  ["ymd_slash", "YYYY/MM/DD（例：2026/10/06）"],
  ["ymd_hms_slash", "YYYY/MM/DD HH:mm（例：2026/10/06 13:00）"],
  ["ymd_dot", "YYYY.MM.DD（例：2026.10.06）"],
  ["ymd_hms_dot", "YYYY.MM.DD HH:mm（例：2026.10.06 13:00）"],
  ["ymd", "YYYYMMDD（例：20261006）"],
  ["hms", "HH:mm（例：13:00）"],
];

const DATE_FIELDS = new Set<WritebackFieldKey>(["plannedStart", "plannedEnd", "dueDate"]);
export function isDateField(field: WritebackFieldKey): boolean {
  return DATE_FIELDS.has(field);
}

export interface WritebackColumn {
  id: string;
  field: WritebackFieldKey;
  header: string;
  dateFormat?: DateFormatId; // 日付系項目のみ意味を持つ
}

export type WritebackEncoding = "utf8" | "sjis";

export interface WritebackConfig {
  columns: WritebackColumn[];
  encoding: WritebackEncoding;
}

let seq = 0;
function newColId(): string {
  seq += 1;
  return "wc_" + Date.now().toString(36) + "_" + seq;
}

// 既定の列構成：工程を一意に特定できる複合キー（製造指図番号＋工程番号）と、調整によって
// 変わりうる値（ライン・資源・計画開始/終了）のみに絞った最小構成。ボードごとに自由に追加・変更できる
export function defaultWritebackConfig(): WritebackConfig {
  return {
    encoding: "sjis",
    columns: [
      { id: newColId(), field: "orderNumber", header: "製造指図NO" },
      { id: newColId(), field: "processSeq", header: "工程NO" },
      { id: newColId(), field: "factoryLineCode", header: "ラインCD" },
      { id: newColId(), field: "resourceCode", header: "資源CD" },
      { id: newColId(), field: "plannedStart", header: "計画開始日時", dateFormat: "ymd_hms_slash" },
      { id: newColId(), field: "plannedEnd", header: "計画終了日時", dateFormat: "ymd_hms_slash" },
    ],
  };
}

export function newWritebackColumn(field: WritebackFieldKey = "orderNumber"): WritebackColumn {
  return { id: newColId(), field, header: writebackFieldLabel(field), dateFormat: isDateField(field) ? "ymd_hms_slash" : undefined };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// isoは"YYYY-MM-DDTHH:mm"（dueDateは"YYYY-MM-DD"のみのことがある）を想定
export function formatDateValue(iso: string, fmt: DateFormatId | undefined): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  switch (fmt) {
    case "ymd_slash":
      return `${y}/${mo}/${d}`;
    case "ymd_hms_slash":
      return h != null ? `${y}/${mo}/${d} ${h}:${mi}` : `${y}/${mo}/${d}`;
    case "ymd_dot":
      return `${y}.${mo}.${d}`;
    case "ymd_hms_dot":
      return h != null ? `${y}.${mo}.${d} ${h}:${mi}` : `${y}.${mo}.${d}`;
    case "ymd":
      return `${y}${mo}${d}`;
    case "hms":
      return h != null ? `${h}:${mi}` : "";
    case "iso":
    default:
      return iso;
  }
}

// factoryLineId→ラインCD、資源名→資源CDの変換。lineCodesは複数持ちうるため先頭を採用
// （旧CD・新CDが混在する場合の優先順位は今のところ未確定。必要になれば設定で選べるようにする）
export function resolveFieldValue(job: ProcessJob, field: WritebackFieldKey, lines: FactoryLine[], resources: Resource[], fmt?: DateFormatId): string {
  switch (field) {
    case "orderNo":
      return job.orderNo ?? "";
    case "orderNumber":
      return job.orderNumber ?? "";
    case "processSeq":
      return job.processSeq ?? "";
    case "processType":
      return job.processType ?? "";
    case "factoryLineCode": {
      const line = lines.find((l) => l.id === job.factoryLineId);
      return line?.lineCodes?.[0] ?? "";
    }
    case "resourceCode": {
      const res = resources.find((r) => r.name === job.resource);
      return res?.resourceCode ?? "";
    }
    case "customer":
      return job.customer ?? "";
    case "itemCode":
      return job.itemCode ?? "";
    case "itemName":
      return job.itemName ?? "";
    case "specialOrderNo1":
      return job.specialOrderNo1 ?? "";
    case "specialOrderNo2":
      return job.specialOrderNo2 ?? "";
    case "plannedQuantity":
      return job.plannedQuantity != null ? String(job.plannedQuantity) : "";
    case "actualQuantity":
      return job.actualQuantity != null ? String(job.actualQuantity) : "";
    case "plannedManHours":
      return job.plannedManHours != null ? String(job.plannedManHours) : "";
    case "plannedStart":
      return job.plannedStart ? formatDateValue(job.plannedStart, fmt) : "";
    case "plannedEnd":
      return job.plannedEnd ? formatDateValue(job.plannedEnd, fmt) : "";
    case "dueDate":
      return job.dueDate ? formatDateValue(job.dueDate, fmt) : "";
    case "status":
      return job.status ?? "";
    default:
      return "";
  }
}

// 書き戻し対象＝工程調整（手動ドラッグ・矢印キー・±1日/±1週ボタン）でpendingExportが立っている工程のみ
export function pendingWritebackJobs(jobs: ProcessJob[]): ProcessJob[] {
  return jobs.filter((j) => j.pendingExport);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function buildWritebackCsvText(jobs: ProcessJob[], config: WritebackConfig, lines: FactoryLine[], resources: Resource[]): string {
  const header = config.columns.map((c) => csvEscape(c.header)).join(",");
  const rows = jobs.map((j) => config.columns.map((c) => csvEscape(resolveFieldValue(j, c.field, lines, resources, c.dateFormat))).join(","));
  return [header, ...rows].join("\r\n") + "\r\n";
}

// CSVテキストを設定のエンコーディングに従ってBlobへ変換する（Shift-JIS変換にはencoding-japaneseを使用。
// ブラウザ標準のTextEncoderはUTF-8のみでShift-JISを出力できないため）
export function csvTextToBlob(text: string, encoding: WritebackEncoding): Blob {
  if (encoding === "utf8") {
    return new Blob([text], { type: "text/csv;charset=utf-8" });
  }
  const unicodeArray = Encoding.stringToCode(text);
  const sjisArray = Encoding.convert(unicodeArray, { to: "SJIS", from: "UNICODE" });
  return new Blob([new Uint8Array(sjisArray)], { type: "text/csv;charset=shift_jis" });
}

export function writebackFileName(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `writeback_${stamp}.csv`;
}
