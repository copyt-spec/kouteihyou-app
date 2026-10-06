import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { FactoryLine, ProcessJob, Resource } from "../types/processJob";
import { TODAY } from "../data/factory";
import {
  readBoardCapacityConfig,
  readBoardLines,
  readBoardResources,
  touchBoard,
  viewKey,
  writeBoardCapacityConfig,
  writeBoardLines,
  writeBoardResources,
} from "../lib/boardStorage";
import { type CapacityConfig } from "../lib/capacity";
import { createLocalBoardProvider, type BoardDataProvider } from "./boardDataProvider";
import { DEFAULT_VIEW_STATE, type JobSelection, type PersistedViewState } from "./types";

interface GanttContextValue {
  boardId: string;
  jobs: ProcessJob[];
  // 工程調整・書き戻しはこの窓口越しに行う（直接setJobsする手段はもう無い。boardDataProvider.ts参照）
  boardProvider: BoardDataProvider;
  lines: FactoryLine[];
  setLines: React.Dispatch<React.SetStateAction<FactoryLine[]>>;
  resources: Resource[];
  setResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  capacityConfig: CapacityConfig;
  setCapacityConfig: React.Dispatch<React.SetStateAction<CapacityConfig>>;
  view: PersistedViewState;
  updateView: (patch: Partial<PersistedViewState>) => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  orderAnchor: Date;
  setOrderAnchor: (d: Date) => void;
  selectedJob: string | null;
  setSelectedJob: (k: string | null) => void;
  selection: JobSelection | null;
  setSelection: (s: JobSelection | null) => void;
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  expandedLineRow: string | null;
  setExpandedLineRow: (id: string | null) => void;
  filterSearch: string;
  setFilterSearch: (s: string) => void;
}

const GanttContext = createContext<GanttContextValue | null>(null);

function loadPersistedView(boardId: string): PersistedViewState {
  try {
    const saved = localStorage.getItem(viewKey(boardId));
    if (!saved) return DEFAULT_VIEW_STATE;
    const p = JSON.parse(saved);
    return {
      screen: p.screen || DEFAULT_VIEW_STATE.screen,
      view: p.view || DEFAULT_VIEW_STATE.view,
      groupBy: p.groupBy || DEFAULT_VIEW_STATE.groupBy,
      lineAxis: p.lineAxis === "v" || p.lineAxis === "h" ? p.lineAxis : DEFAULT_VIEW_STATE.lineAxis,
      orderSpanKey: p.orderSpanKey || DEFAULT_VIEW_STATE.orderSpanKey,
      orderLabelFields: p.orderLabelFields ? { ...DEFAULT_VIEW_STATE.orderLabelFields, ...p.orderLabelFields } : DEFAULT_VIEW_STATE.orderLabelFields,
      filterConditions: Array.isArray(p.filterConditions) ? p.filterConditions : DEFAULT_VIEW_STATE.filterConditions,
      loadRows: Array.isArray(p.loadRows) && p.loadRows.some((r: { id: string }) => r.id === "total") ? p.loadRows : DEFAULT_VIEW_STATE.loadRows,
      hoursUnit: p.hoursUnit === "min" || p.hoursUnit === "h" ? p.hoursUnit : DEFAULT_VIEW_STATE.hoursUnit,
    };
  } catch {
    return DEFAULT_VIEW_STATE;
  }
}

export function GanttProvider({ boardId, children }: { boardId: string; children: React.ReactNode }) {
  // <GanttProvider boardId={boardId} key={boardId}>で呼ばれているため（BoardView.tsx参照）、ボードを
  // 切り替えるとこのコンポーネントごと再マウントされる。よってboardProviderはマウント時に1回作ればよい
  const [boardProvider] = useState<BoardDataProvider>(() => createLocalBoardProvider(boardId));
  const [jobs, setJobs] = useState<ProcessJob[]>(() => boardProvider.getJobs());
  useEffect(() => {
    return boardProvider.subscribe(setJobs);
  }, [boardProvider]);
  const [lines, setLines] = useState<FactoryLine[]>(() => readBoardLines(boardId));
  const [resources, setResources] = useState<Resource[]>(() => readBoardResources(boardId));
  const [capacityConfig, setCapacityConfig] = useState<CapacityConfig>(() => readBoardCapacityConfig(boardId));
  const [view, setView] = useState<PersistedViewState>(() => loadPersistedView(boardId));
  const [anchor, setAnchor] = useState<Date>(new Date(TODAY));
  const [orderAnchor, setOrderAnchor] = useState<Date>(new Date(TODAY));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [selection, setSelection] = useState<JobSelection | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [expandedLineRow, setExpandedLineRow] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(viewKey(boardId), JSON.stringify(view));
    } catch {
      /* localStorageが使えない環境（プライベートモード等）では表示設定の永続化のみ諦める */
    }
  }, [boardId, view]);

  // このボードのライン/資源マスタ・稼働計画設定（マスタ設定タブ等での編集）を変更のたびに永続化し、
  // 一覧側の更新日時（updatedAt）も合わせて更新する。工程データ（jobs）自体の永続化・updatedAt更新は
  // boardProvider（boardDataProvider.ts）側が担うためここでは扱わない（2026-09-24変更）
  const isFirstDataEffect = React.useRef(true);
  useEffect(() => {
    writeBoardLines(boardId, lines);
    writeBoardResources(boardId, resources);
    writeBoardCapacityConfig(boardId, capacityConfig);
    if (isFirstDataEffect.current) {
      isFirstDataEffect.current = false;
      return;
    }
    touchBoard(boardId);
  }, [boardId, lines, resources, capacityConfig]);

  function updateView(patch: Partial<PersistedViewState>) {
    setView((prev) => ({ ...prev, ...patch }));
  }

  const value = useMemo<GanttContextValue>(
    () => ({
      boardId,
      jobs,
      boardProvider,
      lines,
      setLines,
      resources,
      setResources,
      capacityConfig,
      setCapacityConfig,
      view,
      updateView,
      anchor,
      setAnchor,
      orderAnchor,
      setOrderAnchor,
      selectedJob,
      setSelectedJob,
      selection,
      setSelection,
      expandedOrder,
      setExpandedOrder,
      expandedLineRow,
      setExpandedLineRow,
      filterSearch,
      setFilterSearch,
    }),
    [boardId, jobs, boardProvider, lines, resources, capacityConfig, view, anchor, orderAnchor, selectedJob, selection, expandedOrder, expandedLineRow, filterSearch]
  );

  return <GanttContext.Provider value={value}>{children}</GanttContext.Provider>;
}

export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error("useGantt() must be used within <GanttProvider>");
  return ctx;
}
