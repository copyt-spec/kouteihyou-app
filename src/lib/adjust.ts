import { type ProcessJob, orderKeyOf, isScheduled } from "../types/processJob";
import { addDaysToISO, addMinutesToISO } from "./dateUtils";

// 工程調整（日程シフト）。設計ドキュメント 3-4参照。
// ボタンによる±1日／±1週シフトに加え、2026-09-22よりグリッド上でのドラッグ・矢印キー操作（3-4-1参照）にも
// 同じ仕組み（applyDelta）を使っている。
// 2026-09-23追加：ここを通る調整は必ず手動調整（自動工程調整とは別経路）なので、対象ジョブに
// manualLock（7-7の未確定事項だった「立てるタイミング」をここに決定）とpendingExport（mcframeへの
// 書き戻し待ち、書き戻し設定タブ参照）を同時に立てる。

// 同一オーダー内の工程を工程番号順に並べ直し、前工程終了／後工程開始の参照値を再計算する
export function recomputeAdjacency(jobs: ProcessJob[], orderKey: string): ProcessJob[] {
  const next = jobs.map((j) => ({ ...j }));
  const procs = next
    .filter((j) => orderKeyOf(j) === orderKey && isScheduled(j))
    .sort((a, b) => String(a.processSeq).localeCompare(String(b.processSeq), undefined, { numeric: true }));
  procs.forEach((j, i) => {
    if (i > 0) j.prevProcessEnd = procs[i - 1].plannedEnd!;
    else delete j.prevProcessEnd;
    if (i < procs.length - 1) j.nextProcessStart = procs[i + 1].plannedStart!;
    else delete j.nextProcessStart;
  });
  return next;
}

export type AdjustScope = "single" | "order";

export interface ShiftResult {
  jobs: ProcessJob[];
  message: string;
}

// scope="order"なら同一オーダーの全工程（完了済み・🔒手動ロックを除く）をまとめてシフトする対象を求める共通ロジック
function resolveTargets(jobs: ProcessJob[], targetKey: string, jobKeyFn: (j: ProcessJob) => string, scope: AdjustScope) {
  const target = jobs.find((j) => jobKeyFn(j) === targetKey);
  if (!target) return null;
  const orderKey = orderKeyOf(target);
  let targetKeys: Set<string>;
  let skippedLocked = 0;
  let skippedDone = 0;
  if (scope === "order") {
    const all = jobs.filter((j) => orderKeyOf(j) === orderKey && isScheduled(j));
    const eligible = all.filter((j) => {
      if (j.status === "done") { skippedDone++; return false; }
      if (j.manualLock) { skippedLocked++; return false; }
      return true;
    });
    targetKeys = new Set(eligible.map(jobKeyFn));
  } else {
    targetKeys = new Set([targetKey]);
  }
  return { orderKey, targetKeys, skippedLocked, skippedDone };
}

function buildMessage(scope: AdjustScope, dirLabel: string, targetCount: number, skippedLocked: number, skippedDone: number): string {
  if (scope === "order") {
    let message = `オーダー内 ${targetCount}件の工程を ${dirLabel} スライドしました`;
    const skippedParts: string[] = [];
    if (skippedLocked) skippedParts.push(`🔒手動ロック ${skippedLocked}件`);
    if (skippedDone) skippedParts.push(`完了済み ${skippedDone}件`);
    if (skippedParts.length) message += `（対象外：${skippedParts.join("・")}）`;
    return message;
  }
  return `この工程を ${dirLabel} スライドしました`;
}

// jobKeyで指定した工程を deltaDays 日シフトする（±1日／±1週ボタン、オーダー進捗表でのドラッグ・矢印キー操作用）
export function applyShift(jobs: ProcessJob[], targetKey: string, jobKeyFn: (j: ProcessJob) => string, deltaDays: number, scope: AdjustScope): ShiftResult {
  const resolved = resolveTargets(jobs, targetKey, jobKeyFn, scope);
  if (!resolved) return { jobs, message: "" };
  const { orderKey, targetKeys, skippedLocked, skippedDone } = resolved;

  let shifted = jobs.map((j) => {
    if (!targetKeys.has(jobKeyFn(j))) return j;
    const next = { ...j };
    if (next.plannedStart) next.plannedStart = addDaysToISO(next.plannedStart, deltaDays);
    if (next.plannedEnd) next.plannedEnd = addDaysToISO(next.plannedEnd, deltaDays);
    next.manualLock = true;
    next.pendingExport = true;
    return next;
  });
  shifted = recomputeAdjacency(shifted, orderKey);

  const dirLabel = (deltaDays > 0 ? "+" : "") + deltaDays + "日";
  return { jobs: shifted, message: buildMessage(scope, dirLabel, targetKeys.size, skippedLocked, skippedDone) };
}

// 自動工程調整（7章）の実行結果を実際の工程データへ反映する（2026-09-24追加）。
// src/lib/autoAdjust.ts の planAutoAdjustment が計算した移動プラン（工程ごとの新plannedStart/End）を
// そのまま適用するだけの、意図的に薄い関数。手動調整（applyShift/applyMinuteShift）とはここが異なる：
//   ・manualLockは立てない（自動調整で動かした工程を「手動調整済み」扱いにすると、次回以降の自動調整の
//     対象から常に除外されてしまい、担当者が意図しない固定化が起きるため）
//   ・pendingExportは立てる（plannedStart/Endが変わった以上、mcframeへの書き戻しは必要なため）
export interface AutoAdjustApply {
  targetKey: string;
  newPlannedStart: string;
  newPlannedEnd: string;
}
export function applyAutoAdjustment(jobs: ProcessJob[], moves: AutoAdjustApply[], jobKeyFn: (j: ProcessJob) => string): ShiftResult {
  if (moves.length === 0) return { jobs, message: "" };
  const byKey = new Map(moves.map((m) => [m.targetKey, m]));
  const affectedOrders = new Set<string>();
  let next = jobs.map((j) => {
    const m = byKey.get(jobKeyFn(j));
    if (!m) return j;
    affectedOrders.add(orderKeyOf(j));
    return { ...j, plannedStart: m.newPlannedStart, plannedEnd: m.newPlannedEnd, pendingExport: true };
  });
  affectedOrders.forEach((orderKey) => {
    next = recomputeAdjacency(next, orderKey);
  });
  return { jobs: next, message: `自動調整により ${moves.length}件の工程を移動しました` };
}

// jobKeyで指定した工程を deltaMinutes 分シフトする（ライン工程表でのドラッグ・矢印キー操作用。2026-09-22追加、3-4-1参照）
export function applyMinuteShift(jobs: ProcessJob[], targetKey: string, jobKeyFn: (j: ProcessJob) => string, deltaMinutes: number, scope: AdjustScope): ShiftResult {
  const resolved = resolveTargets(jobs, targetKey, jobKeyFn, scope);
  if (!resolved) return { jobs, message: "" };
  const { orderKey, targetKeys, skippedLocked, skippedDone } = resolved;

  let shifted = jobs.map((j) => {
    if (!targetKeys.has(jobKeyFn(j))) return j;
    const next = { ...j };
    if (next.plannedStart) next.plannedStart = addMinutesToISO(next.plannedStart, deltaMinutes);
    if (next.plannedEnd) next.plannedEnd = addMinutesToISO(next.plannedEnd, deltaMinutes);
    next.manualLock = true;
    next.pendingExport = true;
    return next;
  });
  shifted = recomputeAdjacency(shifted, orderKey);

  const dirLabel = (deltaMinutes > 0 ? "+" : "") + deltaMinutes + "分";
  return { jobs: shifted, message: buildMessage(scope, dirLabel, targetKeys.size, skippedLocked, skippedDone) };
}
