import type { ProcessJob } from "../types/processJob";
import { addDaysToISO, dayDiff } from "./dateUtils";
import { comparePriority, eachDate, effectiveCapacityForDay, hoursBetween, isWorkingDateWithConfig, jobFieldForUnit, type CapacityConfig } from "./capacity";

// 自動工程調整（設計ドキュメント7章）の「③条件フロー・実行」で使う、移動先探索ロジック（2026-09-24追加）。
//
// スコープ（意図的な割り切り）：
//   ・探索するのは「同じ単位（ライン／資源／工程／品目）内での日付シフト」のみ。ライン変更（lineEligibility制約）
//     は、その判定に必要な品目⇔対応ラインマスタが未整備のため、今回は対象外（7-7参照。制約カード自体は
//     UI上に残しているが、この探索ロジックはまだ見ていない）
//   ・探索方向は前方（後ろ倒し）のみ。工程の元の日付から最大SEARCH_WINDOW_DAYS日先まで、稼働日かつ
//     持ち工数に空きがある最初の日を採用する
//   ・工程の所要時間（plannedStart〜plannedEndの長さ）は変えず、日付だけを動かす（時刻は保持したままaddDaysToISOで移動）

const SEARCH_WINDOW_DAYS = 60;

export interface AutoAdjustMove {
  jobKey: string;
  job: ProcessJob; // 移動前のスナップショット（表示用）
  unit: string;
  fromDate: string;
  toDate: string;
  newPlannedStart: string;
  newPlannedEnd: string;
  reason: string;
}
export interface AutoAdjustUnresolved {
  jobKey: string;
  job: ProcessJob;
  date: string;
  reason: string;
}
export interface AutoAdjustPlan {
  eligibleCount: number;
  overloadedSlotCount: number;
  flaggedJobs: ProcessJob[]; // 工数超過スロットに含まれていた対象工程（表示用スナップショット）
  moves: AutoAdjustMove[];
  unresolved: AutoAdjustUnresolved[];
  lockedSkipped: number;
  capacityCheckDisabled: boolean; // ③制約条件「持ち工数の上限を超えない」がOFFの場合true（何も検出しない）
}

export function planAutoAdjustment(jobs: ProcessJob[], config: CapacityConfig, simFrom: string, simTo: string, jobKeyFn: (j: ProcessJob) => string): AutoAdjustPlan {
  const r = config.rules;
  const unit = config.capacityUnit;
  const days = eachDate(simFrom, simTo);
  const lockEnabled = r.respectManualLock && (r.constraints.find((c) => c.type === "manualLock")?.enabled ?? true);
  const capEnabled = r.constraints.find((c) => c.type === "capacityLimit")?.enabled ?? true;
  const seqEnabled = r.constraints.find((c) => c.type === "processSequence")?.enabled ?? true;

  // 作業用コピー。移動の都度この配列を書き換えながら以降のスロットの需要を再計算する
  const working = jobs.map((j) => ({ ...j }));

  function eligibleFilter(j: ProcessJob): boolean {
    if (!j.plannedStart) return false;
    const raw =
      r.eligibility.col === "factoryLineCode" ? String(j.factoryLineId ?? "") : r.eligibility.col === "resource" ? (j.resource ?? "") : r.eligibility.col === "statusCode" ? j.status : j.processType;
    const vals = r.eligibility.values.map((x) => x.trim()).filter(Boolean);
    if (vals.length === 0) return true;
    return r.eligibility.op === "equals" ? vals.includes(String(raw)) : !vals.includes(String(raw));
  }

  const eligible = working.filter((j) => j.plannedStart && days.includes(j.plannedStart.slice(0, 10)) && eligibleFilter(j));

  if (!capEnabled) {
    return { eligibleCount: eligible.length, overloadedSlotCount: 0, flaggedJobs: [], moves: [], unresolved: [], lockedSkipped: 0, capacityCheckDisabled: true };
  }

  function demandOn(unitValue: string, dateISO: string): number {
    let sum = 0;
    for (const j of working) {
      if (!j.plannedStart || !j.plannedEnd) continue;
      if (jobFieldForUnit(unit, j) !== unitValue) continue;
      if (j.plannedStart.slice(0, 10) !== dateISO) continue;
      sum += hoursBetween(j.plannedStart, j.plannedEnd);
    }
    return sum;
  }
  function capOn(unitValue: string, dateISO: string): number {
    const day = new Date(dateISO + "T00:00:00");
    if (!isWorkingDateWithConfig(config, day)) return 0;
    return effectiveCapacityForDay(config, unit, unitValue, day);
  }

  // 対象となる(単位, 日)の組み合わせを、日付の昇順で抽出（単位の値に"|"を含まない前提。
  // ライン/資源名・工程名・品目名に"|"を使うケースは想定していない）
  const slotKeys = new Set<string>();
  eligible.forEach((j) => {
    const fv = jobFieldForUnit(unit, j);
    if (fv == null || !j.plannedStart) return;
    slotKeys.add(fv + "|" + j.plannedStart.slice(0, 10));
  });
  const slots = Array.from(slotKeys)
    .map((k) => {
      const i = k.lastIndexOf("|");
      return { unitValue: k.slice(0, i), dateISO: k.slice(i + 1) };
    })
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  const moves: AutoAdjustMove[] = [];
  const unresolved: AutoAdjustUnresolved[] = [];
  const flaggedJobs: ProcessJob[] = [];
  let lockedSkipped = 0;
  let overloadedSlotCount = 0;
  const excluded = new Set<string>();

  for (const slot of slots) {
    let demand = demandOn(slot.unitValue, slot.dateISO);
    const cap = capOn(slot.unitValue, slot.dateISO);
    if (demand <= cap) continue;
    overloadedSlotCount++;

    const candidates = working
      .filter((j) => jobFieldForUnit(unit, j) === slot.unitValue && j.plannedStart?.slice(0, 10) === slot.dateISO && eligibleFilter(j))
      .sort((a, b) => comparePriority(a, b, r.priorityRules, config));
    candidates.forEach((j) => flaggedJobs.push({ ...j }));

    // 優先順位が低い方（配列末尾）から順に動かす
    for (let i = candidates.length - 1; i >= 0 && demand > cap; i--) {
      const job = candidates[i];
      const key = jobKeyFn(job);
      if (excluded.has(key)) continue;
      if (!job.plannedStart || !job.plannedEnd) continue;

      if (job.manualLock && lockEnabled) {
        lockedSkipped++;
        excluded.add(key);
        continue;
      }

      const origSnapshot: ProcessJob = { ...job };
      const origDate = job.plannedStart.slice(0, 10);
      const origDay = new Date(origDate + "T00:00:00");
      const jobHours = hoursBetween(job.plannedStart, job.plannedEnd);
      const minDateISO = seqEnabled && job.prevProcessEnd ? job.prevProcessEnd.slice(0, 10) : null;
      const maxDateISO = seqEnabled && job.nextProcessStart ? job.nextProcessStart.slice(0, 10) : null;

      let placed = false;
      for (let offset = 1; offset <= SEARCH_WINDOW_DAYS && !placed; offset++) {
        const candDateStr = addDaysToISO(origDate + "T00:00", offset).slice(0, 10);
        if (minDateISO && candDateStr < minDateISO) continue;
        if (maxDateISO && candDateStr > maxDateISO) break; // これより先は制約違反。探索打ち切り
        const candDay = new Date(candDateStr + "T00:00:00");
        if (!isWorkingDateWithConfig(config, candDay)) continue;
        const candDemand = demandOn(slot.unitValue, candDateStr);
        const candCap = capOn(slot.unitValue, candDateStr);
        if (candDemand + jobHours > candCap) continue;

        const deltaDays = dayDiff(origDay, candDay);
        const newStart = addDaysToISO(job.plannedStart, deltaDays);
        const newEnd = addDaysToISO(job.plannedEnd, deltaDays);
        job.plannedStart = newStart;
        job.plannedEnd = newEnd;
        moves.push({
          jobKey: key,
          job: origSnapshot,
          unit: slot.unitValue,
          fromDate: origDate,
          toDate: candDateStr,
          newPlannedStart: newStart,
          newPlannedEnd: newEnd,
          reason: `${slot.dateISO}の持ち工数超過のため`,
        });
        demand = demandOn(slot.unitValue, slot.dateISO);
        placed = true;
      }
      if (!placed) {
        unresolved.push({
          jobKey: key,
          job: origSnapshot,
          date: slot.dateISO,
          reason: `前後工程の制約、または持ち工数の空きが見つからず移動できませんでした（探索範囲：先${SEARCH_WINDOW_DAYS}日以内）`,
        });
        excluded.add(key);
      }
    }
  }

  return { eligibleCount: eligible.length, overloadedSlotCount, flaggedJobs, moves, unresolved, lockedSkipped, capacityCheckDisabled: false };
}
