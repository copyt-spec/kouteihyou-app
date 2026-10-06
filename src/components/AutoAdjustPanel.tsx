import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import { fmtDate } from "../lib/dateUtils";
import { jobKey, orderKeyOf } from "../types/processJob";
import { planAutoAdjustment, type AutoAdjustPlan } from "../lib/autoAdjust";

// 自動工程調整パネル（2026-09-24追加、ライン工程表・オーダー進捗表の両画面に設置）。
// 以前は設定画面（歯車アイコン）内の「③条件フロー・実行」タブにしかなかった実行・反映UIを、
// 工程表画面から直接使えるようにしたもの。対象工程の絞り込み・優先順位ルール・制約条件といった
// 詳細な条件設定はこのパネルには置かず、従来どおり設定画面側で行う（「詳細設定を開く」から遷移）。
// 実行ロジック自体（planAutoAdjustment・boardProvider.applyAutoAdjustment）は設定画面の
// RulesTabと完全に同じものを呼び出しており、二重実装ではない。
export function AutoAdjustPanel({ onOpenRules }: { onOpenRules: () => void }) {
  const { jobs, capacityConfig, boardProvider } = useGantt();
  const [open, setOpen] = useState(false);
  const [simFrom, setSimFrom] = useState(fmtDate(new Date()));
  const [simTo, setSimTo] = useState(fmtDate(new Date(Date.now() + 13 * 86400000)));
  const [plan, setPlan] = useState<AutoAdjustPlan | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");

  function runSimulation() {
    setApplyMessage("");
    setPlan(planAutoAdjustment(jobs, capacityConfig, simFrom, simTo, jobKey));
  }

  async function applyPlan() {
    if (!plan || plan.moves.length === 0) return;
    setApplying(true);
    try {
      const moves = plan.moves.map((m) => ({ targetKey: m.jobKey, newPlannedStart: m.newPlannedStart, newPlannedEnd: m.newPlannedEnd }));
      const { message } = await boardProvider.applyAutoAdjustment(moves, jobKey);
      setApplyMessage(message || "反映しました");
      setPlan(null); // 反映後は工程データが変わっているため、プランは作り直しが必要
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="panel autoadjustpanel">
      <div className="panel-head" style={{ cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <h2>
          <span className="mono" style={{ marginRight: 6 }}>
            {open ? "▼" : "▶"}
          </span>
          自動工程調整
        </h2>
        <span className="panel-note">持ち工数の超過を検出し、空きのある稼働日へ移動します</span>
      </div>
      {open && (
        <>
          <div className="toolbar" style={{ flexWrap: "wrap" }}>
            <label className="field">
              <span>対象期間（から）</span>
              <input type="date" value={simFrom} onChange={(e) => setSimFrom(e.target.value)} />
            </label>
            <label className="field">
              <span>対象期間（まで）</span>
              <input type="date" value={simTo} onChange={(e) => setSimTo(e.target.value)} />
            </label>
            <button className="btn primary" onClick={runSimulation}>
              ▶ 自動調整を実行
            </button>
            <button className="btn small ghost" onClick={onOpenRules}>
              条件・優先順位の詳細設定を開く →
            </button>
          </div>

          {applyMessage && (
            <div className="adjresult" style={{ marginTop: 10 }}>
              {applyMessage}
            </div>
          )}

          {!plan ? (
            <div className="panel-note" style={{ marginTop: 10 }}>
              「自動調整を実行」を押すと、指定期間の工程を設定画面側で決めた条件・優先順位に照らして、持ち工数を超過している日から空きのある日（同じライン／資源／工程／品目内、最大60日先まで、稼働日のみ）への移動プランを作成します。内容を確認したうえで「この内容で反映する」を押すと、実際の工程表に反映されます。
            </div>
          ) : plan.capacityCheckDisabled ? (
            <div className="panel-note" style={{ marginTop: 10 }}>
              制約条件の「持ち工数の上限を超えない」がOFFのため、超過検出・移動プランの作成はスキップされました（対象工程数：{plan.eligibleCount}件）。詳細設定で確認してください。
            </div>
          ) : (
            <>
              <div className="stats" style={{ marginTop: 10 }}>
                <div className="stat">
                  <div className="n">{plan.eligibleCount}</div>
                  <div className="l">対象工程数</div>
                </div>
                <div className="stat warn">
                  <div className="n">{plan.overloadedSlotCount}</div>
                  <div className="l">工数超過スロット</div>
                </div>
                <div className="stat bad">
                  <div className="n">{plan.moves.length}</div>
                  <div className="l">移動プラン</div>
                </div>
                <div className="stat">
                  <div className="n">{plan.unresolved.length}</div>
                  <div className="l">移動先が見つからず</div>
                </div>
                <div className="stat">
                  <div className="n">{plan.lockedSkipped}</div>
                  <div className="l">手動ロックで対象外</div>
                </div>
              </div>

              {plan.moves.length === 0 && plan.unresolved.length === 0 && (
                <div className="panel-note" style={{ marginTop: 10 }}>
                  この期間・条件では工数超過は見つかりませんでした。
                </div>
              )}

              {plan.moves.length > 0 && (
                <>
                  <div className="panel-note" style={{ marginTop: 10 }}>
                    移動プラン（優先順位の低いものから、空きのある日へ移動）
                  </div>
                  <div className="tablewrap" style={{ marginTop: 6 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>製造指図NO</th>
                          <th>工程</th>
                          <th>得意先</th>
                          <th>移動前</th>
                          <th>移動後</th>
                          <th>理由</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.moves.map((m, i) => (
                          <tr key={i}>
                            <td className="mono">{orderKeyOf(m.job)}</td>
                            <td>{m.job.processType}</td>
                            <td>{m.job.customer}</td>
                            <td className="mono">{m.fromDate}</td>
                            <td className="mono" style={{ fontWeight: 700 }}>
                              {m.toDate}
                            </td>
                            <td className="panel-note">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="toolbar" style={{ marginTop: 10 }}>
                    <button className="btn primary" onClick={applyPlan} disabled={applying}>
                      {applying ? "反映中…" : `▶ この内容で反映する（${plan.moves.length}件）`}
                    </button>
                  </div>
                </>
              )}

              {plan.unresolved.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="panel-note">移動先が見つからなかった工程（手動での調整をご検討ください）</div>
                  {plan.unresolved.map((u, i) => (
                    <div className="flagrow" key={i}>
                      <div style={{ flex: 1 }}>
                        <strong className="mono">{orderKeyOf(u.job)}</strong> {u.job.processType}（{u.job.customer}）・{u.job.plannedStart}〜
                        <div className="mono panel-note">{u.reason}</div>
                      </div>
                      <span className="warn over">⚠ 未解決</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
