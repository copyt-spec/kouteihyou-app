import { useMemo, useRef, useState } from "react";
import { useGantt } from "../state/GanttContext";
import type { BoardDataProvider } from "../state/boardDataProvider";
import { fmtDate } from "../lib/dateUtils";
import { fmtHours } from "../lib/format";
import { readBoardMapping, readBoardAdjustmentLog } from "../lib/boardStorage";
import { computeMappingResult, uniqueFieldValues } from "../lib/mapping";
import { jobKey, orderKeyOf, type ProcessJob } from "../types/processJob";
import { planAutoAdjustment, type AutoAdjustPlan } from "../lib/autoAdjust";
import { detectAdjustmentPatterns, type DetectedPattern } from "../lib/adjustmentHistory";
import {
  WEEKDAY_KEYS,
  defaultDayHours,
  eachDate,
  effectiveCapacityForDay,
  hoursForDay,
  isWorkingDateWithConfig,
  isWorkingDayByCalendar,
  type CapacityConfig,
  type CapacityEvent,
  type CapacityUnit,
  type CalendarException,
  type ConstraintRule,
  type CustomCapacityItem,
  type PriorityRule,
  type Weekday,
} from "../lib/capacity";

// 稼働計画設定タブ（設計ドキュメント7章）。ライン・資源マスタと同じくボードごとに独立しており、
// ①持ち工数・②イベント登録は積み上げ工数・負荷率の計算に実際に反映される（capacity.ts参照）。
// ④カレンダーマスタの固定稼働曜日・例外日は、①の計算・③自動調整・ライン工程表／オーダー進捗表の
// 非稼働日表示に反映される。③条件フロー・実行は、指定期間の持ち工数超過を検出し、移動先を探索した
// うえで実際の工程表へ反映できる（2026-09-24、autoAdjust.ts参照。lineEligibility制約＝ライン変更は
// 品目⇔対応ラインマスタが未整備のため未実装のまま。7-7参照）。

const WD_LABEL: Record<Weekday, string> = { mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" };
const UNIT_LABEL: Record<CapacityUnit, string> = { line: "ライン", resource: "資源", processType: "工程", item: "品目" };
const UNIT_OPTIONS: [CapacityUnit, string][] = [
  ["line", "ライン別"],
  ["resource", "資源別"],
  ["processType", "工程別"],
  ["item", "品目別"],
];
const CRITERIA: [PriorityRule["criterion"], string][] = [
  ["dueDate", "納期が近い順"],
  ["customerPriority", "得意先優先度順"],
  ["specialOrderFlag", "特注案件を優先"],
  ["orderNumber", "製造指図番号順"],
];

const RAW_HOLIDAY: [string, string][] = [
  ["2026-10-12", "スポーツの日"],
  ["2026-11-03", "文化の日"],
  ["2026-11-23", "勤労感謝の日"],
];

interface UnitItem {
  id: string;
  name: string;
  custom?: boolean; // ユーザーがこの画面で自分で追加した任意項目（2026-09-23追加）
  orphaned?: boolean; // 過去に持ち工数／イベントの値を設定したが、現在の候補一覧には出てこなくなった項目（2026-09-23追加）
}
interface MappedNames {
  resource: string[];
  processType: string[];
  item: string[];
}
// 資源・工程・品目の対象アイテムは、①マスタ設定／実際の工程データに加え、②連携設定タブでのマッピング・
// 結合結果（重複除去済み）も選択肢に含める（2026-09-22追加、品目は2026-09-23追加）。連携設定を保存していない
// ボードでは②が空になるだけで、①のみでも従来どおり動作する。
// 資源のアイテムIDは資源名そのもの（Resource.idではない）を使う。ProcessJob.resourceは常に資源名で保持されており
// （マスタ設定でのRename時もこの値は変わらない）、資源名で統一することでジョブ側の資源値と食い違わないようにしている。
// 品目も同じ考え方で、品名（itemName。無ければ品目CD）を単位アイテムのIDとして使う。
function baseUnitItemsFor(unit: CapacityUnit, lines: { id: number; name: string }[], resources: { id: string; name: string }[], jobs: ProcessJob[], mapped: MappedNames): UnitItem[] {
  if (unit === "line") return lines.map((l) => ({ id: String(l.id), name: l.name }));
  if (unit === "resource") {
    const names = new Set<string>();
    resources.forEach((r) => names.add(r.name));
    mapped.resource.forEach((n) => names.add(n));
    return Array.from(names).sort().map((n) => ({ id: n, name: n }));
  }
  if (unit === "item") {
    const names = new Set<string>();
    jobs.forEach((j) => {
      const n = j.itemName || j.itemCode;
      if (n) names.add(n);
    });
    mapped.item.forEach((n) => names.add(n));
    return Array.from(names).sort().map((n) => ({ id: n, name: n }));
  }
  const names = new Set<string>(jobs.map((j) => j.processType).filter(Boolean));
  mapped.processType.forEach((n) => names.add(n));
  return Array.from(names).sort().map((n) => ({ id: n, name: n }));
}
// 持ち工数・イベント登録の実際の対象アイテム一覧 = ①自動的に検出された候補 ∪ ②ユーザーがこの画面で追加した
// カスタム項目 ∪ ③過去に値を設定したことがあるが①②のどちらにも現れなくなった項目（2026-09-23追加）。
// ③を union することで「一旦決めた持ち工数は、読み込み時に対象の工程や資源が見当たらなくても保存され、
// 消えずに残る」という要件を満たす（値そのものはconfig.baselineByUnit/eventsに残っているので、
// ここで一覧に出してあげないと編集・削除する手段が無くなってしまうため）。
function unitItemsFor(
  unit: CapacityUnit,
  lines: { id: number; name: string }[],
  resources: { id: string; name: string }[],
  jobs: ProcessJob[],
  mapped: MappedNames,
  customItems: CustomCapacityItem[],
  savedIds: Iterable<string>
): UnitItem[] {
  const base = baseUnitItemsFor(unit, lines, resources, jobs, mapped);
  const map = new Map<string, UnitItem>(base.map((it) => [it.id, it]));
  customItems.forEach((it) => {
    if (!map.has(it.id)) map.set(it.id, { id: it.id, name: it.name, custom: true });
  });
  for (const id of savedIds) {
    if (!map.has(id)) map.set(id, { id, name: id, orphaned: true });
  }
  return Array.from(map.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
function savedIdsForUnit(config: CapacityConfig, unit: CapacityUnit): Set<string> {
  const ids = new Set<string>(Object.keys(config.baselineByUnit[unit] ?? {}));
  config.events.forEach((ev) => {
    if (ev.unit === unit && ev.targetId) ids.add(ev.targetId);
  });
  return ids;
}
function unitItemName(items: UnitItem[], id: string | null): string {
  if (!id) return "";
  return items.find((i) => i.id === id)?.name ?? id;
}
function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// カスタム項目の追加・削除、および行の削除（カスタム項目自体の削除、または見当たらなくなった項目の
// 持ち工数値の削除）は①持ち工数・②イベント登録の両タブから共通で使うため、ここにまとめておく
function addCustomItem(patch: (fn: (c: CapacityConfig) => CapacityConfig) => void, unit: CapacityUnit, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  patch((c) => {
    const existing = c.customItemsByUnit[unit] ?? [];
    if (existing.some((it) => it.name === trimmed) || Object.prototype.hasOwnProperty.call(c.baselineByUnit[unit] ?? {}, trimmed)) return c; // 同名（既存の自動検出項目含む）は追加しない
    return { ...c, customItemsByUnit: { ...c.customItemsByUnit, [unit]: [...existing, { id: trimmed, name: trimmed }] } };
  });
}
// 行を一覧から削除する。カスタム項目ならcustomItemsByUnitから外し、あわせて保存済みの持ち工数値・
// イベントのtargetIdもクリアする（「削除」＝この項目の設定を完全に手放す操作という位置づけ）
function removeUnitItem(patch: (fn: (c: CapacityConfig) => CapacityConfig) => void, unit: CapacityUnit, id: string) {
  patch((c) => {
    const table = { ...c.baselineByUnit[unit] };
    delete table[id];
    const customList = (c.customItemsByUnit[unit] ?? []).filter((it) => it.id !== id);
    const events = c.events.filter((ev) => !(ev.unit === unit && ev.targetId === id));
    return {
      ...c,
      baselineByUnit: { ...c.baselineByUnit, [unit]: table },
      customItemsByUnit: { ...c.customItemsByUnit, [unit]: customList },
      events,
    };
  });
}
// 品目CSVインポート（2026-09-23追加）。「1列目=品目コード／品目名のどちらか、2列目=もう片方（任意）」という
// ゆるい形式を想定する簡易パーサー。ヘッダー行らしき行（1列目に「品目」「コード」「code」「id」等を含む）は
// スキップする。カンマ区切りのみサポート（プロトタイプのため、引用符でくくったフィールド等は非対応）
// ヘッダー行らしき1行目かどうか（「品目CD」「品目名」「コード」「name」等、見出し語で始まるセルを含むか判定。
// 前方一致にしているのは、"品目CD"のように見出し語＋接尾辞のセルが多いため。2行目以降はこの判定を行わない
// （品目名が偶然「品目」で始まるだけの行をヘッダー扱いしてスキップしてしまわないようにするため）
function looksLikeHeaderRow(cols: string[]): boolean {
  const pattern = /^(品目|コード|code|id|名称|名前)/i;
  return cols.some((c) => c && pattern.test(c));
}
function parseItemCsv(text: string): string[] {
  const names = new Set<string>();
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((line, i) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length === 0 || !cols[0]) return;
    if (i === 0 && looksLikeHeaderRow(cols)) return; // 1行目のみヘッダー判定
    const first = cols[0];
    const name = cols[1] && cols[1].trim() ? cols[1].trim() : first;
    names.add(name);
  });
  return Array.from(names);
}

export type CapacityModeId = "capacity" | "events" | "rules" | "calendar" | "customerPriority";

// initialMode：工程表画面（LineScreen/OrderScreen）に置いたAutoAdjustPanelの「詳細設定を開く」から
// 「③条件フロー・実行」タブを直接開いた状態でこの設定画面へ遷移できるようにするため（2026-09-24追加）
export function CapacitySettings({ initialMode }: { initialMode?: CapacityModeId } = {}) {
  const { boardId, jobs, lines, resources, capacityConfig, setCapacityConfig, boardProvider } = useGantt();
  const [mode, setMode] = useState<CapacityModeId>(initialMode ?? "capacity");

  // 連携設定タブで保存済みのマッピング・結合設定を読み込み、結果から資源名・工程名を重複除去して取り出す。
  // 連携設定タブは自動保存ではないため、ここで見るのは「保存済み」の内容（連携設定タブでの未保存の編集中の
  // 内容は含まない）。連携設定を開いて保存し直すと、次にこのタブを開いたときに反映される。
  const mappedNames = useMemo<MappedNames>(() => {
    const result = computeMappingResult(readBoardMapping(boardId));
    return { resource: uniqueFieldValues(result, "resourceName"), processType: uniqueFieldValues(result, "processType"), item: uniqueFieldValues(result, "itemName") };
  }, [boardId]);

  function patch(fn: (c: CapacityConfig) => CapacityConfig) {
    setCapacityConfig(fn);
  }

  return (
    <div className="screenbody">
      <div className="panel panel-note">
        ここでの①持ち工数・②イベント登録の設定は、ライン工程表・オーダー進捗表の積み上げ工数・負荷率にそのまま反映されます。④カレンダーマスタの固定稼働曜日・例外日は、持ち工数の計算・③自動調整・ライン工程表／オーダー進捗表の非稼働日表示に反映されます。③条件フロー・実行は、指定期間の持ち工数超過を検出し、移動先（同じライン／資源／工程／品目内の空いている稼働日）を探索したうえで、確認してから実際の工程表へ反映できます。工程表（ボード）ごとに完全に独立しており、他の工程表には影響しません。
      </div>
      <div className="segments">
        {(
          [
            ["capacity", "① 持ち工数"],
            ["events", "② イベント登録"],
            ["rules", "③ 条件フロー・実行"],
            ["calendar", "④ カレンダーマスタ"],
            ["customerPriority", "⑤ 得意先優先度"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`segbtn ${mode === id ? "active" : ""}`} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === "capacity" && <CapacityTab config={capacityConfig} patch={patch} lines={lines} resources={resources} jobs={jobs} mappedNames={mappedNames} />}
      {mode === "events" && <EventsTab config={capacityConfig} patch={patch} lines={lines} resources={resources} jobs={jobs} mappedNames={mappedNames} />}
      {mode === "rules" && <RulesTab config={capacityConfig} patch={patch} jobs={jobs} boardProvider={boardProvider} boardId={boardId} lines={lines} />}
      {mode === "calendar" && <CalendarTab config={capacityConfig} patch={patch} />}
      {mode === "customerPriority" && <CustomerPriorityTab config={capacityConfig} patch={patch} jobs={jobs} />}
    </div>
  );
}

/* ---------- ① 持ち工数 ---------- */
function CapacityTab({
  config,
  patch,
  lines,
  resources,
  jobs,
  mappedNames,
}: {
  config: CapacityConfig;
  patch: (fn: (c: CapacityConfig) => CapacityConfig) => void;
  lines: { id: number; name: string }[];
  resources: { id: string; name: string }[];
  jobs: ProcessJob[];
  mappedNames: MappedNames;
}) {
  const unit = config.capacityUnit;
  const dispUnit = config.capacityDisplayUnit;
  const customItems = config.customItemsByUnit[unit] ?? [];
  const savedIds = useMemo(() => savedIdsForUnit(config, unit), [config, unit]);
  const items = unitItemsFor(unit, lines, resources, jobs, mappedNames, customItems, savedIds);
  const [bulkSelected, setBulkSelected] = useState<Record<string, boolean>>({});
  const [bulkWeekdays, setBulkWeekdays] = useState<Record<Weekday, boolean>>({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true });
  const [bulkValue, setBulkValue] = useState(dispUnit === "minute" ? 480 : 8);
  const [newItemName, setNewItemName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvMessage, setCsvMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSelected = (id: string) => bulkSelected[id] !== false;
  const toDisplay = (h: number) => (dispUnit === "minute" ? Math.round(h * 60) : h);
  const fromDisplay = (v: number) => (dispUnit === "minute" ? v / 60 : v);
  const inputStep = dispUnit === "minute" ? 15 : 0.5;
  const inputMax = dispUnit === "minute" ? 1440 : 24;
  const unitLabel = dispUnit === "minute" ? "分" : "時間";

  function setCell(itemId: string, wd: Weekday, hours: number) {
    patch((c) => {
      const table = { ...c.baselineByUnit[unit] };
      const current = table[itemId] ?? defaultDayHours(8);
      table[itemId] = { ...current, [wd]: hours };
      return { ...c, baselineByUnit: { ...c.baselineByUnit, [unit]: table } };
    });
  }

  function bulkApply() {
    const hoursValue = fromDisplay(bulkValue);
    const targetItems = items.filter((it) => isSelected(it.id));
    const targetWds = WEEKDAY_KEYS.filter((k) => bulkWeekdays[k]);
    if (targetItems.length === 0 || targetWds.length === 0) return;
    patch((c) => {
      const table = { ...c.baselineByUnit[unit] };
      targetItems.forEach((it) => {
        const current = table[it.id] ?? defaultDayHours(8);
        const next = { ...current };
        targetWds.forEach((wd) => {
          next[wd] = hoursValue;
        });
        table[it.id] = next;
      });
      return { ...c, baselineByUnit: { ...c.baselineByUnit, [unit]: table } };
    });
  }

  function addNewItem() {
    addCustomItem(patch, unit, newItemName);
    setNewItemName("");
  }
  function importCsvNames(names: string[]) {
    if (names.length === 0) return;
    let added = 0;
    let skipped = 0;
    patch((c) => {
      const existing = c.customItemsByUnit[unit] ?? [];
      const existingNames = new Set([...existing.map((it) => it.name), ...Object.keys(c.baselineByUnit[unit] ?? {})]);
      const toAdd: CustomCapacityItem[] = [];
      names.forEach((n) => {
        if (existingNames.has(n)) {
          skipped++;
          return;
        }
        existingNames.add(n);
        toAdd.push({ id: n, name: n });
        added++;
      });
      if (toAdd.length === 0) return c;
      return { ...c, customItemsByUnit: { ...c.customItemsByUnit, [unit]: [...existing, ...toAdd] } };
    });
    setCsvMessage(`${added}件を追加しました${skipped > 0 ? `（${skipped}件は重複のためスキップ）` : ""}`);
    window.setTimeout(() => setCsvMessage(""), 4000);
  }
  async function handleCsvFile(file: File) {
    const text = await file.text();
    importCsvNames(parseItemCsv(text));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function importCsvPaste() {
    importCsvNames(parseItemCsv(csvText));
    setCsvText("");
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>持ち工数の対象単位</h2>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>何別</span>
            <select
              value={unit}
              onChange={(e) => {
                setBulkSelected({});
                patch((c) => ({ ...c, capacityUnit: e.target.value as CapacityUnit }));
              }}
            >
              {UNIT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>表示単位</span>
            <select value={dispUnit} onChange={(e) => patch((c) => ({ ...c, capacityDisplayUnit: e.target.value as "hour" | "minute" }))}>
              <option value="hour">時間</option>
              <option value="minute">分</option>
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>任意の項目を追加</h2>
          <span className="panel-note">マスタ設定・工程データ・連携設定の候補に無い{UNIT_LABEL[unit]}も、名前を決めて追加できます</span>
        </div>
        <div className="toolbar">
          <label className="field" style={{ minWidth: 220 }}>
            <span>{UNIT_LABEL[unit]}の名前</span>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addNewItem();
              }}
              placeholder={`例：${unit === "item" ? "特注専用品目X" : unit === "line" ? "予備ライン" : unit === "resource" ? "外注先A" : "検査（特別）"}`}
            />
          </label>
          <button className="btn small" onClick={addNewItem} disabled={!newItemName.trim()}>
            ＋ 追加
          </button>
        </div>
        {unit === "item" && (
          <div className="csvimport">
            <div className="panel-note" style={{ marginBottom: 8 }}>
              品目は件数が多くなりやすいため、CSVでまとめて登録できます（1行1件。1列目＝品目コードまたは品目名、2列目＝もう片方（任意）。ヘッダー行は自動でスキップします）
            </div>
            <div className="toolbar" style={{ flexWrap: "wrap" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsvFile(f);
                }}
              />
              <span className="panel-note">またはCSVをそのまま貼り付け：</span>
            </div>
            <textarea
              className="csvpaste"
              rows={3}
              placeholder={"品目CD,品目名\nITM-001,圧力容器ブラケット\nITM-002,配管フランジ"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div className="toolbar">
              <button className="btn small" onClick={importCsvPaste} disabled={!csvText.trim()}>
                貼り付けた内容を取り込む
              </button>
              {csvMessage && <span className="panel-note" style={{ color: "var(--sage)", fontWeight: 700 }}>{csvMessage}</span>}
            </div>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="panel panel-note">
          {unit === "line" ? "ラインがまだ登録されていません。「マスタ設定」タブから追加するか、上で任意の項目を追加してください。" : unit === "resource" ? "資源がまだ登録されていません。「マスタ設定」タブから追加するか、上で任意の項目を追加してください。" : unit === "item" ? "品目がまだありません。上で任意の項目を追加するか、CSVで取り込んでください。" : "工程データがまだないため、工程別の候補がありません。上で任意の項目を追加してください。"}
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h2>一括置き換え</h2>
              <span className="panel-note">チェックした{UNIT_LABEL[unit]}×曜日に、同じ値をまとめて反映します</span>
            </div>
            <div className="toolbar">
              <button className="btn small" onClick={() => setBulkSelected(Object.fromEntries(items.map((it) => [it.id, true])))}>
                全選択
              </button>
              <button className="btn small ghost" onClick={() => setBulkSelected(Object.fromEntries(items.map((it) => [it.id, false])))}>
                全解除
              </button>
            </div>
            <div className="wdchiprow">
              {WEEKDAY_KEYS.map((wd) => (
                <label className="wdchip" key={wd}>
                  <input type="checkbox" checked={bulkWeekdays[wd]} onChange={(e) => setBulkWeekdays((prev) => ({ ...prev, [wd]: e.target.checked }))} />
                  {WD_LABEL[wd]}
                </label>
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <label className="field">
                <span>値（{unitLabel}）</span>
                <input type="number" min={0} max={inputMax} step={inputStep} value={bulkValue} onChange={(e) => setBulkValue(Number(e.target.value) || 0)} />
              </label>
              <button className="btn primary" onClick={bulkApply}>
                選択した{UNIT_LABEL[unit]}に一括反映
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>{UNIT_LABEL[unit]}別・曜日別の基本工数（{unitLabel}）</h2>
            </div>
            <div className="tablewrap capgrid">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>{UNIT_LABEL[unit]}</th>
                    {WEEKDAY_KEYS.map((wd) => (
                      <th key={wd}>{WD_LABEL[wd]}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const b = config.baselineByUnit[unit][it.id] ?? defaultDayHours(8);
                    return (
                      <tr key={it.id}>
                        <td>
                          <input type="checkbox" checked={isSelected(it.id)} onChange={(e) => setBulkSelected((prev) => ({ ...prev, [it.id]: e.target.checked }))} />
                        </td>
                        <td>
                          <strong>{it.name}</strong>
                          {it.orphaned && <span className="badge orphaned">未検出</span>}
                          {it.custom && !it.orphaned && <span className="badge custom">追加項目</span>}
                        </td>
                        {WEEKDAY_KEYS.map((wd) => (
                          <td key={wd}>
                            <input
                              type="number"
                              min={0}
                              max={inputMax}
                              step={inputStep}
                              value={toDisplay(b[wd])}
                              onChange={(e) => setCell(it.id, wd, fromDisplay(Number(e.target.value) || 0))}
                            />
                          </td>
                        ))}
                        <td>
                          {(it.custom || it.orphaned) && (
                            <button
                              type="button"
                              className="btn small ghost danger"
                              title="この項目を削除します（持ち工数・イベントの設定も削除されます）"
                              onClick={() => {
                                if (window.confirm(`「${it.name}」を削除しますか？この項目に設定した持ち工数・イベントも削除されます。`)) {
                                  removeUnitItem(patch, unit, it.id);
                                }
                              }}
                            >
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="panel-note" style={{ marginTop: 10 }}>
              実際に使われる工数は、この基本工数に②イベントの増減を掛け合わせた「実効持ち工数」です（積み上げ工数・負荷率、②タブのプレビューに反映されます）。内部的には時間単位で保持しているため、表示単位を切り替えても計算結果には影響しません。
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- ② イベント登録 ---------- */
function EventsTab({
  config,
  patch,
  lines,
  resources,
  jobs,
  mappedNames,
}: {
  config: CapacityConfig;
  patch: (fn: (c: CapacityConfig) => CapacityConfig) => void;
  lines: { id: number; name: string }[];
  resources: { id: string; name: string }[];
  jobs: ProcessJob[];
  mappedNames: MappedNames;
}) {
  const [type, setType] = useState<CapacityEvent["type"]>("応援");
  const [evUnit, setEvUnit] = useState<CapacityUnit>("line");
  const [targetId, setTargetId] = useState("");
  const [dateFrom, setDateFrom] = useState(fmtDate(new Date()));
  const [dateTo, setDateTo] = useState("");
  const [hoursDelta, setHoursDelta] = useState(-4);
  const [note, setNote] = useState("");

  const [pvUnit, setPvUnit] = useState<CapacityUnit>(config.capacityUnit);
  const pvItems = unitItemsFor(pvUnit, lines, resources, jobs, mappedNames, config.customItemsByUnit[pvUnit] ?? [], savedIdsForUnit(config, pvUnit));
  const [pvItem, setPvItem] = useState("");
  const [pvFrom, setPvFrom] = useState(fmtDate(new Date()));
  const [pvTo, setPvTo] = useState(fmtDate(new Date(Date.now() + 6 * 86400000)));

  const evItems = unitItemsFor(evUnit, lines, resources, jobs, mappedNames, config.customItemsByUnit[evUnit] ?? [], savedIdsForUnit(config, evUnit));

  function addEvent() {
    if (!dateFrom) return;
    const ev: CapacityEvent = {
      id: newId("e"),
      type,
      unit: evUnit,
      dateFrom,
      dateTo: dateTo || dateFrom,
      targetId: targetId || null,
      hoursDelta,
      note: note.trim(),
    };
    patch((c) => ({ ...c, events: [...c.events, ev] }));
    setNote("");
  }
  function removeEvent(id: string) {
    patch((c) => ({ ...c, events: c.events.filter((e) => e.id !== id) }));
  }

  const sortedEvents = [...config.events].sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : 1));
  const previewItemId = pvItem || pvItems[0]?.id || "";
  const previewDates = eachDate(pvFrom, pvTo);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>イベント登録（応援・休暇）</h2>
          <span className="panel-note">登録した対象日・対象の持ち工数に自動反映されます</span>
        </div>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <label className="field">
            <span>種別</span>
            <select value={type} onChange={(e) => setType(e.target.value as CapacityEvent["type"])}>
              <option value="応援">応援</option>
              <option value="休暇">休暇</option>
              <option value="その他">その他</option>
            </select>
          </label>
          <label className="field">
            <span>対象日（から）</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>対象日（まで・任意）</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="field">
            <span>対象単位</span>
            <select
              value={evUnit}
              onChange={(e) => {
                setEvUnit(e.target.value as CapacityUnit);
                setTargetId("");
              }}
            >
              {UNIT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>対象</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">全{UNIT_LABEL[evUnit]}</option>
              {evItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>増減工数(h)</span>
            <input type="number" step={0.5} value={hoursDelta} onChange={(e) => setHoursDelta(Number(e.target.value) || 0)} />
          </label>
          <label className="field" style={{ minWidth: 160 }}>
            <span>備考</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="btn primary small" onClick={addEvent}>
            ＋ イベントを追加
          </button>
        </div>
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>種別</th>
                <th>対象日</th>
                <th>単位</th>
                <th>対象</th>
                <th>増減</th>
                <th>備考</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="panel-note">
                    イベントはまだありません
                  </td>
                </tr>
              ) : (
                sortedEvents.map((ev) => {
                  const items = unitItemsFor(ev.unit, lines, resources, jobs, mappedNames, config.customItemsByUnit[ev.unit] ?? [], savedIdsForUnit(config, ev.unit));
                  return (
                    <tr key={ev.id}>
                      <td>{ev.type}</td>
                      <td className="mono">
                        {ev.dateFrom}
                        {ev.dateTo !== ev.dateFrom ? " 〜 " + ev.dateTo : ""}
                      </td>
                      <td>{UNIT_LABEL[ev.unit]}</td>
                      <td>{ev.targetId ? unitItemName(items, ev.targetId) : `全${UNIT_LABEL[ev.unit]}`}</td>
                      <td className="mono" style={{ color: ev.hoursDelta >= 0 ? "var(--sage)" : "var(--rose)" }}>
                        {ev.hoursDelta >= 0 ? "+" : ""}
                        {ev.hoursDelta}h
                      </td>
                      <td>{ev.note}</td>
                      <td>
                        <button className="btn small ghost" onClick={() => removeEvent(ev.id)}>
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>実効持ち工数プレビュー</h2>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>単位</span>
            <select
              value={pvUnit}
              onChange={(e) => {
                setPvUnit(e.target.value as CapacityUnit);
                setPvItem("");
              }}
            >
              {UNIT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{UNIT_LABEL[pvUnit]}</span>
            <select value={previewItemId} onChange={(e) => setPvItem(e.target.value)}>
              {pvItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>から</span>
            <input type="date" value={pvFrom} onChange={(e) => setPvFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>まで</span>
            <input type="date" value={pvTo} onChange={(e) => setPvTo(e.target.value)} />
          </label>
        </div>
        {!previewItemId ? (
          <div className="panel-note" style={{ marginTop: 10 }}>
            {UNIT_LABEL[pvUnit]}がまだ登録されていません。
          </div>
        ) : (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>稼働日</th>
                  <th>基本工数</th>
                  <th>イベント増減</th>
                  <th>実効持ち工数</th>
                </tr>
              </thead>
              <tbody>
                {previewDates.map((d) => {
                  const day = new Date(d + "T00:00:00");
                  const working = isWorkingDateWithConfig(config, day);
                  const base = hoursForDay(config, pvUnit, previewItemId, day);
                  const eff = working ? effectiveCapacityForDay(config, pvUnit, previewItemId, day) : 0;
                  const delta = eff - base;
                  return (
                    <tr key={d}>
                      <td className="mono">{d}</td>
                      <td>{working ? "稼働" : "休業"}</td>
                      <td className="mono">{fmtHours(base, "h")}</td>
                      <td className="mono" style={{ color: delta >= 0 ? "var(--sage)" : "var(--rose)" }}>
                        {delta >= 0 ? "+" : ""}
                        {fmtHours(delta, "h")}
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {fmtHours(eff, "h")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- ③ 条件フロー・実行 ---------- */
function RulesTab({
  config,
  patch,
  jobs,
  boardProvider,
  boardId,
  lines,
}: {
  config: CapacityConfig;
  patch: (fn: (c: CapacityConfig) => CapacityConfig) => void;
  jobs: ProcessJob[];
  boardProvider: BoardDataProvider;
  boardId: string;
  lines: { id: number; name: string }[];
}) {
  const r = config.rules;
  const [simFrom, setSimFrom] = useState(fmtDate(new Date()));
  const [simTo, setSimTo] = useState(fmtDate(new Date(Date.now() + 5 * 86400000)));
  const [plan, setPlan] = useState<AutoAdjustPlan | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");

  // 手動調整パターンの検知・提案（設計ドキュメント7-10、2026-09-26追加）。
  // 手動調整（applyShift）のたびにjobsが更新されるため、jobsを依存に含めることで
  // そのタイミングでlocalStorage上の履歴を読み直し、検知結果を最新化している。
  const [dismissedPatternKeys, setDismissedPatternKeys] = useState<Set<string>>(new Set());
  const [suggestMessage, setSuggestMessage] = useState("");
  const detectedPatterns = useMemo(() => {
    const log = readBoardAdjustmentLog(boardId);
    return detectAdjustmentPatterns(log).filter((p) => !dismissedPatternKeys.has(p.key));
  }, [boardId, jobs, dismissedPatternKeys]);

  function lineNameOf(id: number | null): string {
    if (id == null) return "";
    return lines.find((l) => l.id === id)?.name || "";
  }

  function applyPatternSuggestion(p: DetectedPattern) {
    patch((c) => {
      const list = c.customerPriorityOrder.filter((n) => n !== p.customer);
      if (p.direction === "advance") list.unshift(p.customer);
      else list.push(p.customer);
      return { ...c, customerPriorityOrder: list };
    });
    setDismissedPatternKeys((s) => new Set(s).add(p.key));
    setSuggestMessage(`「${p.customer}」を得意先優先度（⑤タブ）に反映しました。並び順は⑤タブで確認・調整できます。`);
  }

  function dismissPatternSuggestion(p: DetectedPattern) {
    setDismissedPatternKeys((s) => new Set(s).add(p.key));
    setSuggestMessage("");
  }

  function updateRules(fn: (rr: typeof r) => typeof r) {
    patch((c) => ({ ...c, rules: fn(c.rules) }));
  }
  function movePriority(i: number, dir: -1 | 1) {
    updateRules((rr) => {
      const list = [...rr.priorityRules];
      const j = i + dir;
      if (j < 0 || j >= list.length) return rr;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...rr, priorityRules: list };
    });
  }

  function runSimulation() {
    setApplyMessage("");
    setPlan(planAutoAdjustment(jobs, config, simFrom, simTo, jobKey));
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
    <>
      {(detectedPatterns.length > 0 || suggestMessage) && (
        <div className="panel">
          <div className="panel-head">
            <h2>手動調整のパターンを検知しました</h2>
            <span className="panel-note">同じ組み合わせで繰り返し手動調整されている工程があります</span>
          </div>
          {detectedPatterns.length === 0 && suggestMessage && <div className="panel-note">現在、新たに提案できるパターンはありません。</div>}
          <div className="rulecards">
            {detectedPatterns.map((p) => (
              <div className="rulecard" key={p.key} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div>
                    <strong>{p.customer || "（得意先不明）"}</strong>
                    {p.processType ? ` / ${p.processType}` : ""}
                    {lineNameOf(p.factoryLineId) ? ` / ${lineNameOf(p.factoryLineId)}` : ""}
                    {p.resource ? ` / ${p.resource}` : ""}
                    　の工程が、直近 {p.count} 件とも「{p.direction === "advance" ? "前倒し" : "後ろ倒し"}」方向へ手動調整されています（平均 {Math.abs(p.avgDeltaDays).toFixed(1)} 日）。
                  </div>
                  <div className="panel-note" style={{ marginTop: 4 }}>
                    自動調整のパターンにしますか？　得意先優先度（⑤タブ）に反映すると、③自動調整の実行で同じ傾向が考慮されやすくなります。
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  <button className="btn small" onClick={() => applyPatternSuggestion(p)}>
                    得意先優先度に反映する
                  </button>
                  <button className="btn small ghost" onClick={() => dismissPatternSuggestion(p)} title="この提案を消す">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {suggestMessage && <div className="adjresult">{suggestMessage}</div>}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>① 対象工程の絞り込み</h2>
          <span className="panel-note">自動調整の対象にする工程の条件</span>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>列</span>
            <select value={r.eligibility.col} onChange={(e) => updateRules((rr) => ({ ...rr, eligibility: { ...rr.eligibility, col: e.target.value as typeof r.eligibility.col } }))}>
              <option value="processType">工程名</option>
              <option value="factoryLineCode">ラインCD</option>
              <option value="resource">資源</option>
              <option value="statusCode">状態</option>
            </select>
          </label>
          <label className="field">
            <span>演算子</span>
            <select value={r.eligibility.op} onChange={(e) => updateRules((rr) => ({ ...rr, eligibility: { ...rr.eligibility, op: e.target.value as "equals" | "notEquals" } }))}>
              <option value="equals">等しい</option>
              <option value="notEquals">等しくない</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            <span>値（カンマ区切り）</span>
            <input
              type="text"
              value={r.eligibility.values.join(",")}
              onChange={(e) => updateRules((rr) => ({ ...rr, eligibility: { ...rr.eligibility, values: e.target.value.split(",") } }))}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>② 優先順位ルール</h2>
          <span className="panel-note">上から順に評価し、同点なら次の基準で判定します</span>
        </div>
        <div className="rulecards">
          {r.priorityRules.map((p, i) => (
            <div className="rulecard" key={i}>
              <span className="idx mono">{i + 1}</span>
              <select value={p.criterion} onChange={(e) => updateRules((rr) => { const list = [...rr.priorityRules]; list[i] = { ...list[i], criterion: e.target.value as PriorityRule["criterion"] }; return { ...rr, priorityRules: list }; })}>
                {CRITERIA.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select value={p.direction} onChange={(e) => updateRules((rr) => { const list = [...rr.priorityRules]; list[i] = { ...list[i], direction: e.target.value as "asc" | "desc" }; return { ...rr, priorityRules: list }; })}>
                <option value="asc">昇順</option>
                <option value="desc">降順</option>
              </select>
              <div className="updown">
                <button disabled={i === 0} onClick={() => movePriority(i, -1)}>
                  ↑
                </button>
                <button disabled={i === r.priorityRules.length - 1} onClick={() => movePriority(i, 1)}>
                  ↓
                </button>
                <button onClick={() => updateRules((rr) => ({ ...rr, priorityRules: rr.priorityRules.filter((_, idx) => idx !== i) }))}>✕</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => updateRules((rr) => ({ ...rr, priorityRules: [...rr.priorityRules, { criterion: "dueDate", direction: "asc" }] }))}>
          ＋ 基準を追加
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>③ 制約条件</h2>
        </div>
        <div className="rulecards">
          {r.constraints.map((c: ConstraintRule, i) => (
            <label className="switchcard" key={c.type}>
              <span>
                {c.label}
                {c.type === "lineEligibility" && <span className="panel-note"> （未実装：品目⇔対応ラインマスタが未整備のため、④の探索はまだライン変更を行いません）</span>}
              </span>
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => updateRules((rr) => { const list = [...rr.constraints]; list[i] = { ...list[i], enabled: e.target.checked }; return { ...rr, constraints: list }; })}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>④ 自動調整の実行（この工程表の実データに反映）</h2>
        </div>
        <div className="toolbar">
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
        </div>
        {applyMessage && <div className="adjresult" style={{ marginTop: 10 }}>{applyMessage}</div>}
        {!plan ? (
          <div className="panel-note" style={{ marginTop: 10 }}>
            「自動調整を実行」を押すと、指定期間の工程を①〜③の条件に照らして、持ち工数を超過している日から空きのある日（同じライン／資源／工程／品目内、最大60日先まで、稼働日のみ）への移動プランを作成します。内容を確認したうえで「この内容で反映する」を押すと、実際の工程表（計画日程）に反映されます（まだ反映はされません）。
          </div>
        ) : plan.capacityCheckDisabled ? (
          <div className="panel-note" style={{ marginTop: 10 }}>
            ③制約条件の「持ち工数の上限を超えない」がOFFのため、超過検出・移動プランの作成はスキップされました（対象工程数：{plan.eligibleCount}件）。
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
                <div className="panel-note" style={{ marginTop: 10 }}>移動プラン（優先順位の低いものから、空きのある日へ移動）</div>
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
                          <td className="mono" style={{ fontWeight: 700 }}>{m.toDate}</td>
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
      </div>
    </>
  );
}

/* ---------- ④ カレンダーマスタ ---------- */
function CalendarTab({ config, patch }: { config: CapacityConfig; patch: (fn: (c: CapacityConfig) => CapacityConfig) => void }) {
  const cal = config.calendar;
  const [exDate, setExDate] = useState(fmtDate(new Date()));
  const [exType, setExType] = useState<"true" | "false">("false");
  const [exNote, setExNote] = useState("");

  function toggleWd(wd: Weekday) {
    patch((c) => ({ ...c, calendar: { ...c.calendar, fixedPattern: { ...c.calendar.fixedPattern, [wd]: !c.calendar.fixedPattern[wd] } } }));
  }
  function addException() {
    if (!exDate) return;
    const ex: CalendarException = { id: newId("x"), date: exDate, isWorkingDay: exType === "true", note: exNote.trim(), source: "manual" };
    patch((c) => ({ ...c, calendar: { ...c.calendar, exceptions: [...c.calendar.exceptions, ex] } }));
    setExNote("");
  }
  function removeException(id: string) {
    patch((c) => ({ ...c, calendar: { ...c.calendar, exceptions: c.calendar.exceptions.filter((e) => e.id !== id) } }));
  }
  function importHolidays() {
    patch((c) => {
      const existingDates = new Set(c.calendar.exceptions.map((e) => e.date));
      const added: CalendarException[] = RAW_HOLIDAY.filter(([d]) => !existingDates.has(d)).map(([d, name]) => ({ id: "h" + d, date: d, isWorkingDay: false, note: name, source: "holiday_import" as const }));
      return { ...c, calendar: { ...c.calendar, exceptions: [...c.calendar.exceptions, ...added] } };
    });
  }

  const [y, m] = cal.calendarMonth.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startOffset = firstDay.getDay();
  const cells: { iso: string; day: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d });
  }
  const dowHeader = ["日", "月", "火", "水", "木", "金", "土"];
  const sortedEx = [...cal.exceptions].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>固定の稼働曜日</h2>
          <span className="panel-note">クリックで稼働／休業を切り替えます</span>
        </div>
        <div className="wdrow">
          {WEEKDAY_KEYS.map((wd) => (
            <button key={wd} className={`wdbtn ${cal.fixedPattern[wd] ? "on" : "off"}`} onClick={() => toggleWd(wd)}>
              <span className="lbl">{WD_LABEL[wd]}</span>
              <span className="state">{cal.fixedPattern[wd] ? "稼働" : "休業"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>固定外の設定（例外日）</h2>
        </div>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>対象日</span>
            <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} />
          </label>
          <label className="field">
            <span>区分</span>
            <select value={exType} onChange={(e) => setExType(e.target.value as "true" | "false")}>
              <option value="true">特別稼働（本来休業だが稼働）</option>
              <option value="false">特別休業（本来稼働だが休業）</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            <span>備考</span>
            <input type="text" value={exNote} onChange={(e) => setExNote(e.target.value)} placeholder="例：月次棚卸のため" />
          </label>
          <button className="btn primary small" onClick={addException}>
            ＋ 例外を追加
          </button>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>区分</th>
                <th>備考</th>
                <th>由来</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedEx.length === 0 ? (
                <tr>
                  <td colSpan={5} className="panel-note">
                    例外はまだありません
                  </td>
                </tr>
              ) : (
                sortedEx.map((ex) => (
                  <tr key={ex.id}>
                    <td className="mono">{ex.date}</td>
                    <td>{ex.isWorkingDay ? "特別稼働" : "特別休業"}</td>
                    <td>{ex.note}</td>
                    <td className="mono panel-note">{ex.source === "holiday_import" ? "祝日取込" : "手動"}</td>
                    <td>
                      <button className="btn small ghost" onClick={() => removeException(ex.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>祝日ファイルの取り込み</h2>
        </div>
        <div className="panel-note" style={{ marginBottom: 10 }}>
          サンプル：内閣府の祝日データ想定。特別休業の例外としてまとめて登録します。
        </div>
        <div className="tablewrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>名称</th>
              </tr>
            </thead>
            <tbody>
              {RAW_HOLIDAY.map(([d, name]) => (
                <tr key={d}>
                  <td className="mono">{d}</td>
                  <td>{name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn small" onClick={importHolidays}>
          この内容を例外として取り込む
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>カレンダープレビュー</h2>
          <input type="month" value={cal.calendarMonth} onChange={(e) => patch((c) => ({ ...c, calendar: { ...c.calendar, calendarMonth: e.target.value } }))} />
        </div>
        <div className="calgrid">
          {dowHeader.map((d) => (
            <div className="dow" key={d}>
              {d}
            </div>
          ))}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div className="calcell empty" key={"empty" + i} />
          ))}
          {cells.map(({ iso, day }) => {
            const work = isWorkingDayByCalendar(config, iso);
            const ex = cal.exceptions.find((e) => e.date === iso);
            const tag = ex ? (ex.source === "holiday_import" ? "祝日" : "例外") : "";
            return (
              <div className={`calcell ${work ? "work" : "off"}`} key={iso}>
                <span className="mono">{day}</span>
                {tag && <span className="tag">{tag}</span>}
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span className="sw">
            <span className="dot" style={{ background: "var(--sage)" }} />
            稼働日
          </span>
          <span className="sw">
            <span className="dot" style={{ background: "var(--rose)" }} />
            休業日
          </span>
          <span className="sw">「祝日」「例外」タグ＝固定パターンから上書きされた日</span>
        </div>
      </div>
    </>
  );
}

/* ---------- ⑤ 得意先優先度 ---------- */
// 得意先優先度マスタ（2026-09-24追加）。③条件フローの優先順位ルールで「得意先優先度順」を選んだ場合の
// 判定基準。上（先頭）にあるほど優先度が高く、③自動調整で工数超過が起きた際に動かされにくくなる。
// 一覧に無い得意先は最下位（最優先度低）として扱われる（capacity.ts の customerPriorityRank 参照）
function CustomerPriorityTab({ config, patch, jobs }: { config: CapacityConfig; patch: (fn: (c: CapacityConfig) => CapacityConfig) => void; jobs: ProcessJob[] }) {
  const order = config.customerPriorityOrder;
  const [addValue, setAddValue] = useState("");

  const knownCustomers = useMemo(() => {
    const names = new Set<string>();
    jobs.forEach((j) => j.customer && names.add(j.customer));
    return Array.from(names).sort();
  }, [jobs]);
  const candidates = knownCustomers.filter((c) => !order.includes(c));

  function update(fn: (list: string[]) => string[]) {
    patch((c) => ({ ...c, customerPriorityOrder: fn(c.customerPriorityOrder) }));
  }
  function move(i: number, dir: -1 | 1) {
    update((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(name: string) {
    update((list) => list.filter((n) => n !== name));
  }
  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed || order.includes(trimmed)) return;
    update((list) => [...list, trimmed]);
    setAddValue("");
  }

  return (
    <>
      <div className="panel panel-note">
        上にあるほど優先度が高く、③条件フローの「得意先優先度順」ルールと、③自動調整の実行で工数超過が起きた際に動かされにくくなります。一覧に無い得意先は最下位（最優先度が低い）として扱われます。
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>優先順位（{order.length}件）</h2>
        </div>
        {order.length === 0 ? (
          <div className="panel-note">まだ登録されていません。すべての得意先が同列（最下位）として扱われます。</div>
        ) : (
          <div className="rulecards">
            {order.map((name, i) => (
              <div className="rulecard" key={name}>
                <span className="idx mono">{i + 1}</span>
                <span style={{ flex: 1 }}>{name}</span>
                <div className="updown">
                  <button disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button onClick={() => remove(name)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 10 }}>
          <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">この工程表に登場する得意先から追加…</option>
            {candidates.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input type="text" value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="得意先名を直接入力" style={{ minWidth: 200 }} />
          <button className="btn small" onClick={() => add(addValue)}>
            ＋ 追加
          </button>
        </div>
        {candidates.length > 0 && (
          <div className="panel-note" style={{ marginTop: 10 }}>
            未登録（最下位扱い）：{candidates.join("、")}
          </div>
        )}
      </div>
    </>
  );
}
