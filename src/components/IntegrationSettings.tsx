import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import { readBoardMapping, writeBoardMapping } from "../lib/boardStorage";
import type { FactoryLine, Resource } from "../types/processJob";
import {
  FILES_META,
  FILE_ORDER,
  catalogOf,
  columnsOf,
  computeMappingResult,
  dataRowsOf,
  defaultMappingConfig,
  type FileId,
  type FilterOp,
  type MappingConfig,
} from "../lib/mapping";

// 連携設定タブ（設計ドキュメント2章）。mcframe出力（工程データ＋マスタ）を工程表の内部形式に変換する
// ルール（列マッピング・行フィルタ・結合／JOIN）を設定する。バックエンド連携はまだ未実装（1章参照）のため、
// サンプルのmcframe出力を模したモックデータでルールを試せる「設定＋プレビュー」画面。
// 「FactorySlot 連携設定」Artifactと同じ操作感（明示的な「設定を保存」ボタン）で、ボードごとに独立して保存する。

const OP_LABEL: Record<FilterOp, string> = { equals: "等しい", notEquals: "等しくない", in: "いずれかに一致", notIn: "いずれにも一致しない", contains: "含む" };

export function IntegrationSettings() {
  const { boardId, lines, resources } = useGantt();
  const [config, setConfig] = useState<MappingConfig>(() => readBoardMapping(boardId));
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function update(fn: (c: MappingConfig) => MappingConfig) {
    setConfig((prev) => fn(prev));
    setDirty(true);
  }
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }
  function save() {
    writeBoardMapping(boardId, config);
    setDirty(false);
    showToast("設定を保存しました");
  }
  function reset() {
    const next = defaultMappingConfig();
    setConfig(next);
    writeBoardMapping(boardId, next);
    setDirty(false);
    showToast("初期状態に戻しました");
  }

  const result = computeMappingResult(config);

  return (
    <div className="screenbody">
      <div className="panel panel-note">
        mcframeから出力される工程データ・マスタファイルを、この工程表の内部項目にどう割り当てるかを設定します。実際のファイル取り込み（バックエンド連携）はまだ未実装のため、下のプレビューはサンプルデータに対する確認用です。この設定は工程表（ボード）ごとに独立しており、「設定を保存」を押すまでは反映されません。
      </div>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="segments">
          {(
            [
              ["mapping", `① ファイルマッピング (${FILE_ORDER.length})`],
              ["join", `② 結合設定 (${config.joins.length})`],
              ["result", `③ 結果プレビュー (${result.joined.length})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`segbtn ${config.activeMode === id ? "active" : ""}`} onClick={() => update((c) => ({ ...c, activeMode: id }))}>
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <button className="btn ghost small" onClick={reset}>
            初期状態に戻す
          </button>
          <button className="btn primary" onClick={save} disabled={!dirty}>
            {dirty ? "設定を保存" : "保存済み"}
          </button>
        </div>
      </div>

      {config.activeMode === "mapping" && <MappingView config={config} update={update} />}
      {config.activeMode === "join" && <JoinView config={config} update={update} />}
      {config.activeMode === "result" && <ResultView config={config} result={result} lines={lines} resources={resources} />}

      {toast && <div className="mappingtoast">{toast}</div>}
    </div>
  );
}

/* ---------- ① ファイルマッピング ---------- */
function MappingView({ config, update }: { config: MappingConfig; update: (fn: (c: MappingConfig) => MappingConfig) => void }) {
  const fileId = config.activeFile;
  const meta = FILES_META[fileId];
  const st = config.files[fileId];
  const cols = columnsOf(config, fileId);
  const previewRows = meta.raw.slice(0, Math.max(st.headerRow + 5, 6));

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>対象ファイル</h2>
        </div>
        <div className="filepills">
          {FILE_ORDER.map((id) => {
            const mapped = Object.values(config.files[id].mapping).filter(Boolean).length;
            return (
              <button key={id} className={`filepill ${id === fileId ? "active" : ""} ${mapped > 0 ? "mapped" : ""}`} onClick={() => update((c) => ({ ...c, activeFile: id }))}>
                <span className="dot" />
                {FILES_META[id].label}
                <span className="sub">{mapped}/{columnsOf(config, id).length}列 割当済</span>
              </button>
            );
          })}
        </div>
        <div className="panel-note">プレビューの行番号をクリックすると、その行を列見出し（ヘッダー）として扱います。タイトル行や抽出条件行が混ざっている実出力を想定しています。</div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table className="rawtable">
            <tbody>
              {previewRows.map((row, ri) => {
                const isHeader = ri === st.headerRow;
                return (
                  <tr className={isHeader ? "header-row" : ""} key={ri}>
                    <td className="rownum" onClick={() => update((c) => ({ ...c, files: { ...c.files, [fileId]: { ...c.files[fileId], headerRow: ri } } }))}>
                      <span className="pick">{isHeader ? "✓ ヘッダー行" : "この行をヘッダーに"}</span>
                    </td>
                    {row.map((v, ci) => (
                      <td className={String(v || "").trim() === "" ? "dim" : ""} key={ci}>
                        {v || "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>列マッピング — {meta.label}</h2>
          <span className="panel-note">各列をどの項目として取り込むか選択します。結合に使う列は「結合キーにする」もチェックしてください。</span>
        </div>
        <div className="tablewrap">
          <table className="maptable">
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th className="col-head" key={i}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {cols.map((_c, i) => {
                  const cat = catalogOf(fileId);
                  const customs = st.customFields || [];
                  return (
                    <td key={i}>
                      <select
                        value={st.mapping[i] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__custom__") {
                            const name = window.prompt("項目名を入力してください");
                            if (!name || !name.trim()) return;
                            const value = "custom:" + name.trim();
                            update((c) => {
                              const files = { ...c.files };
                              const s = files[fileId];
                              const cf = s.customFields.some((x) => x.value === value) ? s.customFields : [...s.customFields, { value, label: name.trim() }];
                              files[fileId] = { ...s, customFields: cf, mapping: { ...s.mapping, [i]: value } };
                              return { ...c, files };
                            });
                            return;
                          }
                          update((c) => {
                            const files = { ...c.files };
                            files[fileId] = { ...files[fileId], mapping: { ...files[fileId].mapping, [i]: v || null } };
                            return { ...c, files };
                          });
                        }}
                      >
                        <option value="">未使用</option>
                        {cat.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                        {customs.map((cf) => (
                          <option key={cf.value} value={cf.value}>
                            {cf.label}
                          </option>
                        ))}
                        <option value="__custom__">＋ カスタム項目を追加…</option>
                      </select>
                      <label className="keytoggle">
                        <input
                          type="checkbox"
                          checked={!!st.keys[i]}
                          onChange={(e) =>
                            update((c) => {
                              const files = { ...c.files };
                              files[fileId] = { ...files[fileId], keys: { ...files[fileId].keys, [i]: e.target.checked } };
                              return { ...c, files };
                            })
                          }
                        />
                        結合キーにする
                      </label>
                    </td>
                  );
                })}
              </tr>
              {dataRowsOf(config, fileId).slice(0, 3).map((r, ri) => (
                <tr key={ri}>
                  {r.map((v, ci) => (
                    <td className="mono dim" key={ci}>
                      {v || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>行フィルタ — このファイルを工程表の対象にする条件</h2>
        </div>
        {fileId === "process_data" ? (
          <FilterSection config={config} update={update} fileId={fileId} cols={cols} />
        ) : (
          <div className="disclaimer">行フィルタはマスタファイルには通常不要ですが、必要であれば同様の設定を追加できます（今回は工程データのみに設定しています）。</div>
        )}
      </div>
    </>
  );
}

function FilterSection({ config, update, fileId, cols }: { config: MappingConfig; update: (fn: (c: MappingConfig) => MappingConfig) => void; fileId: FileId; cols: string[] }) {
  const f = config.filters[fileId] || { combinator: "AND" as const, rules: [] };
  const total = dataRowsOf(config, fileId).length;
  const passCount = dataRowsOf(config, fileId).filter((r) => {
    if (!f.rules.length) return true;
    const results = f.rules.map((rule) => {
      const v = String(r[rule.col] ?? "").trim();
      const vals = (rule.values || []).map((x) => x.trim()).filter((x) => x !== "");
      switch (rule.op) {
        case "equals": return vals.length === 0 || vals.includes(v);
        case "notEquals": return vals.length === 0 || !vals.includes(v);
        case "in": return vals.length === 0 || vals.includes(v);
        case "notIn": return vals.length === 0 || !vals.includes(v);
        case "contains": return vals.length === 0 || vals.some((x) => v.includes(x));
        default: return true;
      }
    });
    return f.combinator === "OR" ? results.some(Boolean) : results.every(Boolean);
  }).length;

  function setFilter(next: typeof f) {
    update((c) => ({ ...c, filters: { ...c.filters, [fileId]: next } }));
  }

  return (
    <>
      {f.rules.length > 1 && (
        <div className="combinator">
          条件の組み合わせ：
          <select value={f.combinator} onChange={(e) => setFilter({ ...f, combinator: e.target.value as "AND" | "OR" })}>
            <option value="AND">すべて満たす（AND）</option>
            <option value="OR">いずれか満たす（OR）</option>
          </select>
        </div>
      )}
      <div className="rulelist">
        {f.rules.length === 0 ? (
          <div className="panel-note">条件がありません（全行が対象になります）</div>
        ) : (
          f.rules.map((rule, ri) => (
            <div className="rule" key={ri}>
              <select value={rule.col} onChange={(e) => { const rules = [...f.rules]; rules[ri] = { ...rules[ri], col: Number(e.target.value) }; setFilter({ ...f, rules }); }}>
                {cols.map((c, i) => (
                  <option key={i} value={i}>
                    {c}
                  </option>
                ))}
              </select>
              <select value={rule.op} onChange={(e) => { const rules = [...f.rules]; rules[ri] = { ...rules[ri], op: e.target.value as FilterOp }; setFilter({ ...f, rules }); }}>
                {Object.entries(OP_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                className="values"
                type="text"
                placeholder="値をカンマ区切りで（例: 9,取消）"
                defaultValue={(rule.values || []).join(",")}
                onBlur={(e) => { const rules = [...f.rules]; rules[ri] = { ...rules[ri], values: e.target.value.split(",") }; setFilter({ ...f, rules }); }}
              />
              <button className="btn small ghost" onClick={() => setFilter({ ...f, rules: f.rules.filter((_, i) => i !== ri) })}>
                削除
              </button>
            </div>
          ))
        )}
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn small" onClick={() => setFilter({ ...f, rules: [...f.rules, { col: 0, op: "equals" as FilterOp, values: [] }] })}>
          ＋ 条件を追加
        </button>
        <span className="filter-badge mono">
          対象 {passCount} / {total} 行
        </span>
      </div>
    </>
  );
}

/* ---------- ② 結合設定 ---------- */
function JoinView({ config, update }: { config: MappingConfig; update: (fn: (c: MappingConfig) => MappingConfig) => void }) {
  const baseCols = columnsOf(config, "process_data");
  const masterFiles = FILE_ORDER.filter((id) => id !== "process_data");
  const [draftBaseKey, setDraftBaseKey] = useState(0);
  const [draftTarget, setDraftTarget] = useState<FileId>(masterFiles[0]);
  const [draftTargetKey, setDraftTargetKey] = useState(0);
  const [draftImportCols, setDraftImportCols] = useState<number[]>([]);
  const targetCols = columnsOf(config, draftTarget);

  function addJoin() {
    if (draftImportCols.length === 0) return;
    update((c) => ({
      ...c,
      joins: [...c.joins, { id: "j" + Date.now(), baseKeyCol: draftBaseKey, targetFile: draftTarget, targetKeyCol: draftTargetKey, importCols: draftImportCols }],
    }));
    setDraftImportCols([]);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>結合（JOIN）ルール</h2>
        <span className="panel-note">工程データのキー列と、マスタファイルのキー列を突き合わせて情報をくっつけます</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {config.joins.length === 0 ? (
          <div className="panel-note">結合ルールがまだ登録されていません。</div>
        ) : (
          config.joins.map((j) => {
            const tCols = columnsOf(config, j.targetFile);
            return (
              <div className="joincard" key={j.id}>
                <div className="joinstep">
                  <span className="lbl">起点キー列</span>
                  <span className="val mono">{baseCols[j.baseKeyCol]}</span>
                </div>
                <span className="arrow">⇄</span>
                <div className="joinstep">
                  <span className="lbl">対象マスタ</span>
                  <span className="val">{FILES_META[j.targetFile].label}</span>
                </div>
                <div className="joinstep">
                  <span className="lbl">対象キー列</span>
                  <span className="val mono">{tCols[j.targetKeyCol]}</span>
                </div>
                <span className="arrow">→</span>
                <div className="joinstep">
                  <span className="lbl">取り込む項目</span>
                  <div className="chipfields">
                    {j.importCols.map((ci) => (
                      <span className="chip" key={ci}>
                        {tCols[ci]}
                      </span>
                    ))}
                  </div>
                </div>
                <button className="btn small ghost" style={{ marginLeft: "auto" }} onClick={() => update((c) => ({ ...c, joins: c.joins.filter((x) => x.id !== j.id) }))}>
                  削除
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="joinform">
        <label className="field">
          <span>起点キー列（工程データ）</span>
          <select value={draftBaseKey} onChange={(e) => setDraftBaseKey(Number(e.target.value))}>
            {baseCols.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>対象マスタ</span>
          <select
            value={draftTarget}
            onChange={(e) => {
              setDraftTarget(e.target.value as FileId);
              setDraftTargetKey(0);
              setDraftImportCols([]);
            }}
          >
            {masterFiles.map((id) => (
              <option key={id} value={id}>
                {FILES_META[id].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>対象キー列</span>
          <select value={draftTargetKey} onChange={(e) => setDraftTargetKey(Number(e.target.value))}>
            {targetCols.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>取り込む項目</span>
          <div className="checklist">
            {targetCols.map((c, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={draftImportCols.includes(i)}
                  onChange={(e) => setDraftImportCols((prev) => (e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)))}
                />
                {c}
              </label>
            ))}
          </div>
        </div>
        <button className="btn primary small" onClick={addJoin}>
          ＋ 結合ルールを追加
        </button>
      </div>
    </div>
  );
}

/* ---------- ③ 結果プレビュー ---------- */
function statusMeta(code: string | number | null | undefined): [string, string] {
  const map: Record<string, [string, string]> = { "0": ["未指図", "other"], "1": ["未着手", "other"], "2": ["仕掛中", "active"], "3": ["完了", "done"], "9": ["取消", "other"] };
  return map[String(code)] || [String(code ?? "—"), "other"];
}

// ラインCD／資源CDによる、この工程表（マスタ設定）への紐付け解決（2026-09-23追加）。
// 連携設定のライン対応マスタ／資源マスタとの結合（j2/j3）は、あくまで「工程データのラインCD／資源CDを、
// 連携設定内の別名称（工場名／資源名）に変換する」ところまでで、その名称がこの工程表（マスタ設定タブで
// 登録したライン・資源）のどれに対応するのかまでは保証しない。マスタ設定でラインCD／資源CDを登録して
// あればそれを優先的なキーとして突き合わせ、未登録の場合は名前の一致にフォールバックする（既存ボードとの
// 後方互換のため）。どちらでも一致しなければ「未登録」として警告表示する
interface ResolveInfo {
  display: string;
  matched: boolean;
  hasRaw: boolean;
}
function resolveLineInfo(rec: Record<string, unknown>, lines: FactoryLine[]): ResolveInfo {
  const rawCode = rec.factoryLineCode as string | undefined;
  const joinedName = rec["j_j2_factoryName"] as string | undefined;
  const byCode = rawCode ? lines.find((l) => l.lineCodes && l.lineCodes.includes(rawCode)) : undefined;
  const byName = !byCode && joinedName ? lines.find((l) => l.name === joinedName) : undefined;
  const matched = byCode || byName;
  return { display: matched ? matched.name : joinedName || rawCode || "—", matched: !!matched, hasRaw: !!(rawCode || joinedName) };
}
function resolveResourceInfo(rec: Record<string, unknown>, resources: Resource[]): ResolveInfo {
  const rawCode = rec.resourceCode as string | undefined;
  const joinedName = rec["j_j3_resourceName"] as string | undefined;
  const byCode = rawCode ? resources.find((r) => r.resourceCode && r.resourceCode === rawCode) : undefined;
  const byName = !byCode && joinedName ? resources.find((r) => r.name === joinedName) : undefined;
  const matched = byCode || byName;
  return { display: matched ? matched.name : joinedName || rawCode || "—", matched: !!matched, hasRaw: !!(rawCode || joinedName) };
}

function ResultView({
  config,
  result,
  lines,
  resources,
}: {
  config: MappingConfig;
  result: ReturnType<typeof computeMappingResult>;
  lines: FactoryLine[];
  resources: Resource[];
}) {
  const unresolvedLineCount = result.joined.filter((rec) => {
    if (!rec.orderNumber) return false; // 未指図行はラインが確定していないため対象外
    const info = resolveLineInfo(rec, lines);
    return info.hasRaw && !info.matched;
  }).length;
  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>結合・フィルタ適用後のプレビュー</h2>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="n">{result.totalRaw}</div>
            <div className="l">取込行数（工程データ）</div>
          </div>
          <div className="stat good">
            <div className="n">{result.afterFilter}</div>
            <div className="l">フィルタ後（対象行）</div>
          </div>
          <div className="stat">
            <div className="n">{config.joins.length}</div>
            <div className="l">結合ルール数</div>
          </div>
          <div className={`stat ${result.unmatchedCount > 0 ? "warn" : ""}`}>
            <div className="n">{result.unmatchedCount}</div>
            <div className="l">未マッチ件数</div>
          </div>
          <div className={`stat ${unresolvedLineCount > 0 ? "warn" : ""}`}>
            <div className="n">{unresolvedLineCount}</div>
            <div className="l">未登録ラインCD件数</div>
          </div>
        </div>
        <div className="panel-note" style={{ marginTop: 10 }}>
          「未登録ラインCD件数」は、ライン対応マスタとの結合自体は成功しているものの、その結果（工場名）がこの工程表のマスタ設定に登録したラインのどれにも一致しない件数です。マスタ設定タブでラインCD（または同じ名前）を登録すると解消されます。
        </div>
        <div className="tablewrap" style={{ marginTop: 14 }}>
          <table className="resulttable">
            <thead>
              <tr>
                <th>指図-工程</th>
                <th>ライン</th>
                <th>得意先</th>
                <th>品名／工程</th>
                <th>計画期間</th>
                <th>数量（進捗）</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {result.joined.map((rec, i) => {
                const [slabel, sclass] = statusMeta(rec.statusCode);
                const plannedQuantity = Number(rec.plannedQuantity) || 0;
                const progress = plannedQuantity > 0 ? Math.round(((Number(rec.actualQuantity) || 0) / plannedQuantity) * 100) : 0;
                const custName = (rec["j_j1_customerName"] as string) || (rec.customerCode as string);
                const lineInfo = resolveLineInfo(rec, lines);
                const resourceInfo = resolveResourceInfo(rec, resources);
                const isPreOrder = !rec.orderNumber;
                return (
                  <tr key={i}>
                    <td className="mono">
                      {isPreOrder ? (
                        <>
                          {rec.orderNo}
                          <div className="mono dim" style={{ fontSize: 10 }}>
                            （未指図）
                          </div>
                        </>
                      ) : (
                        `${rec.orderNumber}-${rec.processSeq}`
                      )}
                    </td>
                    <td>
                      {isPreOrder ? (
                        "未定"
                      ) : (
                        <>
                          {lineInfo.display}
                          {!lineInfo.matched && lineInfo.hasRaw && <span className="unmatched">⚠ 未登録</span>}
                        </>
                      )}
                      {resourceInfo.hasRaw && !isPreOrder && (
                        <div className="mono dim" style={{ fontSize: 10 }}>
                          資源:{resourceInfo.display}
                          {!resourceInfo.matched && <span className="unmatched">⚠</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      {custName}
                      {!rec["j_j1_customerName"] && <span className="unmatched">⚠ 未マッチ</span>}
                    </td>
                    <td>
                      {rec.itemName}
                      <div className="mono dim" style={{ fontSize: 10.5 }}>
                        {rec.processType}
                      </div>
                    </td>
                    <td className="mono">{isPreOrder ? "未確定" : `${rec.plannedStart} 〜 ${String(rec.plannedEnd || "").split(" ")[1] || ""}`}</td>
                    <td className="mono">
                      {rec.actualQuantity}/{rec.plannedQuantity}（{progress}%）
                    </td>
                    <td>
                      <span className={`statuspill ${sclass}`}>{slabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="disclaimer" style={{ marginTop: 12 }}>
          ※ 上記は設定確認用のサンプルデータです。実際のmcframe CSV出力が確認でき次第、列見出し・初期マッピングを実データに合わせて調整します。木村産業（C010）はあえて得意先マスタに未登録にし、未マッチ時の表示を確認できるようにしています。
        </div>
      </div>
    </>
  );
}
