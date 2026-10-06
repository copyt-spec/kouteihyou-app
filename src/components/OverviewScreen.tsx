import { useMemo, useState } from "react";
import type { Board, OverviewCombo } from "../types/board";
import type { FactoryLine, ProcessJob, Resource } from "../types/processJob";
import { defaultCapacityConfig, type CapacityConfig, type LoadRow, type LoadRowBasis } from "../lib/capacity";
import { LOAD_GROUP_BASES } from "../lib/filters";
import {
  listBoards,
  listOverviewCombos,
  readBoardCapacityConfig,
  readBoardJobs,
  readBoardLines,
  readBoardResources,
  writeOverviewCombos,
} from "../lib/boardStorage";
import {
  axisRangeFor,
  bucketDayLoads,
  computeDayLoads,
  enumerateDays,
  fiscalYearOf,
  periodStateFor,
  summarizePeriod,
  sumDayLoads,
  YEAR_WINDOW_SIZE,
  type OverviewGranularity,
  type PeriodLoad,
  type YearMode,
} from "../lib/loadCalc";
import { isWorkingDate } from "../lib/dateUtils";
import { fmtHours } from "../lib/format";
import { TODAY } from "../data/factory";

// 俯瞰ビュー（2026-09-23新設、同日中に改訂）。当初はボードごとにカレンダー形式のヒートマップを
// 並べる案で作ったが、「横に日付軸一本で、縦にボードを並べたい。日／月／年を切り替えられるように」
// というフィードバックを受けて、共通の横1本の日付軸（既存のOrderScreenの日付軸と同じ考え方）の下に、
// ボードごとの行を縦に並べる構成に作り直した（設計ドキュメント3-9参照）。

interface Props {
  onBack: () => void;
  onOpenBoard: (boardId: string) => void;
}

interface BoardData {
  board: Board;
  jobs: ProcessJob[];
  lines: FactoryLine[];
  resources: Resource[];
  capacityConfig: CapacityConfig;
}

const WD = ["月", "火", "水", "木", "金", "土", "日"];
const GRANULARITY_OPTIONS: [OverviewGranularity, string][] = [
  ["day", "日"],
  ["month", "月"],
  ["year", "年"],
];
const YEAR_MODE_OPTIONS: [YearMode, string][] = [
  ["calendar", "暦年"],
  ["fiscal", "年度（4月始まり）"],
];

function newComboId(): string {
  return "combo_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function anchorForToday(granularity: OverviewGranularity, yearMode: YearMode): Date {
  const t = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  if (granularity === "day" || granularity === "month") return t;
  // 年（年度）粒度：現在の年（度）がウィンドウの最後の列に来るように、開始年を逆算する
  const currentYear = yearMode === "fiscal" ? fiscalYearOf(t) : t.getFullYear();
  const startYear = currentYear - (YEAR_WINDOW_SIZE - 1);
  return yearMode === "fiscal" ? new Date(startYear, 3, 1) : new Date(startYear, 0, 1);
}

function PeriodCells({ periods }: { periods: PeriodLoad[] }) {
  return (
    <>
      {periods.map((p) => {
        const state = periodStateFor(p);
        let cls = "loadcell";
        if (state !== "none") cls += " " + state;
        const hoursText = p.hours > 0 ? fmtHours(p.hours, "h") : "";
        const rateText = p.hours > 0 && p.rate != null ? p.rate + "%" : "";
        const title = `${p.label}：積み上げ工数 ${fmtHours(p.hours, "h")}` + (p.capacity > 0 ? `／基準工数 ${fmtHours(p.capacity, "h")}／負荷率 ${p.rate ?? "—"}%` : "");
        return (
          <div className={cls} style={{ flex: 1 }} title={title} key={p.key}>
            <span className="lc-hours">{hoursText}</span>
            {rateText && <span className="lc-rate">{rateText}</span>}
          </div>
        );
      })}
    </>
  );
}

export function OverviewScreen({ onBack, onOpenBoard }: Props) {
  const [granularity, setGranularity] = useState<OverviewGranularity>("month");
  const [yearMode, setYearMode] = useState<YearMode>("calendar");
  const [anchor, setAnchor] = useState<Date>(() => anchorForToday("month", "calendar"));
  const [expanded, setExpanded] = useState<{ kind: "board" | "combo"; id: string } | null>(null);
  const [breakdownBasis, setBreakdownBasis] = useState<LoadRowBasis>("processType");
  const [comboFormOpen, setComboFormOpen] = useState(false);
  const [comboName, setComboName] = useState("");
  const [comboBoardIds, setComboBoardIds] = useState<string[]>([]);
  const [combos, setCombos] = useState<OverviewCombo[]>(() => listOverviewCombos());

  const boards = useMemo(() => listBoards(), []);
  const boardDatas: BoardData[] = useMemo(
    () =>
      boards.map((b) => ({
        board: b,
        jobs: readBoardJobs(b.id),
        lines: readBoardLines(b.id),
        resources: readBoardResources(b.id),
        capacityConfig: readBoardCapacityConfig(b.id),
      })),
    [boards]
  );
  const boardDataById = useMemo(() => new Map(boardDatas.map((bd) => [bd.board.id, bd])), [boardDatas]);

  const axisRange = useMemo(() => axisRangeFor(granularity, yearMode, anchor), [granularity, yearMode, anchor]);
  const days = useMemo(() => enumerateDays(axisRange.start, axisRange.end), [axisRange]);

  const totalRowDef: LoadRow = { id: "total", basis: null, value: null, label: "全体" };

  const headerPeriods = useMemo(
    () => bucketDayLoads(computeDayLoads([], [], defaultCapacityConfig(), totalRowDef, days), granularity, yearMode),
    [days, granularity, yearMode]
  );

  const boardRows = useMemo(
    () =>
      boardDatas.map((bd) => {
        const dayLoads = computeDayLoads(bd.jobs, bd.lines, bd.capacityConfig, totalRowDef, days);
        return { bd, dayLoads, periods: bucketDayLoads(dayLoads, granularity, yearMode) };
      }),
    [boardDatas, days, granularity, yearMode]
  );

  const comboRows = useMemo(
    () =>
      combos.map((combo) => {
        const members = combo.boardIds.map((id) => boardDataById.get(id)).filter((x): x is BoardData => !!x);
        const seriesList = members.map((bd) => computeDayLoads(bd.jobs, bd.lines, bd.capacityConfig, totalRowDef, days));
        const dayLoads = sumDayLoads(seriesList);
        return { combo, members, dayLoads, periods: bucketDayLoads(dayLoads, granularity, yearMode) };
      }),
    [combos, boardDataById, days, granularity, yearMode]
  );

  function changeGranularity(g: OverviewGranularity) {
    setGranularity(g);
    setAnchor(anchorForToday(g, yearMode));
  }
  function changeYearMode(ym: YearMode) {
    setYearMode(ym);
    setAnchor(anchorForToday(granularity, ym));
  }
  function shiftAnchor(delta: number) {
    if (granularity === "day") setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    else if (granularity === "month") setAnchor((prev) => new Date(prev.getFullYear() + delta, prev.getMonth(), 1));
    else setAnchor((prev) => new Date(prev.getFullYear() + delta * YEAR_WINDOW_SIZE, prev.getMonth(), 1));
  }
  function resetAnchor() {
    setAnchor(anchorForToday(granularity, yearMode));
  }

  const axisLabel = useMemo(() => {
    if (granularity === "day") return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
    if (granularity === "month") return yearMode === "fiscal" ? `${fiscalYearOf(anchor)}年度` : `${anchor.getFullYear()}年`;
    const startYear = anchor.getFullYear();
    const endYear = startYear + YEAR_WINDOW_SIZE - 1;
    return yearMode === "fiscal" ? `${startYear}〜${endYear}年度` : `${startYear}〜${endYear}年`;
  }, [granularity, yearMode, anchor]);

  function toggleExpand(kind: "board" | "combo", id: string) {
    setExpanded((prev) => (prev && prev.kind === kind && prev.id === id ? null : { kind, id }));
  }

  function saveCombos(next: OverviewCombo[]) {
    writeOverviewCombos(next);
    setCombos(next);
  }
  function submitComboForm() {
    const name = comboName.trim();
    if (!name || comboBoardIds.length < 2) return;
    const combo: OverviewCombo = { id: newComboId(), name, boardIds: comboBoardIds };
    saveCombos([...combos, combo]);
    setComboName("");
    setComboBoardIds([]);
    setComboFormOpen(false);
  }
  function deleteCombo(combo: OverviewCombo) {
    if (!window.confirm(`「${combo.name}」を削除します。よろしいですか？（元の工程表自体には影響しません）`)) return;
    saveCombos(combos.filter((c) => c.id !== combo.id));
    if (expanded?.kind === "combo" && expanded.id === combo.id) setExpanded(null);
  }
  function toggleComboBoardId(id: string) {
    setComboBoardIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const colCount = headerPeriods.length || 1;
  const colWidth = granularity === "day" ? 30 : granularity === "year" ? 140 : 60;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar-title">
          <button className="btn backbtn" onClick={onBack}>
            ← メインメニュー
          </button>
          <h1>俯瞰ビュー</h1>
          <span className="topbar-sub">全工程表の負荷率を横断してひと目で確認します。行をクリックすると内訳が開きます</span>
        </div>
      </div>

      <div className="toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="segments">
          {GRANULARITY_OPTIONS.map(([g, label]) => (
            <button key={g} className={`segbtn ${granularity === g ? "active" : ""}`} onClick={() => changeGranularity(g)}>
              {label}
            </button>
          ))}
        </div>
        {granularity !== "day" && (
          <div className="segments">
            {YEAR_MODE_OPTIONS.map(([ym, label]) => (
              <button key={ym} className={`segbtn ${yearMode === ym ? "active" : ""}`} onClick={() => changeYearMode(ym)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="datejump">
          <button className="btn icon" onClick={() => shiftAnchor(-1)}>
            ◀
          </button>
          <span className="rangeLabel mono">{axisLabel}</span>
          <button className="btn icon" onClick={() => shiftAnchor(1)}>
            ▶
          </button>
        </div>
        <button className="btn" onClick={resetAnchor}>
          現在
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="panel panel-note">工程表がまだありません。「工程表一覧」から作成してください。</div>
      ) : (
        <div className="gridscroll">
          <div className="ganttgrid" style={{ minWidth: Math.max(640, colCount * colWidth + 160) }}>
            <div className="axisrow">
              <div className="axis-rowlabel">工程表</div>
              <div className="axis-cols">
                {headerPeriods.map((p) => {
                  const weekend = granularity === "day" && !isWorkingDate(p.start);
                  return (
                    <div className={`axis-col ${weekend ? "weekend" : ""}`} style={{ flex: 1 }} key={p.key}>
                      {granularity === "day" ? (
                        <>
                          <span className="wd">{WD[(p.start.getDay() + 6) % 7]}</span>
                          <span className="d">{p.start.getDate()}</span>
                        </>
                      ) : (
                        <>
                          {p.yearHint && <span className="wd">{p.yearHint}</span>}
                          <span className="d">{p.label}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {combos.length > 0 && <div className="overview-section-label">合体ビュー</div>}
            {comboRows.map(({ combo, members, periods }) => {
              const summary = summarizePeriod(sumDayLoads(members.map((bd) => computeDayLoads(bd.jobs, bd.lines, bd.capacityConfig, totalRowDef, days))));
              const isExpanded = expanded?.kind === "combo" && expanded.id === combo.id;
              return (
                <div key={combo.id}>
                  <div className={`loadrow boardrow ${isExpanded ? "expanded" : ""}`}>
                    <button className="loadrow-label boardrow-label" onClick={() => toggleExpand("combo", combo.id)}>
                      <span className="lname">{combo.name}</span>
                      <span className={`boardrow-rate ${summary.utilizationRate != null ? (summary.utilizationRate > 100 ? "over" : summary.utilizationRate >= 80 ? "warn" : "ok") : ""}`}>
                        {summary.utilizationRate == null ? "—" : summary.utilizationRate + "%"}
                      </span>
                    </button>
                    <div className="loadrow-cells">
                      <PeriodCells periods={periods} />
                    </div>
                    <button
                      className="btn small ghost danger comborow-delete"
                      title="この合体を削除します（元の工程表自体は削除されません）"
                      onClick={() => deleteCombo(combo)}
                    >
                      解除
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="overviewbreakdown">
                      <div className="panel-note" style={{ padding: "6px 14px" }}>
                        内訳（工程表ごとの負荷）
                      </div>
                      {members.map((bd) => {
                        const memberDays = computeDayLoads(bd.jobs, bd.lines, bd.capacityConfig, totalRowDef, days);
                        const memberPeriods = bucketDayLoads(memberDays, granularity, yearMode);
                        return (
                          <div className="loadrow subrow" key={bd.board.id}>
                            <div className="loadrow-label">
                              <span className="lname">{bd.board.name}</span>
                            </div>
                            <div className="loadrow-cells">
                              <PeriodCells periods={memberPeriods} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="toolbar comboaddbar">
              <button className="btn small" onClick={() => setComboFormOpen((v) => !v)}>
                ＋ 工程表を合体
              </button>
            </div>
            {comboFormOpen && (
              <div className="panel combform">
                <label className="field" style={{ minWidth: 220 }}>
                  <span>合体の名前</span>
                  <input type="text" value={comboName} onChange={(e) => setComboName(e.target.value)} placeholder="例：北条工場 東エリア" />
                </label>
                <div className="combform-boards">
                  {boards.map((b) => (
                    <label key={b.id} className="combform-board">
                      <input type="checkbox" checked={comboBoardIds.includes(b.id)} onChange={() => toggleComboBoardId(b.id)} />
                      {b.name}
                    </label>
                  ))}
                </div>
                <div className="toolbar">
                  <button className="btn primary small" onClick={submitComboForm} disabled={!comboName.trim() || comboBoardIds.length < 2}>
                    作成
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      setComboFormOpen(false);
                      setComboName("");
                      setComboBoardIds([]);
                    }}
                  >
                    キャンセル
                  </button>
                  {comboBoardIds.length === 1 && <span className="panel-note">2件以上選んでください</span>}
                </div>
              </div>
            )}

            <div className="overview-section-label">工程表ごと</div>
            {boardRows.map(({ bd, dayLoads, periods }) => {
              const summary = summarizePeriod(dayLoads);
              const isExpanded = expanded?.kind === "board" && expanded.id === bd.board.id;
              const basisDef = LOAD_GROUP_BASES.find((b) => b.key === breakdownBasis)!;
              const breakdownItems = isExpanded ? basisDef.items({ jobs: bd.jobs, lines: bd.lines, resources: bd.resources }) : [];
              return (
                <div key={bd.board.id}>
                  <div className={`loadrow boardrow ${isExpanded ? "expanded" : ""}`}>
                    <button className="loadrow-label boardrow-label" onClick={() => toggleExpand("board", bd.board.id)}>
                      <span className="lname">{bd.board.name}</span>
                      <span className={`boardrow-rate ${summary.utilizationRate != null ? (summary.utilizationRate > 100 ? "over" : summary.utilizationRate >= 80 ? "warn" : "ok") : ""}`}>
                        {summary.utilizationRate == null ? "—" : summary.utilizationRate + "%"}
                      </span>
                    </button>
                    <div className="loadrow-cells">
                      <PeriodCells periods={periods} />
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="overviewbreakdown">
                      <div className="toolbar" style={{ padding: "6px 14px", flexWrap: "wrap" }}>
                        <span className="panel-note">内訳：</span>
                        <div className="segments">
                          {LOAD_GROUP_BASES.map((b) => (
                            <button key={b.key} className={`segbtn ${breakdownBasis === b.key ? "active" : ""}`} onClick={() => setBreakdownBasis(b.key)}>
                              {b.label}
                            </button>
                          ))}
                        </div>
                        <button className="btn small" onClick={() => onOpenBoard(bd.board.id)}>
                          この工程表を開く →
                        </button>
                      </div>
                      {breakdownItems.length === 0 ? (
                        <div className="panel-note" style={{ padding: "6px 14px" }}>
                          対象がありません
                        </div>
                      ) : (
                        breakdownItems.map((item) => {
                          const row: LoadRow = { id: breakdownBasis + ":" + item.value, basis: breakdownBasis, value: item.value, label: item.label };
                          const itemDays = computeDayLoads(bd.jobs, bd.lines, bd.capacityConfig, row, days);
                          const itemPeriods = bucketDayLoads(itemDays, granularity, yearMode);
                          return (
                            <div className="loadrow subrow" key={item.value}>
                              <div className="loadrow-label">
                                <span className="lname">{item.label}</span>
                              </div>
                              <div className="loadrow-cells">
                                <PeriodCells periods={itemPeriods} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
