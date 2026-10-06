import { type ProcessJob, jobKey } from "../types/processJob";
import { toDate, dateOnly } from "./dateUtils";

export interface LaneAssignment {
  laneOf: Record<string, number>;
  laneCount: number;
}

// LineScreen（時間単位）用：時刻ベースで重なりを判定してレーンを割り当てる（貪欲法）
export function assignLanes(jobs: ProcessJob[]): LaneAssignment {
  const sorted = jobs.slice().sort((a, b) => toDate(a.plannedStart!).getTime() - toDate(b.plannedStart!).getTime());
  const laneEnds: (Date | null)[] = [];
  const laneOf: Record<string, number> = {};
  sorted.forEach((j) => {
    const s = toDate(j.plannedStart!);
    let lane = laneEnds.findIndex((end) => end !== null && end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(null);
    }
    laneEnds[lane] = toDate(j.plannedEnd!);
    laneOf[jobKey(j)] = lane;
  });
  return { laneOf, laneCount: Math.max(laneEnds.length, 1) };
}

// OrderScreen（日次単位）用：日付（0時丸め）ベースで重なりを判定してレーンを割り当てる
export function assignLanesByDay(jobs: ProcessJob[]): LaneAssignment {
  const sorted = jobs.slice().sort((a, b) => dateOnly(a.plannedStart!).getTime() - dateOnly(b.plannedStart!).getTime());
  const laneEnds: (Date | null)[] = [];
  const laneOf: Record<string, number> = {};
  sorted.forEach((j) => {
    const s = dateOnly(j.plannedStart!);
    let lane = laneEnds.findIndex((end) => end !== null && end < s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(null);
    }
    laneEnds[lane] = dateOnly(j.plannedEnd!);
    laneOf[jobKey(j)] = lane;
  });
  return { laneOf, laneCount: Math.max(laneEnds.length, 1) };
}
