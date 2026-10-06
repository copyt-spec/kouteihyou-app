import type { FilterCondition } from "../lib/filters";
import type { LoadRow } from "../lib/capacity";
import type { HoursUnit } from "../lib/format";

// "master"/"integration"/"capacity"は2026-09-23の設定画面集約より前の値。既存ボードの保存データに
// これらの値が残っている場合があるため型・処理系には残すが、新規に遷移する先は"settings"のみ
// （BoardView.tsxのscreenForRender参照）
export type ScreenId = "line" | "order" | "master" | "integration" | "capacity" | "settings";
export type SettingsTabId = "master" | "integration" | "capacity" | "labels" | "loadrows" | "writeback";

// グリッド上でのクリック（オーダー全体）／ダブルクリック（工程単体）選択。ドラッグ・矢印キーでの
// 工程調整に使う。localStorageには保存しない一時的な状態（2026-09-22追加、設計ドキュメント3-4-1参照）
export interface JobSelection {
  scope: "order" | "single";
  orderKey: string;
  jobKey: string; // アンカー工程（詳細ボタン・矢印キー操作の対象）
}
export type LineViewId = "day" | "week" | "month";
export type GroupById = "line" | "resource";
// ライン工程表の軸の向き（2026-09-22追加）。h=横表示（時間軸が横。従来どおり）／v=縦表示（時間軸が縦。
// 工程の情報量が多いとき（品名など）にバーの高さに余裕を持たせたい場合向け）。オーダー進捗表には適用しない。
export type LineAxis = "h" | "v";

export interface OrderLabelFields {
  customer: boolean;
  itemCode: boolean;
  itemName: boolean;
  specialOrderNo: boolean;
  dueDate: boolean;
  plannedQuantity: boolean;
  plannedManHours: boolean;
  progress: boolean;
}

// localStorageに永続化する表示設定（工程データ本体=ProcessJob[]は別管理）
export interface PersistedViewState {
  screen: ScreenId;
  view: LineViewId;
  groupBy: GroupById;
  lineAxis: LineAxis;
  orderSpanKey: string;
  orderLabelFields: OrderLabelFields;
  filterConditions: FilterCondition[];
  loadRows: LoadRow[];
  hoursUnit: HoursUnit;
}

export const DEFAULT_ORDER_LABEL_FIELDS: OrderLabelFields = {
  customer: true,
  itemCode: false,
  itemName: false,
  specialOrderNo: false,
  dueDate: true,
  plannedQuantity: false,
  plannedManHours: false,
  progress: false,
};

export const DEFAULT_VIEW_STATE: PersistedViewState = {
  screen: "line",
  view: "week",
  groupBy: "line",
  lineAxis: "h",
  orderSpanKey: "2w",
  orderLabelFields: DEFAULT_ORDER_LABEL_FIELDS,
  filterConditions: [],
  loadRows: [{ id: "total", basis: null, value: null, label: "全体" }],
  hoursUnit: "h",
};

// 表示設定のlocalStorageキーはボードごとに分ける（src/lib/boardStorage.ts の viewKey() を参照）。
