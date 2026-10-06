import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useGantt } from "../state/GanttContext";
import { type ProcessJob, jobKey, orderKeyOf, isScheduled } from "../types/processJob";
import type { AdjustScope, ShiftResult } from "../lib/adjust";
import { selectedJobKeys } from "../lib/selection";

// グリッド上でのクリック（オーダー全体選択）／ダブルクリック（工程単体選択）／ドラッグ／矢印キーによる
// 工程調整。設計ドキュメント3-4-1参照。ボタンによる±1日／±1週シフト（DetailSheet内のGanttAdjustPanel）を
// 置き換えるものではなく、詳細シートを開かずに素早く調整できる補助手段として追加した。

export interface DragPreview {
  keys: Set<string>;
  deltaPx: number;
}

interface UseGanttInteractionsOpts {
  // ドラッグのピクセル差分を、スナップ済みの単位数（日 or 分。動きが小さければ0）に変換する
  deltaFromPx: (deltaPx: number, containerSizePx: number) => number;
  // 単位数分シフトを実行する（boardProvider.applyShift/applyMinuteShiftのラッパー。2026-09-24よりPromiseに変更：
  // ローカル動作では即座に解決するが、将来のサーバー接続動作ではサーバーとの往復を待つ形になるため）
  applyDelta: (targetKey: string, deltaUnits: number, scope: AdjustScope) => Promise<ShiftResult>;
  // 矢印キー1回あたりの移動量（オーダー進捗表=1、ライン工程表=15）
  arrowStepUnits: number;
  // 時間軸の向き（既定"x"=横。ライン工程表の縦表示（2026-09-22追加）では"y"を渡し、ドラッグ・矢印キーとも
  // 縦方向（下＝時間が進む）で判定する。ドラッグの対象コンテナは共通のマーカークラス".gantt-track"で探す
  axis?: "x" | "y";
}

interface PendingDrag {
  key: string;
  scope: AdjustScope;
  orderKey: string;
  keys: Set<string>;
  startClientPos: number;
  containerSizePx: number;
  moved: boolean;
  draggable: boolean;
}

export function useGanttInteractions({ deltaFromPx, applyDelta, arrowStepUnits, axis = "x" }: UseGanttInteractionsOpts) {
  const { jobs, selection, setSelection } = useGantt();
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const clickTimerRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const selKeys = selectedJobKeys(jobs, selection);

  function isDraggable(job: ProcessJob): boolean {
    return isScheduled(job) && job.status !== "done";
  }

  function commitClick(job: ProcessJob, scope: AdjustScope) {
    setSelection({ scope, orderKey: orderKeyOf(job), jobKey: jobKey(job) });
  }

  function handleClickOnly(job: ProcessJob) {
    const key = jobKey(job);
    if (clickTimerRef.current && clickTimerRef.current.key === key) {
      clearTimeout(clickTimerRef.current.timer);
      clickTimerRef.current = null;
      commitClick(job, "single"); // ダブルクリック＝工程単体を選択
    } else {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current.timer);
      const timer = setTimeout(() => {
        clickTimerRef.current = null;
        commitClick(job, "order"); // シングルクリック＝オーダー全体を選択
      }, 250);
      clickTimerRef.current = { key, timer };
    }
  }

  function handleBarPointerDown(e: ReactPointerEvent<HTMLDivElement>, job: ProcessJob) {
    e.stopPropagation();
    const key = jobKey(job);
    const draggable = isDraggable(job);
    // 🔒手動ロック済みの工程はオーダー全体スライドの対象外なので、単体ドラッグとして扱う
    const alreadySingle = selection?.scope === "single" && selection.jobKey === key;
    const scope: AdjustScope = alreadySingle || job.manualLock ? "single" : "order";
    const orderKeyVal = orderKeyOf(job);
    const keys =
      scope === "order"
        ? new Set(
            jobs
              .filter((j) => orderKeyOf(j) === orderKeyVal && isScheduled(j) && j.status !== "done" && !j.manualLock)
              .map(jobKey)
          )
        : new Set([key]);
    // 完了済みなどドラッグ不可の工程は containerSizePx=0 とし、pointermoveでのドラッグ開始を無効化する
    // （選択＝クリック/ダブルクリック判定はpointerupで統一して行うため、ここでは即座に確定させない）
    const container = draggable ? ((e.currentTarget as HTMLElement).closest(".gantt-track") as HTMLElement | null) : null;
    const rect = container?.getBoundingClientRect();
    const containerSizePx = rect ? (axis === "y" ? rect.height : rect.width) : 0;
    const startClientPos = axis === "y" ? e.clientY : e.clientX;
    pendingRef.current = { key, scope, orderKey: orderKeyVal, keys, startClientPos, containerSizePx, moved: false, draggable };
    // pointerupが必ず同じ要素に届くよう、ドラッグ不可の工程でもキャプチャしておく
    // （選択直後の再描画でバーの位置がずれても、クリック/ダブルクリック判定が取りこぼされないようにするため）
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 一部環境（テスト等）ではPointer Capture未対応のことがある */
    }
  }

  function handleBarPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = pendingRef.current;
    if (!p || !p.draggable || p.containerSizePx <= 0) return;
    const deltaPx = (axis === "y" ? e.clientY : e.clientX) - p.startClientPos;
    if (!p.moved && Math.abs(deltaPx) > 4) p.moved = true;
    if (p.moved) setDragPreview({ keys: p.keys, deltaPx });
  }

  function handleBarPointerUp(e: ReactPointerEvent<HTMLDivElement>, job: ProcessJob) {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    if (p.moved) {
      const deltaPx = (axis === "y" ? e.clientY : e.clientX) - p.startClientPos;
      const deltaUnits = p.containerSizePx > 0 ? deltaFromPx(deltaPx, p.containerSizePx) : 0;
      setDragPreview(null);
      if (deltaUnits !== 0) {
        // 実際のjobs更新はboardProviderの購読（GanttContext）経由で反映されるため、ここではメッセージが
        // あった（＝実際にシフトが確定した）ときの選択状態の更新だけを行う
        applyDelta(p.key, deltaUnits, p.scope).then((result) => {
          if (result.message) {
            setSelection({ scope: p.scope, orderKey: p.orderKey, jobKey: p.key });
          }
        });
      }
    } else {
      handleClickOnly(job);
    }
  }

  function clearSelection() {
    setSelection(null);
  }

  // 矢印キーでのシフト（何かを選択中のみ有効）。フォーム入力中は無効化する
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (!selection) return;
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      const forwardKey = axis === "y" ? "ArrowDown" : "ArrowRight";
      const backwardKey = axis === "y" ? "ArrowUp" : "ArrowLeft";
      if (e.key !== forwardKey && e.key !== backwardKey) return;
      e.preventDefault();
      const dir = e.key === forwardKey ? 1 : -1;
      // jobs更新はboardProviderの購読経由で反映されるため、結果を待たずに要求だけ出す
      void applyDelta(selection.jobKey, dir * arrowStepUnits, selection.scope);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, applyDelta, arrowStepUnits, axis, setSelection]);

  return { selKeys, dragPreview, handleBarPointerDown, handleBarPointerMove, handleBarPointerUp, clearSelection };
}
