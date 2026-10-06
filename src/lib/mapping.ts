// 連携設定（ファイルマッピング・結合／JOIN設定）。設計ドキュメント2章の内部モデルを、
// 「FactorySlot 連携設定」Artifactからそのまま移植したロジック。まだmcframeとのバックエンド連携は
// 未実装（1章参照）のため、ここではサンプルのmcframe出力を模したモックデータに対して
// マッピング・行フィルタ・JOINを試せる「設定＋プレビュー」画面として位置づけている。
// 設定はボード（工程表）ごとに独立して保存する（3-5・3-6と同じ方針）。

export type FileId = "process_data" | "master_customer" | "master_line" | "master_resource";

export interface FileMappingState {
  headerRow: number;
  mapping: Record<number, string | null>;
  keys: Record<number, boolean>;
  customFields: { value: string; label: string }[];
}

export type FilterOp = "equals" | "notEquals" | "in" | "notIn" | "contains";

export interface FilterRule {
  col: number;
  op: FilterOp;
  values: string[];
}

export interface FilterConfig {
  combinator: "AND" | "OR";
  rules: FilterRule[];
}

export interface JoinRule {
  id: string;
  baseKeyCol: number;
  targetFile: FileId;
  targetKeyCol: number;
  importCols: number[];
}

export interface MappingConfig {
  activeMode: "mapping" | "join" | "result";
  activeFile: FileId;
  files: Record<FileId, FileMappingState>;
  filters: Partial<Record<FileId, FilterConfig>>;
  joins: JoinRule[];
}

/* ---------- モックソースデータ（実際のmcframe CSV出力を想定した仮データ） ---------- */
// 列：オーダーNo/製造指図NO/工程NO/工程CD/工程名/ラインCD/資源CD/得意先CD/品目CD/品名/特注No1/特注No2/
// 計画数量/実績数量/予定工数/計画開始/計画終了/実績開始/実績終了/状態CD
export const RAW_PROCESS: string[][] = [
  ["北条工場 工程実績抽出", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["抽出条件：全ライン／本日〜7日", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["オーダーNo", "製造指図NO", "工程NO", "工程CD", "工程名", "ラインCD", "資源CD", "得意先CD", "品目CD", "品名", "特注No1", "特注No2", "計画数量", "実績数量", "予定工数", "計画開始日時", "計画終了日時", "実績開始日時", "実績終了日時", "状態CD"],
  ["OR-24081", "MO-24081", "10", "P10", "切削加工", "L1", "RS01", "C001", "P0091", "A部品", "", "", "2000", "2000", "3.8", "2026-09-22 07:00", "2026-09-22 11:00", "2026-09-22 07:02", "2026-09-22 10:55", "3"],
  ["OR-24081", "MO-24081", "20", "P20", "検査", "L1", "RT01", "C001", "P0091", "A部品", "", "", "2000", "2000", "0.5", "2026-09-22 11:00", "2026-09-22 11:30", "2026-09-22 11:01", "2026-09-22 11:28", "3"],
  ["OR-24102", "MO-24102", "10", "P10", "切削加工", "L1", "RS01", "C002", "P0114", "精密部品", "", "", "800", "540", "3.2", "2026-09-22 11:00", "2026-09-22 14:30", "2026-09-22 11:05", "", "2"],
  ["OR-24115", "MO-24115", "10", "P30", "プレス", "L1", "RS01", "C003", "P0077", "B部品", "", "", "1500", "0", "2.3", "2026-09-22 15:30", "2026-09-22 18:00", "", "", "1"],
  ["OR-24090", "MO-24090", "10", "P40", "研磨", "L2", "RS02", "C004", "P0132", "C部品", "", "", "3200", "3200", "2.9", "2026-09-22 07:00", "2026-09-22 10:00", "2026-09-22 07:00", "2026-09-22 09:52", "3"],
  ["OR-24121", "MO-24121", "10", "P50", "特注加工", "L2", "RS02", "C005", "P0201", "特注品", "SP-2201", "SP-2201-B", "120", "50", "5.0", "2026-09-22 10:30", "2026-09-22 16:00", "2026-09-22 10:31", "", "2"],
  ["OR-24098", "MO-24098", "10", "P30", "プレス", "L3", "RS03", "C006", "P0055", "D部品", "", "", "5000", "4250", "4.2", "2026-09-22 08:00", "2026-09-22 12:30", "2026-09-22 08:03", "", "2"],
  ["OR-24140", "MO-24140", "10", "P10", "切削加工", "L4", "RS04", "C007", "P0188", "E部品", "", "", "1800", "1800", "5.8", "2026-09-22 07:00", "2026-09-22 13:00", "2026-09-22 07:00", "2026-09-22 12:47", "3"],
  ["OR-24140", "MO-24140", "20", "P20", "検査", "L4", "RT02", "C007", "P0188", "E部品", "", "", "1800", "0", "0.6", "2026-09-22 13:00", "2026-09-22 13:45", "", "", "1"],
  ["OR-24151", "MO-24151", "10", "P60", "精密加工", "L4", "RS04", "C008", "P0212", "F部品", "", "", "600", "90", "3.0", "2026-09-22 13:30", "2026-09-22 17:00", "2026-09-22 13:33", "", "2"],
  ["OR-24162", "MO-24162", "10", "P40", "研磨", "L6", "RT01", "C009", "P0233", "G部品", "", "", "4000", "4000", "2.4", "2026-09-22 09:00", "2026-09-22 11:30", "2026-09-22 09:00", "2026-09-22 11:22", "3"],
  ["OR-24170", "MO-24170", "10", "P90", "調整中", "L6", "", "C010", "P0250", "(仮押さえ)", "", "", "0", "0", "0", "2026-09-22 13:00", "2026-09-22 17:30", "", "", "1"],
  ["OR-24055", "MO-24055", "10", "P10", "切削加工", "L1", "RS01", "C001", "P0091", "A部品", "", "", "1000", "1000", "3.8", "2026-09-20 07:00", "2026-09-20 11:00", "2026-09-20 07:00", "2026-09-20 10:40", "9"],
  ["OR-24055", "MO-24055", "20", "P20", "検査", "L1", "RT01", "C001", "P0091", "A部品", "", "", "1000", "0", "0.5", "2026-09-20 11:00", "2026-09-20 11:30", "", "", "1"],
  ["OR-24200", "", "", "", "", "", "", "C006", "P0301", "新規部品（見積中）", "", "", "1200", "0", "4.5", "", "", "", "", "0"],
];

export const RAW_RESOURCE: string[][] = [
  ["資源CD", "資源名"],
  ["RS01", "設備A"],
  ["RS02", "設備B"],
  ["RS03", "設備C"],
  ["RS04", "設備D"],
  ["RT01", "検査チーム1"],
  ["RT02", "検査チーム2"],
];

export const RAW_CUSTOMER: string[][] = [
  ["得意先CD", "得意先名", "得意先略称"],
  ["C001", "山田製作所", "山田"],
  ["C002", "田中工業", "田中"],
  ["C003", "鈴木製造", "鈴木"],
  ["C004", "岡田産業", "岡田"],
  ["C005", "中村工業", "中村"],
  ["C006", "加藤電機", "加藤"],
  ["C007", "松本製作", "松本"],
  ["C008", "伊藤機械", "伊藤"],
  ["C009", "渡辺金属", "渡辺"],
  // C010（木村産業）はマスタ側に未登録 → 未マッチ確認用
];

export const RAW_LINE: string[][] = [
  ["ライン対応マスタ（北条工場）", ""],
  ["ラインCD", "工場名"],
  ["L1", "北条工場1"],
  ["L2", "北条工場2"],
  ["L3", "北条工場3"],
  ["L4", "北条工場4"],
  ["L5", "北条工場5"],
  ["L6", "北条工場6"],
];

const SUBKEYS: [string, string][] = Array.from({ length: 8 }, (_, i) => [`subKey${i + 1}`, `サブキー${i + 1}`]);

export const CATALOG: Record<string, [string, string][]> = {
  process_data: [
    ["orderNo", "オーダーNo"], ["orderNumber", "製造指図番号"], ["processSeq", "工程番号"], ["processCode", "工程CD"], ["processType", "工程名"],
    ["factoryLineCode", "ラインCD"], ["resourceCode", "資源CD"], ["customerCode", "得意先CD"], ["itemCode", "品目CD"],
    ["itemName", "品名"], ["specialOrderNo1", "特注No.1"], ["specialOrderNo2", "特注No.2"],
    ["plannedQuantity", "計画数量"], ["actualQuantity", "実績数量"], ["plannedManHours", "予定工数"],
    ["plannedStart", "計画開始日時"], ["plannedEnd", "計画終了日時"], ["actualStart", "実績開始日時"],
    ["actualEnd", "実績終了日時"], ["statusCode", "状態CD"],
    ...SUBKEYS,
  ],
  master_customer: [["customerCode", "得意先CD"], ["customerName", "得意先名"], ["customerShort", "得意先略称"], ...SUBKEYS.slice(0, 4)],
  master_line: [["lineCode", "ラインCD"], ["factoryName", "工場名"], ...SUBKEYS.slice(0, 4)],
  master_resource: [["resourceCode", "資源CD"], ["resourceName", "資源名"], ...SUBKEYS.slice(0, 4)],
};

export const FILES_META: Record<FileId, { label: string; raw: string[][]; defaultHeader: number; catalog: string }> = {
  process_data: { label: "工程データ", raw: RAW_PROCESS, defaultHeader: 2, catalog: "process_data" },
  master_customer: { label: "得意先マスタ", raw: RAW_CUSTOMER, defaultHeader: 0, catalog: "master_customer" },
  master_line: { label: "ライン対応マスタ", raw: RAW_LINE, defaultHeader: 1, catalog: "master_line" },
  master_resource: { label: "資源マスタ", raw: RAW_RESOURCE, defaultHeader: 0, catalog: "master_resource" },
};
export const FILE_ORDER: FileId[] = ["process_data", "master_customer", "master_line", "master_resource"];

export function defaultMappingConfig(): MappingConfig {
  return {
    activeMode: "mapping",
    activeFile: "process_data",
    files: {
      process_data: {
        headerRow: 2,
        mapping: { 0: "orderNo", 1: "orderNumber", 2: "processSeq", 3: "processCode", 4: "processType", 5: "factoryLineCode", 6: "resourceCode", 7: "customerCode", 8: "itemCode", 9: "itemName", 10: "specialOrderNo1", 11: "specialOrderNo2", 12: "plannedQuantity", 13: "actualQuantity", 14: "plannedManHours", 15: "plannedStart", 16: "plannedEnd", 17: "actualStart", 18: "actualEnd", 19: "statusCode" },
        keys: { 5: true, 6: true, 7: true },
        customFields: [],
      },
      master_customer: { headerRow: 0, mapping: { 0: "customerCode", 1: "customerName", 2: "customerShort" }, keys: { 0: true }, customFields: [] },
      master_line: { headerRow: 1, mapping: { 0: "lineCode", 1: "factoryName" }, keys: { 0: true }, customFields: [] },
      master_resource: { headerRow: 0, mapping: { 0: "resourceCode", 1: "resourceName" }, keys: { 0: true }, customFields: [] },
    },
    filters: {
      process_data: { combinator: "AND", rules: [{ col: 19, op: "notIn", values: ["9"] }] },
    },
    joins: [
      { id: "j1", baseKeyCol: 7, targetFile: "master_customer", targetKeyCol: 0, importCols: [1] },
      { id: "j2", baseKeyCol: 5, targetFile: "master_line", targetKeyCol: 0, importCols: [1] },
      { id: "j3", baseKeyCol: 6, targetFile: "master_resource", targetKeyCol: 0, importCols: [1] },
    ],
  };
}

export function columnsOf(config: MappingConfig, fileId: FileId): string[] {
  const meta = FILES_META[fileId];
  const st = config.files[fileId];
  const row = meta.raw[st.headerRow] || [];
  return row.map((c, i) => (c && String(c).trim()) || "列" + (i + 1));
}
export function dataRowsOf(config: MappingConfig, fileId: FileId): string[][] {
  const meta = FILES_META[fileId];
  const st = config.files[fileId];
  return meta.raw.slice(st.headerRow + 1).filter((r) => r.some((c) => String(c || "").trim() !== ""));
}
export function catalogOf(fileId: FileId): [string, string][] {
  return CATALOG[FILES_META[fileId].catalog];
}
export function fieldLabel(fileId: FileId, key: string): string {
  const found = catalogOf(fileId).find((c) => c[0] === key);
  return found ? found[1] : key;
}

export function rowPasses(config: MappingConfig, fileId: FileId, rawRow: string[]): boolean {
  const f = config.filters[fileId];
  if (!f || !f.rules.length) return true;
  const results = f.rules.map((r) => {
    const v = String(rawRow[r.col] ?? "").trim();
    const vals = (r.values || []).map((x) => x.trim()).filter((x) => x !== "");
    switch (r.op) {
      case "equals": return vals.length === 0 || vals.includes(v);
      case "notEquals": return vals.length === 0 || !vals.includes(v);
      case "in": return vals.length === 0 || vals.includes(v);
      case "notIn": return vals.length === 0 || !vals.includes(v);
      case "contains": return vals.length === 0 || vals.some((x) => v.includes(x));
      default: return true;
    }
  });
  return f.combinator === "OR" ? results.some(Boolean) : results.every(Boolean);
}

function colIndexForField(config: MappingConfig, fileId: FileId, field: string): number {
  const mapping = config.files[fileId].mapping;
  const idx = Object.keys(mapping).find((k) => mapping[Number(k)] === field);
  return idx == null ? -1 : Number(idx);
}

// 同一製造指図番号内で工程NO順に並べ、直前・直後の工程の開始/終了情報を求める（前後工程の依存関係。2-7参照）
interface Adjacency {
  prevEnd: string | null;
  prevType: string | null;
  nextStart: string | null;
  nextType: string | null;
}
function buildAdjacencyMap(config: MappingConfig): Record<string, Adjacency> {
  const oCol = colIndexForField(config, "process_data", "orderNumber");
  const sCol = colIndexForField(config, "process_data", "processSeq");
  const psCol = colIndexForField(config, "process_data", "plannedStart");
  const peCol = colIndexForField(config, "process_data", "plannedEnd");
  const asCol = colIndexForField(config, "process_data", "actualStart");
  const aeCol = colIndexForField(config, "process_data", "actualEnd");
  const ptCol = colIndexForField(config, "process_data", "processType");
  const allRows = dataRowsOf(config, "process_data");
  const groups: Record<string, string[][]> = {};
  allRows.forEach((r) => {
    const ord = String(r[oCol] ?? "");
    (groups[ord] = groups[ord] || []).push(r);
  });
  const map: Record<string, Adjacency> = {};
  Object.values(groups).forEach((group) => {
    group.sort((a, b) => (Number(a[sCol]) || 0) - (Number(b[sCol]) || 0));
    group.forEach((r, i) => {
      const key = String(r[oCol]) + "|" + String(r[sCol]);
      const prev = group[i - 1], next = group[i + 1];
      map[key] = {
        prevEnd: prev ? prev[aeCol] || prev[peCol] || null : null,
        prevType: prev ? prev[ptCol] : null,
        nextStart: next ? next[asCol] || next[psCol] || null : null,
        nextType: next ? next[ptCol] : null,
      };
    });
  });
  return map;
}

export type MappedRecord = Record<string, string | number | null | undefined> & {
  __raw: string[];
  __unmatched: string[];
  __prevEnd: string | null;
  __prevType: string | null;
  __nextStart: string | null;
  __nextType: string | null;
  __overlapsPrev: boolean;
};

export interface MappingResult {
  totalRaw: number;
  afterFilter: number;
  joined: MappedRecord[];
  unmatchedCount: number;
}

export function computeMappingResult(config: MappingConfig): MappingResult {
  const cols = columnsOf(config, "process_data");
  const rows = dataRowsOf(config, "process_data");
  const mapping = config.files.process_data.mapping;
  const filtered = rows.filter((r) => rowPasses(config, "process_data", r));
  const oCol = colIndexForField(config, "process_data", "orderNumber");
  const sCol = colIndexForField(config, "process_data", "processSeq");
  const adjacency = buildAdjacencyMap(config);

  const joined: MappedRecord[] = filtered.map((raw) => {
    const rec = { __raw: raw, __unmatched: [] as string[] } as MappedRecord;
    cols.forEach((_h, i) => {
      if (mapping[i]) rec[mapping[i] as string] = raw[i];
    });
    const adj = adjacency[String(raw[oCol]) + "|" + String(raw[sCol])] || {};
    rec.__prevEnd = adj.prevEnd || null;
    rec.__prevType = adj.prevType || null;
    rec.__nextStart = adj.nextStart || null;
    rec.__nextType = adj.nextType || null;
    rec.__overlapsPrev = !!(
      rec.__prevEnd &&
      rec.plannedStart &&
      new Date(String(rec.plannedStart).replace(" ", "T")) < new Date(String(rec.__prevEnd).replace(" ", "T"))
    );
    config.joins.forEach((j) => {
      const tRows = dataRowsOf(config, j.targetFile);
      const tMapping = config.files[j.targetFile].mapping;
      const baseVal = String(raw[j.baseKeyCol] ?? "").trim();
      const match = tRows.find((tr) => String(tr[j.targetKeyCol] ?? "").trim() === baseVal);
      if (match) {
        j.importCols.forEach((ci) => {
          const field = tMapping[ci] || "col" + ci;
          rec["j_" + j.id + "_" + field] = match[ci];
        });
      } else {
        rec.__unmatched.push(j.id);
        j.importCols.forEach((ci) => {
          const field = tMapping[ci] || "col" + ci;
          rec["j_" + j.id + "_" + field] = null;
        });
      }
    });
    return rec;
  });

  return { totalRaw: rows.length, afterFilter: filtered.length, joined, unmatchedCount: joined.filter((r) => r.__unmatched.length > 0).length };
}

// 結合済みレコードから、指定した内部項目名（直接マッピングされた項目、または結合で取り込んだ項目のいずれか）の
// 値を重複除去して返す。稼働計画設定タブ（①持ち工数）の対象選択に、連携設定タブでのマッピング・結合結果を
// 反映するために使う（2026-09-22追加）。結合で取り込んだ項目は "j_<結合ID>_<項目名>" というキーで格納されて
// いるため、直接一致するキーが無ければそちらも探す。
export function uniqueFieldValues(result: MappingResult, fieldName: string): string[] {
  const set = new Set<string>();
  result.joined.forEach((rec) => {
    let val = rec[fieldName];
    if (val == null || val === "") {
      const joinKey = Object.keys(rec).find((k) => k.startsWith("j_") && k.endsWith("_" + fieldName));
      if (joinKey) val = rec[joinKey];
    }
    if (val != null && String(val).trim() !== "") set.add(String(val).trim());
  });
  return Array.from(set).sort();
}
