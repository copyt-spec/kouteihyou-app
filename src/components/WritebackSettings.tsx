import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import { readBoardWriteback, writeBoardWriteback } from "../lib/boardStorage";
import { jobKey } from "../types/processJob";
import { fmtDT } from "../lib/dateUtils";
import {
  DATE_FORMAT_OPTIONS,
  WRITEBACK_FIELD_CATALOG,
  buildWritebackCsvText,
  csvTextToBlob,
  defaultWritebackConfig,
  isDateField,
  newWritebackColumn,
  pendingWritebackJobs,
  writebackFileName,
  type WritebackColumn,
  type WritebackConfig,
  type WritebackFieldKey,
} from "../lib/writeback";

// 書き戻し設定タブ（2026-09-23新設）。工程調整（ドラッグ・矢印キー・±1日/±1週ボタン）を行うと
// ProcessJob.pendingExportがtrueになる（src/lib/adjust.ts参照）。ここではその対象だけを、
// ボードごとに自由に設定できる列構成でCSV出力する。mcframe側にはデータを書き込む手段が無く
// 画面からの手入力のみのため、この工程表アプリからmcframeへ直接反映することはできない。
// 既に運用中のRPAがこのCSVを読み込んで画面入力する想定（設計ドキュメント参照）。
export function WritebackSettings() {
  const { boardId, jobs, boardProvider, lines, resources } = useGantt();
  const [config, setConfig] = useState<WritebackConfig>(() => readBoardWriteback(boardId));
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pending = pendingWritebackJobs(jobs);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }
  function update(fn: (c: WritebackConfig) => WritebackConfig) {
    setConfig((prev) => fn(prev));
    setDirty(true);
  }
  function save() {
    writeBoardWriteback(boardId, config);
    setDirty(false);
    showToast("設定を保存しました");
  }
  function reset() {
    const next = defaultWritebackConfig();
    setConfig(next);
    writeBoardWriteback(boardId, next);
    setDirty(false);
    showToast("初期状態に戻しました");
  }

  function addColumn() {
    update((c) => ({ ...c, columns: [...c.columns, newWritebackColumn()] }));
  }
  function removeColumn(id: string) {
    update((c) => ({ ...c, columns: c.columns.filter((col) => col.id !== id) }));
  }
  function moveColumn(id: string, dir: -1 | 1) {
    update((c) => {
      const idx = c.columns.findIndex((col) => col.id === id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= c.columns.length) return c;
      const cols = [...c.columns];
      [cols[idx], cols[swapWith]] = [cols[swapWith], cols[idx]];
      return { ...c, columns: cols };
    });
  }
  function patchColumn(id: string, patch: Partial<WritebackColumn>) {
    update((c) => ({ ...c, columns: c.columns.map((col) => (col.id === id ? { ...col, ...patch } : col)) }));
  }
  function changeField(id: string, field: WritebackFieldKey) {
    patchColumn(id, { field, dateFormat: isDateField(field) ? "ymd_hms_slash" : undefined });
  }

  function exportCsv() {
    if (pending.length === 0) return;
    const text = buildWritebackCsvText(pending, config, lines, resources);
    const blob = csvTextToBlob(text, config.encoding);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = writebackFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const exportedKeys = new Set(pending.map(jobKey));
    void boardProvider.clearPendingExport(exportedKeys, jobKey);
    showToast(`${pending.length}件をCSV出力しました`);
  }

  return (
    <div className="screenbody">
      <div className="panel panel-note">
        工程調整（ドラッグ・矢印キー・±1日/±1週ボタン）を行った工程だけを対象に、mcframeへの書き戻し用CSVを出力します。mcframe側には工程データを直接書き込む手段が無いため、出力したCSVはRPA（既に運用中）がmcframe画面への入力に使う想定です。列の項目・見出し・日付書式・文字コードはボードごとに自由に設定できます。「設定を保存」を押すまでは列構成の変更は反映されません（CSV出力自体は保存前の設定でも実行できます）。
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>出力対象（{pending.length}件）</h2>
          <span className="panel-note">工程調整後、まだ書き戻し（CSV出力）していない工程の一覧です</span>
        </div>
        {pending.length === 0 ? (
          <div className="panel-note">現在、書き戻し待ちの工程はありません。</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>製造指図NO</th>
                  <th>工程</th>
                  <th>得意先</th>
                  <th>品名</th>
                  <th>計画開始</th>
                  <th>計画終了</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((j) => (
                  <tr key={jobKey(j)}>
                    <td className="mono">{j.orderNumber || j.orderNo}</td>
                    <td>
                      {j.processSeq ? `工程${j.processSeq}` : ""} {j.processType}
                    </td>
                    <td>{j.customer}</td>
                    <td>{j.itemName || "—"}</td>
                    <td className="mono">{fmtDT(j.plannedStart)}</td>
                    <td className="mono">{fmtDT(j.plannedEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={exportCsv} disabled={pending.length === 0}>
            CSVを出力（{pending.length}件）
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>出力列の設定</h2>
          <div className="toolbar">
            <button className="btn ghost small" onClick={reset}>
              初期状態に戻す
            </button>
            <button className="btn primary" onClick={save} disabled={!dirty}>
              {dirty ? "設定を保存" : "保存済み"}
            </button>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <span>文字コード</span>
          <div className="segments">
            <button className={`segbtn ${config.encoding === "sjis" ? "active" : ""}`} onClick={() => update((c) => ({ ...c, encoding: "sjis" }))}>
              Shift-JIS
            </button>
            <button className={`segbtn ${config.encoding === "utf8" ? "active" : ""}`} onClick={() => update((c) => ({ ...c, encoding: "utf8" }))}>
              UTF-8
            </button>
          </div>
        </div>

        <div className="loadrowslist">
          {config.columns.map((col, i) => (
            <div className="loadrowitem wbcolitem" key={col.id}>
              <div className="wbcol-move">
                <button className="btn icon small" disabled={i === 0} onClick={() => moveColumn(col.id, -1)} title="上へ">
                  ▲
                </button>
                <button className="btn icon small" disabled={i === config.columns.length - 1} onClick={() => moveColumn(col.id, 1)} title="下へ">
                  ▼
                </button>
              </div>
              <select value={col.field} onChange={(e) => changeField(col.id, e.target.value as WritebackFieldKey)}>
                {WRITEBACK_FIELD_CATALOG.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <input type="text" value={col.header} onChange={(e) => patchColumn(col.id, { header: e.target.value })} placeholder="出力見出し" style={{ minWidth: 140 }} />
              {isDateField(col.field) && (
                <select value={col.dateFormat ?? "iso"} onChange={(e) => patchColumn(col.id, { dateFormat: e.target.value as WritebackColumn["dateFormat"] })}>
                  {DATE_FORMAT_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              <button className="lrremove" title="この列を削除" onClick={() => removeColumn(col.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="loadrowadd">
          <button className="btn small" onClick={addColumn}>
            ＋ 列を追加
          </button>
        </div>
      </div>

      {toast && <div className="mappingtoast">{toast}</div>}
    </div>
  );
}
