import { type ProcessJob, jobKey, orderKeyOf } from "../types/processJob";
import type { JobSelection } from "../state/types";

// 現在の選択（JobSelection）に含まれる工程のjobKey一覧を求める。
// scope="order"なら同一オーダーの全工程（完了済み・🔒手動ロック含む。表示上はハイライトするが、
// 実際のシフト対象からの除外はapplyShift/applyMinuteShift側で行う）
export function selectedJobKeys(jobs: ProcessJob[], selection: JobSelection | null): Set<string> {
  if (!selection) return new Set();
  if (selection.scope === "single") return new Set([selection.jobKey]);
  return new Set(jobs.filter((j) => orderKeyOf(j) === selection.orderKey).map(jobKey));
}
