import type { Board, OverviewCombo } from "../types/board";
import type { FactoryLine, ProcessJob, Resource } from "../types/processJob";
import { INITIAL_JOBS } from "../data/mockJobs";
import { DEFAULT_LINES, DEFAULT_RESOURCES } from "../data/factory";
import { type MappingConfig, defaultMappingConfig } from "./mapping";
import { type CapacityConfig, defaultCapacityConfig } from "./capacity";
import { type WritebackConfig, defaultWritebackConfig } from "./writeback";
import { type ManualAdjustmentLogEntry, MAX_ADJUSTMENT_LOG_ENTRIES } from "./adjustmentHistory";

// 工程表一覧（Board[]）と、ボードごとのジョブデータ・ライン/資源マスタをlocalStorageで管理する。
// 実データ接続後はProcessDataSource（設計ドキュメント1章）経由のAPI呼び出しに置き換える想定。
// ライン・資源マスタは2026-09-22よりボードごとに完全に独立させている（設計ドキュメント3-5参照）。

const BOARDS_KEY = "factoryslot_boards_v1";
const SEED_DONE_KEY = "factoryslot_boards_seeded_v1";

function jobsKey(boardId: string): string {
  return "factoryslot_gantt_jobs_v1:" + boardId;
}

function linesKey(boardId: string): string {
  return "factoryslot_gantt_lines_v1:" + boardId;
}

function resourcesKey(boardId: string): string {
  return "factoryslot_gantt_resources_v1:" + boardId;
}

export function viewKey(boardId: string): string {
  return "factoryslot_gantt_view_v1:" + boardId;
}

function mappingKey(boardId: string): string {
  return "factoryslot_mapping_config_v1:" + boardId;
}

function capacityConfigKey(boardId: string): string {
  return "factoryslot_capacity_config_v1:" + boardId;
}

// 書き戻し設定（mcframeへ反映するCSVの列構成・エンコーディング、2026-09-23追加）
function writebackConfigKey(boardId: string): string {
  return "factoryslot_writeback_config_v1:" + boardId;
}

// 手動調整履歴（パターン検知・提案用、2026-09-26追加。src/lib/adjustmentHistory.ts参照）
function adjustmentLogKey(boardId: string): string {
  return "factoryslot_adjustment_log_v1:" + boardId;
}

function newId(): string {
  return "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function readRaw<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorageが使えない環境では永続化のみ諦める */
  }
}

function readBoardsRaw(): Board[] {
  return readRaw<Board[]>(BOARDS_KEY, []);
}

function writeBoardsRaw(boards: Board[]): void {
  writeRaw(BOARDS_KEY, boards);
}

// 初回起動時のみ、既存のサンプルデータ（北条工場6ライン）を1件目のボードとして登録する。
// （このプロジェクトの初期プロトタイプで確認していた内容を消さないための救済措置）
function seedIfNeeded(): void {
  try {
    if (localStorage.getItem(SEED_DONE_KEY)) return;
  } catch {
    return;
  }
  const boards = readBoardsRaw();
  if (boards.length === 0) {
    const now = new Date().toISOString();
    const seed: Board = { id: newId(), name: "北条工場サンプル", createdAt: now, updatedAt: now };
    writeBoardsRaw([seed]);
    writeRaw(jobsKey(seed.id), INITIAL_JOBS);
    writeRaw(linesKey(seed.id), DEFAULT_LINES);
    writeRaw(resourcesKey(seed.id), DEFAULT_RESOURCES);
  }
  try {
    localStorage.setItem(SEED_DONE_KEY, "1");
  } catch {
    /* noop */
  }
}

export function listBoards(): Board[] {
  seedIfNeeded();
  return readBoardsRaw().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createBoard(name: string): Board {
  const boards = readBoardsRaw();
  const now = new Date().toISOString();
  const board: Board = { id: newId(), name: name.trim() || "新しい工程表", createdAt: now, updatedAt: now };
  writeBoardsRaw([...boards, board]);
  writeRaw(jobsKey(board.id), [] as ProcessJob[]);
  writeRaw(linesKey(board.id), [] as FactoryLine[]);
  writeRaw(resourcesKey(board.id), [] as Resource[]);
  return board;
}

export function renameBoard(id: string, name: string): void {
  const boards = readBoardsRaw();
  const next = boards.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name, updatedAt: new Date().toISOString() } : b));
  writeBoardsRaw(next);
}

export function touchBoard(id: string): void {
  const boards = readBoardsRaw();
  const next = boards.map((b) => (b.id === id ? { ...b, updatedAt: new Date().toISOString() } : b));
  writeBoardsRaw(next);
}

export function deleteBoard(id: string): void {
  const boards = readBoardsRaw().filter((b) => b.id !== id);
  writeBoardsRaw(boards);
  try {
    localStorage.removeItem(jobsKey(id));
    localStorage.removeItem(viewKey(id));
    localStorage.removeItem(linesKey(id));
    localStorage.removeItem(resourcesKey(id));
    localStorage.removeItem(mappingKey(id));
    localStorage.removeItem(capacityConfigKey(id));
    localStorage.removeItem(writebackConfigKey(id));
    localStorage.removeItem(adjustmentLogKey(id));
  } catch {
    /* noop */
  }
}

export function readBoardJobs(id: string): ProcessJob[] {
  return readRaw<ProcessJob[]>(jobsKey(id), []);
}

export function writeBoardJobs(id: string, jobs: ProcessJob[]): void {
  writeRaw(jobsKey(id), jobs);
}

// 2026-09-23より`FactoryLine.lineCode`（単一）を`lineCodes`（複数）に変更したため、
// それ以前に保存された旧形式のデータを読み込み時に変換する（保存し直すまでは旧キーのまま残るが、
// 読み込み側は常に`lineCodes`配列として扱えるようにする）
export function readBoardLines(id: string): FactoryLine[] {
  const raw = readRaw<Array<FactoryLine & { lineCode?: string }>>(linesKey(id), []);
  return raw.map((l) => {
    if (Array.isArray(l.lineCodes)) return l;
    const { lineCode, ...rest } = l;
    return { ...rest, lineCodes: lineCode ? [lineCode] : [] };
  });
}

export function writeBoardLines(id: string, lines: FactoryLine[]): void {
  writeRaw(linesKey(id), lines);
}

export function readBoardResources(id: string): Resource[] {
  return readRaw<Resource[]>(resourcesKey(id), []);
}

export function writeBoardResources(id: string, resources: Resource[]): void {
  writeRaw(resourcesKey(id), resources);
}

// 連携設定（列マッピング・行フィルタ・JOIN、設計ドキュメント2章）。ボードごとに独立させ、
// 「設定を保存」ボタンで明示的に保存する（FactorySlot 連携設定 Artifactと同じ操作感）
export function readBoardMapping(id: string): MappingConfig {
  return readRaw<MappingConfig>(mappingKey(id), defaultMappingConfig());
}

export function writeBoardMapping(id: string, config: MappingConfig): void {
  writeRaw(mappingKey(id), config);
}

// 稼働計画設定（カレンダー例外・持ち工数基準・イベント・条件フロールール、設計ドキュメント7章）。
// ライン・資源マスタと同様にボードごとに独立させ、GanttContext経由で他画面（積み上げ工数・負荷率）にも
// 即座に反映される（マスタ設定と同じく明示的な保存ボタンは持たない）
// 2026-09-23に「品目別」単位・カスタム項目（customItemsByUnit）を追加したため、それ以前に保存された
// CapacityConfigにはこれらのキーが存在しない。読み込み時に既定値とマージし、欠けているキーがあっても
// 実行時エラーにならないようにする
export function readBoardCapacityConfig(id: string): CapacityConfig {
  const def = defaultCapacityConfig();
  const raw = readRaw<Partial<CapacityConfig> | null>(capacityConfigKey(id), null);
  if (!raw) return def;
  return {
    ...def,
    ...raw,
    baselineByUnit: { ...def.baselineByUnit, ...(raw.baselineByUnit || {}) },
    customItemsByUnit: { ...def.customItemsByUnit, ...(raw.customItemsByUnit || {}) },
    calendar: { ...def.calendar, ...(raw.calendar || {}) },
    rules: { ...def.rules, ...(raw.rules || {}) },
  };
}

export function writeBoardCapacityConfig(id: string, config: CapacityConfig): void {
  writeRaw(capacityConfigKey(id), config);
}

// 書き戻し設定（2026-09-23追加）。列設定が空・未保存の初回はdefaultWritebackConfig()から始める
export function readBoardWriteback(id: string): WritebackConfig {
  const def = defaultWritebackConfig();
  const raw = readRaw<Partial<WritebackConfig> | null>(writebackConfigKey(id), null);
  if (!raw || !Array.isArray(raw.columns) || raw.columns.length === 0) return def;
  return { encoding: raw.encoding === "utf8" ? "utf8" : "sjis", columns: raw.columns };
}

export function writeBoardWriteback(id: string, config: WritebackConfig): void {
  writeRaw(writebackConfigKey(id), config);
}

// 手動調整履歴（2026-09-26追加）。パターン検知（detectAdjustmentPatterns）の入力になる。
// 無制限に増え続けないよう、追加のたびに直近MAX_ADJUSTMENT_LOG_ENTRIES件のみ残す
export function readBoardAdjustmentLog(id: string): ManualAdjustmentLogEntry[] {
  return readRaw<ManualAdjustmentLogEntry[]>(adjustmentLogKey(id), []);
}

export function appendBoardAdjustmentLog(id: string, entries: ManualAdjustmentLogEntry[]): void {
  if (entries.length === 0) return;
  const merged = [...readBoardAdjustmentLog(id), ...entries];
  const trimmed = merged.length > MAX_ADJUSTMENT_LOG_ENTRIES ? merged.slice(merged.length - MAX_ADJUSTMENT_LOG_ENTRIES) : merged;
  writeRaw(adjustmentLogKey(id), trimmed);
}

// 俯瞰ビューの「合体」表示（2026-09-23追加）。特定のボードに属さないため、ボード単位のキー
// （xxxKey(boardId)）ではなく単独のキーで管理する。ボード自体のデータは一切変更しない
const OVERVIEW_COMBOS_KEY = "factoryslot_overview_combos_v1";

export function listOverviewCombos(): OverviewCombo[] {
  return readRaw<OverviewCombo[]>(OVERVIEW_COMBOS_KEY, []);
}

export function writeOverviewCombos(combos: OverviewCombo[]): void {
  writeRaw(OVERVIEW_COMBOS_KEY, combos);
}
