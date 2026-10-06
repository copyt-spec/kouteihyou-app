import { useEffect, useState } from "react";
import { useGantt } from "../state/GanttContext";
import { jobKey, orderKeyOf } from "../types/processJob";
import { fmtDT } from "../lib/dateUtils";
import { overlapsPrev } from "../lib/geometry";
import { fmtHours } from "../lib/format";
import { type AdjustScope } from "../lib/adjust";

// GanttDetailPanel：両画面共有のボトムシート。工程調整（日程シフト）パネルを内蔵する（設計ドキュメント 3-0・3-4参照）
// ライン⇔オーダーの結び付け（2026-09-23追加）：1件のProcessJobは常にライン（factoryLineId／resource）と
// オーダー（orderNumber／orderNo）の両方を同時に持つレコードであり、データ上はこの1レコードがそのまま両者の
// 結びつきそのものになっている（別テーブルでの対応管理は不要）。ただし3-0の決定でライン工程表／オーダー進捗表を
// 別画面に分離したため、画面をまたいで「このジョブが属するオーダー／ラインを、もう片方の画面で見る」導線が
// 無かった。この詳細シートに「もう片方の画面で見る」ボタンを追加し、選択中の同じジョブを保持したまま画面を
// 切り替え・該当行を展開・表示期間をそのジョブの計画日に合わせることで、両画面間を行き来できるようにした。
export function DetailSheet() {
  const {
    jobs,
    boardProvider,
    lines,
    view,
    updateView,
    setAnchor,
    setOrderAnchor,
    setExpandedOrder,
    setExpandedLineRow,
    setFilterSearch,
    selectedJob,
    setSelectedJob,
  } = useGantt();
  const [adjScope, setAdjScope] = useState<AdjustScope>("single");
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    setAdjScope("single");
    setResultMessage("");
  }, [selectedJob]);

  const job = jobs.find((j) => jobKey(j) === selectedJob) || null;
  const show = !!job;

  function close() {
    setSelectedJob(null);
  }
  function shift(deltaDays: number) {
    if (!job) return;
    const key = jobKey(job);
    // 実際のjobs更新はboardProviderの購読（GanttContext）経由で反映される
    boardProvider.applyShift(key, jobKey, deltaDays, adjScope).then(({ message }) => {
      setResultMessage(message);
    });
  }

  const line = job ? lines.find((l) => l.id === job.factoryLineId) : null;
  const warn = job ? overlapsPrev(job) : false;
  const canAdjust = job ? !!(job.plannedStart && job.plannedEnd) && job.status !== "done" : false;

  // 詳細シートを開いているジョブは常にスケジュール済み（バーをクリックした結果としてしか開かないため）
  function jumpToOrderScreen() {
    if (!job) return;
    const ok = orderKeyOf(job);
    setExpandedOrder(ok);
    setFilterSearch(ok);
    if (job.plannedStart) setOrderAnchor(new Date(job.plannedStart));
    updateView({ screen: "order" });
  }
  function jumpToLineScreen() {
    if (!job || job.factoryLineId == null) return;
    setExpandedLineRow(String(job.factoryLineId));
    if (job.plannedStart) setAnchor(new Date(job.plannedStart));
    updateView({ screen: "line", groupBy: "line" });
  }

  return (
    <>
      <div className={`scrim ${show ? "show" : ""}`} onClick={close} />
      <div className={`sheet ${show ? "show" : ""}`}>
        {job && (
          <>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <h2>
                  {job.customer} {job.processType}
                </h2>
                <div className="oid mono">{job.orderNumber ? `${job.orderNumber} − 工程${job.processSeq}` : `${job.orderNo}（未指図）`}</div>
              </div>
              <button className="closebtn" onClick={close}>
                ✕
              </button>
            </div>

            {resultMessage && <div className="adjresult">{resultMessage}</div>}
            {job.manualLock && <div className="lockbox">🔒 手動調整済み（自動工程調整の対象外）</div>}
            {job.pendingExport && <div className="pendingbox">↩ mcframeへ未反映（設定の「書き戻し設定」タブからCSVを出力してください）</div>}
            {warn && (
              <div className="warnbox">
                ⚠ 前工程の終了（{fmtDT(job.prevProcessEnd)}）より前に開始予定です。担当ラインの調整を確認してください
              </div>
            )}

            {job.plannedStart && (
              <div className="jumprow">
                {view.screen !== "order" && (
                  <button className="btn small" onClick={jumpToOrderScreen}>
                    ↗ オーダー進捗表でこのオーダーを見る
                  </button>
                )}
                {view.screen !== "line" && job.factoryLineId != null && (
                  <button className="btn small" onClick={jumpToLineScreen}>
                    ↗ ライン工程表でこのラインを見る
                  </button>
                )}
              </div>
            )}

            <div className="kv">
              <div className="item">
                <div className="k">オーダーNo</div>
                <div className="v mono">{job.orderNo || "—"}</div>
              </div>
              <div className="item">
                <div className="k">製造指図番号</div>
                <div className="v mono">{job.orderNumber || "（未指図）"}</div>
              </div>
              <div className="item">
                <div className="k">ライン</div>
                <div className="v">{line ? line.name : "—"}</div>
              </div>
              <div className="item">
                <div className="k">資源</div>
                <div className="v">{job.resource || "—"}</div>
              </div>
              <div className="item">
                <div className="k">得意先</div>
                <div className="v">{job.customer}</div>
              </div>
              <div className="item">
                <div className="k">納期</div>
                <div className="v mono">{job.dueDate || "—"}</div>
              </div>
              <div className="item">
                <div className="k">計画数量</div>
                <div className="v mono">{job.plannedQuantity}</div>
              </div>
              <div className="item">
                <div className="k">実績数量</div>
                <div className="v mono">{job.actualQuantity || 0}</div>
              </div>
              <div className="item">
                <div className="k">予定工数</div>
                <div className="v mono">{job.plannedManHours != null ? fmtHours(job.plannedManHours, view.hoursUnit) : "—"}</div>
              </div>
            </div>

            <div className="panel-note" style={{ fontSize: 12.5, color: "var(--mist)", marginBottom: 4 }}>
              進捗
            </div>
            <div className="progressbar">
              <div className="fill" style={{ width: (job.progress || 0) + "%" }} />
            </div>
            <div className="adjrow">
              <span>計画</span>
              <span className="mono">
                {fmtDT(job.plannedStart)} 〜 {fmtDT(job.plannedEnd)}
              </span>
            </div>
            <div className="adjrow">
              <span>実績</span>
              <span className="mono">
                {fmtDT(job.actualStart)} 〜 {job.actualEnd ? fmtDT(job.actualEnd) : job.actualStart ? "進行中" : "—"}
              </span>
            </div>
            <div className="adjrow">
              <span>前工程 終了</span>
              <span className="mono" style={warn ? { color: "var(--rose)", fontWeight: 700 } : undefined}>
                {fmtDT(job.prevProcessEnd)}
              </span>
            </div>
            <div className="adjrow">
              <span>後工程 開始</span>
              <span className="mono">{fmtDT(job.nextProcessStart)}</span>
            </div>

            {canAdjust ? (
              <div className="adjpanel">
                <div className="adjpanel-head">日程調整</div>
                <div className="segments">
                  <button className={`segbtn ${adjScope === "single" ? "active" : ""}`} onClick={() => setAdjScope("single")}>
                    この工程のみ
                  </button>
                  <button className={`segbtn ${adjScope === "order" ? "active" : ""}`} onClick={() => setAdjScope("order")}>
                    オーダー全体をスライド
                  </button>
                </div>
                <div className="adjbtns">
                  <button className="btn small" onClick={() => shift(-7)}>
                    ◀◀ 1週
                  </button>
                  <button className="btn small" onClick={() => shift(-1)}>
                    ◀ 1日
                  </button>
                  <button className="btn small" onClick={() => shift(1)}>
                    1日 ▶
                  </button>
                  <button className="btn small" onClick={() => shift(7)}>
                    1週 ▶▶
                  </button>
                </div>
                <div className="adjpanel-note">
                  {adjScope === "order"
                    ? "このオーダーの全工程を同じ日数だけまとめてスライドします（工程どうしの間隔は保たれます。🔒手動ロック済み・完了済みの工程は対象外）"
                    : "この工程だけを前後にスライドします"}
                </div>
              </div>
            ) : job.plannedStart && job.plannedEnd ? (
              <div className="adjpanel-note" style={{ padding: "6px 0 14px" }}>
                完了済みの工程のため日程調整はできません
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
