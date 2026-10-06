import { useState } from "react";
import { useGantt } from "../state/GanttContext";
import type { FactoryLine, Resource } from "../types/processJob";

// マスタ設定タブ（設計ドキュメント3-5・2026-09-22新設）。ライン・資源はこの工程表（ボード）専用で、
// 他のボードには一切影響しない。使用中（いずれかの工程から参照されている）の項目は削除できない。

function nextLineId(lines: FactoryLine[]): number {
  return lines.reduce((max, l) => Math.max(max, l.id), 0) + 1;
}
function newResourceId(): string {
  return "res_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

type Renaming = { kind: "line" | "resource"; id: string | number } | null;

export function MasterSettings() {
  const { jobs, lines, setLines, resources, setResources } = useGantt();
  const [newLineName, setNewLineName] = useState("");
  const [newLineCode, setNewLineCode] = useState("");
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceCode, setNewResourceCode] = useState("");
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [renameValue, setRenameValue] = useState("");
  // ラインCD入力欄（2026-09-23より複数コード対応。ライン1件ごとに追加用の入力を持つ）
  const [codeInputs, setCodeInputs] = useState<Record<number, string>>({});

  function splitCodes(raw: string): string[] {
    return Array.from(new Set(raw.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean)));
  }

  function lineUsageCount(id: number): number {
    return jobs.filter((j) => j.factoryLineId === id).length;
  }
  // ProcessJob.resourceは常に資源名（Resource.idではない）で保持されているため、名前で照合する
  // （2026-09-22修正。CapacitySettings.tsx/filters.ts/LineScreen.tsxと同じ理由）
  function resourceUsageCount(name: string): number {
    return jobs.filter((j) => j.resource === name).length;
  }

  function addLine() {
    const name = newLineName.trim();
    if (!name) return;
    const lineCodes = splitCodes(newLineCode);
    setLines((prev) => [...prev, { id: nextLineId(prev), name, lineCodes }]);
    setNewLineName("");
    setNewLineCode("");
  }
  function addResource() {
    const name = newResourceName.trim();
    if (!name) return;
    const resourceCode = newResourceCode.trim() || undefined;
    setResources((prev) => [...prev, { id: newResourceId(), name, resourceCode }]);
    setNewResourceName("");
    setNewResourceCode("");
  }
  function addLineCodes(id: number, raw: string) {
    const codes = splitCodes(raw);
    if (codes.length === 0) return;
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, lineCodes: Array.from(new Set([...(l.lineCodes ?? []), ...codes])) } : l))
    );
    setCodeInputs((prev) => ({ ...prev, [id]: "" }));
  }
  function removeLineCode(id: number, code: string) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, lineCodes: (l.lineCodes ?? []).filter((c) => c !== code) } : l)));
  }
  function updateResourceCode(id: string, code: string) {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, resourceCode: code.trim() || undefined } : r)));
  }
  // 連携設定タブの結果プレビュー（IntegrationSettings.tsx）が、このコードを使ってライン対応マスタ／資源マスタの
  // 結合結果をこの工程表のライン・資源に紐付ける（2026-09-23追加。ラインCDは同日より複数対応）。同じコードを
  // 2件以上のラインに付けると紐付け先があいまいになるため、該当のコードチップに警告を出す
  function duplicateLineCodeSet(): Set<string> {
    const counts = new Map<string, number>();
    lines.forEach((l) => (l.lineCodes ?? []).forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
    const dup = new Set<string>();
    counts.forEach((n, c) => {
      if (n > 1) dup.add(c);
    });
    return dup;
  }
  function duplicateResourceCode(r: Resource): boolean {
    return !!r.resourceCode && resources.some((x) => x.id !== r.id && x.resourceCode === r.resourceCode);
  }
  function deleteLine(l: FactoryLine) {
    const n = lineUsageCount(l.id);
    if (n > 0) {
      window.alert(`「${l.name}」は${n}件の工程で使用中のため削除できません。先に該当する工程のラインを変更してから削除してください。`);
      return;
    }
    if (window.confirm(`「${l.name}」を削除します。よろしいですか？`)) {
      setLines((prev) => prev.filter((x) => x.id !== l.id));
    }
  }
  function deleteResource(r: Resource) {
    const n = resourceUsageCount(r.name);
    if (n > 0) {
      window.alert(`「${r.name}」は${n}件の工程で使用中のため削除できません。先に該当する工程の資源を変更してから削除してください。`);
      return;
    }
    if (window.confirm(`「${r.name}」を削除します。よろしいですか？`)) {
      setResources((prev) => prev.filter((x) => x.id !== r.id));
    }
  }
  function startRename(kind: "line" | "resource", id: string | number, name: string) {
    setRenaming({ kind, id });
    setRenameValue(name);
  }
  function commitRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    if (renaming.kind === "line") {
      setLines((prev) => prev.map((l) => (l.id === renaming.id ? { ...l, name } : l)));
    } else {
      setResources((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, name } : r)));
    }
    setRenaming(null);
  }

  return (
    <div className="screenbody">
      <div className="panel panel-note">
        ここで登録したライン・資源だけが、この工程表のライン工程表・オーダー進捗表・フィルタ・負荷サマリの選択肢に表示されます。工程表（ボード）ごとに完全に独立しており、他の工程表には影響しません。
      </div>

      <div className="masterblock">
        <div className="masterblock-head">ライン一覧</div>
        <div className="masteradd">
          <input
            className="newboardinput"
            type="text"
            placeholder="新しいラインの名前（例：北条工場7）"
            value={newLineName}
            onChange={(e) => setNewLineName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addLine();
            }}
          />
          <input
            className="newboardinput codeinput"
            type="text"
            placeholder="ラインCD（任意・複数可。カンマ区切り）"
            value={newLineCode}
            onChange={(e) => setNewLineCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addLine();
            }}
          />
          <button className="btn small" onClick={addLine} disabled={!newLineName.trim()}>
            ＋ 追加
          </button>
        </div>
        <div className="panel-note" style={{ marginTop: -4, marginBottom: 10 }}>
          ラインCDは、連携設定タブで取り込む工程データ・ライン対応マスタの「ラインCD」列とこのラインを紐付けるための任意項目です。設定すると、連携設定の③結果プレビューでこのラインとして解決されているかを確認できます。同一ラインに複数のラインCDを登録できます（システム移行などで旧CD・新CDが混在する場合など）。カンマ・スペース区切りでまとめて入力できます。
        </div>
        {lines.length === 0 ? (
          <div className="panel-note">まだラインが登録されていません。</div>
        ) : (
          <div className="masterlist">
            {(() => {
              const dupCodes = duplicateLineCodeSet();
              return lines.map((l) => (
              <div className="masteritem" key={l.id}>
                {renaming?.kind === "line" && renaming.id === l.id ? (
                  <div className="masteritem-rename">
                    <input
                      className="newboardinput"
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button className="btn small" onClick={commitRename}>
                      保存
                    </button>
                    <button className="btn small" onClick={() => setRenaming(null)}>
                      キャンセル
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="masteritem-name">{l.name}</span>
                    <div className="codechips">
                      {(l.lineCodes ?? []).map((code) => (
                        <span key={code} className={`codechip ${dupCodes.has(code) ? "dup" : ""}`} title={dupCodes.has(code) ? "他のラインと同じラインCDが設定されています" : undefined}>
                          {code}
                          <button type="button" className="codechip-remove" onClick={() => removeLineCode(l.id, code)} title="このラインCDを削除">
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        className="codeinput inline"
                        type="text"
                        placeholder="＋ラインCD"
                        value={codeInputs[l.id] ?? ""}
                        onChange={(e) => setCodeInputs((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addLineCodes(l.id, codeInputs[l.id] ?? "");
                        }}
                        onBlur={() => {
                          if ((codeInputs[l.id] ?? "").trim()) addLineCodes(l.id, codeInputs[l.id] ?? "");
                        }}
                        title="連携設定でこのラインに紐付けるラインCD（任意・複数可）。Enterで追加"
                      />
                    </div>
                    <span className="masteritem-usage">{lineUsageCount(l.id)}件で使用中</span>
                    <div className="masteritem-actions">
                      <button className="btn small" onClick={() => startRename("line", l.id, l.name)}>
                        名前変更
                      </button>
                      <button className="btn small danger" onClick={() => deleteLine(l)}>
                        削除
                      </button>
                    </div>
                  </>
                )}
              </div>
              ));
            })()}
          </div>
        )}
      </div>

      <div className="masterblock">
        <div className="masterblock-head">資源一覧</div>
        <div className="masteradd">
          <input
            className="newboardinput"
            type="text"
            placeholder="新しい資源の名前（例：設備E、検査チーム3）"
            value={newResourceName}
            onChange={(e) => setNewResourceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addResource();
            }}
          />
          <input
            className="newboardinput codeinput"
            type="text"
            placeholder="資源CD（任意）"
            value={newResourceCode}
            onChange={(e) => setNewResourceCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addResource();
            }}
          />
          <button className="btn small" onClick={addResource} disabled={!newResourceName.trim()}>
            ＋ 追加
          </button>
        </div>
        <div className="panel-note" style={{ marginTop: -4, marginBottom: 10 }}>
          資源CDは、連携設定タブで取り込む資源マスタの「資源CD」列とこの資源を紐付けるための任意項目です。設定すると、連携設定の③結果プレビューでこの資源として解決されているかを確認できます。
        </div>
        {resources.length === 0 ? (
          <div className="panel-note">まだ資源が登録されていません。</div>
        ) : (
          <div className="masterlist">
            {resources.map((r) => (
              <div className="masteritem" key={r.id}>
                {renaming?.kind === "resource" && renaming.id === r.id ? (
                  <div className="masteritem-rename">
                    <input
                      className="newboardinput"
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button className="btn small" onClick={commitRename}>
                      保存
                    </button>
                    <button className="btn small" onClick={() => setRenaming(null)}>
                      キャンセル
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="masteritem-name">{r.name}</span>
                    <input
                      className={`codeinput inline ${duplicateResourceCode(r) ? "dup" : ""}`}
                      type="text"
                      placeholder="資源CD"
                      value={r.resourceCode ?? ""}
                      onChange={(e) => updateResourceCode(r.id, e.target.value)}
                      title={duplicateResourceCode(r) ? "他の資源と同じ資源CDが設定されています" : "連携設定でこの資源に紐付ける資源CD（任意）"}
                    />
                    <span className="masteritem-usage">{resourceUsageCount(r.name)}件で使用中</span>
                    <div className="masteritem-actions">
                      <button className="btn small" onClick={() => startRename("resource", r.id, r.name)}>
                        名前変更
                      </button>
                      <button className="btn small danger" onClick={() => deleteResource(r)}>
                        削除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
