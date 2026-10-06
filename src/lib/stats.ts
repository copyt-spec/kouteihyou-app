import type { ProcessJob } from "../types/processJob";
import { toDate } from "./dateUtils";
import { overlapsPrev } from "./geometry";

export interface LineStats {
  utilizationPct: number;
  activeLines: number;
  delayCount: number;
  overlapCount: number;
}

export function computeLineStats(jobs: ProcessJob[], today: Date, totalLines: number): LineStats {
  const activeLines = new Set<number>();
  jobs.forEach((j) => {
    if (!j.plannedStart || !j.plannedEnd) return;
    const s = toDate(j.plannedStart);
    const e = toDate(j.plannedEnd);
    if (today >= s && today <= e && (j.status === "active" || j.status === "reserved" || j.status === "delay") && j.factoryLineId != null) {
      activeLines.add(j.factoryLineId);
    }
  });
  const delayCount = jobs.filter((j) => j.status === "delay").length;
  const overlapCount = jobs.filter(overlapsPrev).length;
  return {
    utilizationPct: totalLines > 0 ? Math.round((activeLines.size / totalLines) * 100) : 0,
    activeLines: activeLines.size,
    delayCount,
    overlapCount,
  };
}
