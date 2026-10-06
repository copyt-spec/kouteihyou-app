import type { ProcessJob } from "../types/processJob";
import {
  applyAutoAdjustment as applyAutoAdjustmentPure,
  applyMinuteShift as applyMinuteShiftPure,
  applyShift as applyShiftPure,
  type AdjustScope,
  type AutoAdjustApply,
  type ShiftResult,
} from "../lib/adjust";
import { appendBoardAdjustmentLog, readBoardJobs, touchBoard, writeBoardJobs } from "../lib/boardStorage";
import { buildManualShiftLogEntries } from "../lib/adjustmentHistory";

// BoardDataProvider：工程データ（ProcessJob[]）の読み書きの窓口を抽象化したインターフェース
// （設計ドキュメント 5章「ソフト化・共有方式」2026-09-24新設、5-2参照）。
//
// 背景：工程表アプリを部門内で複数人が使う場合に「誰かの工程調整結果を他の人にもリアルタイムに
// 反映したい」という要望があり、そのための土台として、画面（OrderScreen/LineScreen/DetailSheet等）が
// localStorageやReactのローカル状態を直接操作するのではなく、この抽象インターフェース越しに
// 工程調整を「依頼」する形に変更した。
//
// 今回（ステップ1）はこのインターフェースの実装として、従来どおりlocalStorageのみで完結する
// LocalBoardProvider（スタンドアロン動作）だけを用意する。挙動は以前とまったく変わらない。
// 将来（ステップ2）、部門内サーバーへWebSocketで接続するRealtimeBoardProviderを同じ
// インターフェースの別実装として追加し、ボードの設定で切り替えられるようにする予定
// （applyShift/applyMinuteShiftはサーバー側でも同じsrc/lib/adjust.tsのロジックをそのまま
// 再利用できるよう、純粋関数のまま据え置いている）。
export interface BoardDataProvider {
  readonly mode: "local" | "realtime"; // realtimeの実装はrealtimeBoardProvider.ts参照（ステップ2、5-2・5-6参照）
  getJobs(): ProcessJob[];
  // 工程データの変化を購読する。ローカル動作では調整・書き戻し確定のたびに、サーバー接続動作では
  // サーバーからの配信のたびに呼ばれる想定
  subscribe(listener: (jobs: ProcessJob[]) => void): () => void;
  applyShift(targetKey: string, jobKeyFn: (j: ProcessJob) => string, deltaDays: number, scope: AdjustScope): Promise<ShiftResult>;
  applyMinuteShift(targetKey: string, jobKeyFn: (j: ProcessJob) => string, deltaMinutes: number, scope: AdjustScope): Promise<ShiftResult>;
  // CSV書き戻し（1-3）を実行した工程のpendingExportフラグを下ろす
  clearPendingExport(keys: Set<string>, jobKeyFn: (j: ProcessJob) => string): Promise<void>;
  // 自動工程調整（7章）：src/lib/autoAdjust.tsが計算した移動プランを反映する（2026-09-24追加）
  applyAutoAdjustment(moves: AutoAdjustApply[], jobKeyFn: (j: ProcessJob) => string): Promise<ShiftResult>;
}

export function createLocalBoardProvider(boardId: string): BoardDataProvider {
  let jobs = readBoardJobs(boardId);
  const listeners = new Set<(jobs: ProcessJob[]) => void>();

  function commit(next: ProcessJob[]) {
    jobs = next;
    writeBoardJobs(boardId, next);
    touchBoard(boardId);
    listeners.forEach((listener) => listener(next));
  }

  return {
    mode: "local",
    getJobs: () => jobs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async applyShift(targetKey, jobKeyFn, deltaDays, scope) {
      const prevJobs = jobs;
      const result = applyShiftPure(jobs, targetKey, jobKeyFn, deltaDays, scope);
      if (result.message) {
        // 手動調整パターンの検知（7-10）向けに、実際に日付が変わった工程だけをログへ記録する
        const logEntries = buildManualShiftLogEntries(scope, deltaDays, prevJobs, result.jobs, jobKeyFn);
        appendBoardAdjustmentLog(boardId, logEntries);
        commit(result.jobs);
      }
      return result;
    },
    async applyMinuteShift(targetKey, jobKeyFn, deltaMinutes, scope) {
      const result = applyMinuteShiftPure(jobs, targetKey, jobKeyFn, deltaMinutes, scope);
      if (result.message) commit(result.jobs);
      return result;
    },
    async clearPendingExport(keys, jobKeyFn) {
      commit(jobs.map((j) => (keys.has(jobKeyFn(j)) ? { ...j, pendingExport: false } : j)));
    },
    async applyAutoAdjustment(moves, jobKeyFn) {
      const result = applyAutoAdjustmentPure(jobs, moves, jobKeyFn);
      if (result.message) commit(result.jobs);
      return result;
    },
  };
}
