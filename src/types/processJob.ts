// ProcessJob（内部モデル）。設計ドキュメント 2-6 の interface をそのままTypeScript化したもの。
// プロトタイプ（FactorySlot 工程表 Artifact）で確認済みの項目に、2026-09-22追加の itemCode / itemName も含む。

export type JobStatus = "done" | "active" | "delay" | "reserved" | "tentative" | "unscheduled";

export interface ProcessJob {
  orderNo: string; // オーダーNo。受注時点で必ず付与され、常に存在する
  orderNumber: string | null; // 製造指図番号。「指図」時点で発行されるため、指図前は null
  processSeq: string | null; // 工程番号（複合キーの一部）。指図前は null
  factoryLineId: number | null; // 1〜6（可変。ライン再割当で変わりうる）。指図前は null
  resource: string | null; // 設備・検査チームなどの資源（可変）
  customer: string;
  itemCode?: string; // 品目CD（同一オーダー内で共通、2026-09-22追加）
  itemName?: string; // 品名（同一オーダー内で共通、2026-09-22追加）
  processType: string;
  specialOrderNo1?: string; // 特注No.1
  specialOrderNo2?: string; // 特注No.2
  plannedManHours: number; // 予定工数（h）。plannedStart〜plannedEndの拘束時間とは別の、正味作業時間の見積り
  plannedStart: string | null; // ISO8601相当（"YYYY-MM-DDTHH:mm"）。指図前（未スケジュール）は null
  plannedEnd: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  progress: number; // 0-100
  status: JobStatus;
  plannedQuantity: number;
  actualQuantity: number;
  prevProcessEnd?: string; // 前工程の終了日時（同一オーダー内で工程番号が1つ前）
  nextProcessStart?: string; // 後工程の開始日時
  dueDate?: string; // 納期（オーダー単位）
  manualLock: boolean; // 手動調整済みフラグ（自動工程調整の対象外）
  pendingExport?: boolean; // mcframeへの書き戻し未反映フラグ（2026-09-23追加）。ドラッグ等の手動調整でtrueになり、
  // 書き戻し設定タブでCSV出力するとfalseに戻る。manualLockとは別軸（manualLockは自動調整からの除外、
  // pendingExportは書き戻し待ちの管理）だが、現状は手動調整のタイミングで両方同時にtrueになる
}

export interface FactoryLine {
  id: number;
  name: string;
  // 連携設定（工程データ・ライン対応マスタ）側の「ラインCD」との紐付け用（任意、2026-09-23追加）。
  // 同一ラインが複数のラインCDを持ちうる（システム移行やコード体系の変更で旧CD・新CDが混在する等）ため配列にした
  lineCodes?: string[];
}

export interface Resource {
  id: string;
  name: string;
  resourceCode?: string; // 連携設定（資源マスタ）側の「資源CD」との紐付け用（任意、2026-09-23追加）
}

export function jobKey(j: ProcessJob): string {
  return (j.orderNumber || j.orderNo) + "-" + (j.processSeq || "0");
}
export function orderKeyOf(j: ProcessJob): string {
  return j.orderNumber || j.orderNo;
}
export function isScheduled(j: ProcessJob): boolean {
  return !!(j.plannedStart && j.plannedEnd);
}
