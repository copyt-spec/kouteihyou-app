import { useGantt } from "../state/GanttContext";
import { jobKey, orderKeyOf } from "../types/processJob";

// 選択中の工程を示す軽量な帯。詳細シート（ボトムシート）を開かなくても、ドラッグ・矢印キーで
// 工程調整ができることを示す。詳細を見たいときだけ「詳細」ボタンから開く（設計ドキュメント3-4-1参照）。
export function SelectionBar({ arrowStepLabel }: { arrowStepLabel: string }) {
  const { jobs, selection, setSelection, setSelectedJob } = useGantt();
  if (!selection) return null;
  const anchorJob = jobs.find((j) => jobKey(j) === selection.jobKey);
  if (!anchorJob) return null;
  const scopeLabel = selection.scope === "order" ? "オーダー全体" : "この工程のみ";
  const count = selection.scope === "order" ? jobs.filter((j) => orderKeyOf(j) === selection.orderKey).length : 1;
  const orderLabel = anchorJob.orderNumber ?? anchorJob.orderNo;

  return (
    <div className="selectionbar">
      <span className="selectionbar-label">
        選択中：{anchorJob.customer}（{orderLabel}）・{scopeLabel}（{count}件）
      </span>
      <span className="selectionbar-hint">ドラッグ、または ← → キー（{arrowStepLabel}）で移動できます。Escで選択解除</span>
      <div className="selectionbar-actions">
        <button className="btn small" onClick={() => setSelectedJob(selection.jobKey)}>
          詳細
        </button>
        <button className="btn small ghost" onClick={() => setSelection(null)}>
          選択解除
        </button>
      </div>
    </div>
  );
}
