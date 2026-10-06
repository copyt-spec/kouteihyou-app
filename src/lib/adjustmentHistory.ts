import type { ProcessJob } from "../types/processJob";

// 手動調整パターンの提案（2026-09-26追加、設計ドキュメント7-10参照）。
//
// 背景：「手動調整しているところがパターン化できそうだったら、自動調整のパターンを作りましょうか？と
// 提案してほしい」との要望。「AIを入れて」との表現だったが、外部のAI（LLM API）を呼び出す形にすると
// APIキー・ネットワーク接続・社内データの外部送信範囲の検討が新たに必要になるため、今回は外部通信
// なしで完結するルールベースの統計的検知にする方針にした（ユーザー確認済み）。
//
// 検知対象は、オーダー進捗表での±日シフト（applyShift。ドラッグ・矢印キー・±1日/±1週ボタンいずれも
// 経由）のみに限定している。ライン工程表の分単位シフト（applyMinuteShift）は対象外：自動調整
// （autoAdjust.ts）が日単位の移動しか行わないため、分単位の手動調整パターンを検知できても
// 「自動調整のパターンにする」という提案につなげられないため。

export interface ManualAdjustmentLogEntry {
  id: string;
  at: string; // ISO datetime（記録時刻）
  scope: "single" | "order";
  deltaDays: number;
  jobKey: string;
  orderNumber: string | null;
  orderNo: string;
  customer: string;
  processType: string;
  factoryLineId: number | null;
  resource: string | null;
}

// ボードごとの履歴はlocalStorageに保存するため、無制限に増え続けないよう直近N件のみ保持する
export const MAX_ADJUSTMENT_LOG_ENTRIES = 500;

function newLogId(): string {
  return "adj_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// applyShift実行前後のjobs配列を比較し、実際にplannedStartが変化した工程ごとに1件のログエントリを作る
// （scope="order"で複数工程がまとめてシフトされた場合は、その件数分のエントリになる）
export function buildManualShiftLogEntries(
  scope: "single" | "order",
  deltaDays: number,
  oldJobs: ProcessJob[],
  newJobs: ProcessJob[],
  jobKeyFn: (j: ProcessJob) => string
): ManualAdjustmentLogEntry[] {
  const oldByKey = new Map(oldJobs.map((j) => [jobKeyFn(j), j]));
  const at = new Date().toISOString();
  const entries: ManualAdjustmentLogEntry[] = [];
  for (const nj of newJobs) {
    const key = jobKeyFn(nj);
    const oj = oldByKey.get(key);
    if (!oj || oj.plannedStart === nj.plannedStart) continue;
    entries.push({
      id: newLogId(),
      at,
      scope,
      deltaDays,
      jobKey: key,
      orderNumber: oj.orderNumber,
      orderNo: oj.orderNo,
      customer: oj.customer,
      processType: oj.processType,
      factoryLineId: oj.factoryLineId,
      resource: oj.resource,
    });
  }
  return entries;
}

export interface DetectedPattern {
  key: string;
  customer: string;
  factoryLineId: number | null;
  resource: string | null;
  processType: string;
  direction: "advance" | "delay"; // advance=前倒し、delay=後ろ倒し
  count: number;
  avgDeltaDays: number;
  lastAt: string;
}

// この回数以上、同じ組み合わせ×同じ向きの手動シフトが繰り返されたらパターンとして提案する
export const PATTERN_MIN_COUNT = 3;

// 得意先・ライン・資源・工程・向き（前倒し／後ろ倒し）が一致する手動シフトをグルーピングし、
// 閾値以上繰り返されている組み合わせを検知する。同一オーダーへの繰り返し編集ではなく、異なる
// オーダーをまたいだ「傾向」を拾うことが目的のため、グルーピングキーにオーダー番号は含めない
export function detectAdjustmentPatterns(log: ManualAdjustmentLogEntry[], minCount: number = PATTERN_MIN_COUNT): DetectedPattern[] {
  const groups = new Map<string, ManualAdjustmentLogEntry[]>();
  for (const e of log) {
    if (!e.deltaDays) continue;
    const direction = e.deltaDays > 0 ? "delay" : "advance";
    const key = [e.customer || "", e.factoryLineId ?? "", e.resource || "", e.processType || "", direction].join("|");
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const patterns: DetectedPattern[] = [];
  groups.forEach((entries) => {
    if (entries.length < minCount) return;
    const sorted = [...entries].sort((a, b) => (a.at < b.at ? 1 : -1)); // 新しい順
    const first = sorted[0];
    const avgDeltaDays = entries.reduce((s, e) => s + e.deltaDays, 0) / entries.length;
    patterns.push({
      key: [first.customer || "", first.factoryLineId ?? "", first.resource || "", first.processType || "", first.deltaDays > 0 ? "delay" : "advance"].join("|"),
      customer: first.customer,
      factoryLineId: first.factoryLineId,
      resource: first.resource,
      processType: first.processType,
      direction: first.deltaDays > 0 ? "delay" : "advance",
      count: entries.length,
      avgDeltaDays,
      lastAt: first.at,
    });
  });
  return patterns.sort((a, b) => b.count - a.count);
}
