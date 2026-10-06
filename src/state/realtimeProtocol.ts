import type { ProcessJob } from "../types/processJob";
import type { AdjustScope, AutoAdjustApply } from "../lib/adjust";

// RealtimeBoardProvider ⇔ サーバー間のWebSocketメッセージ形式（ステップ2、設計ドキュメント5-6参照）。
// クライアント・サーバーの両方からimportして使う「共有の型定義」のみのファイル（実行コードは持たない）。

export interface AuditEntryWire {
  id: number;
  boardId: string;
  actor: string;
  action: string;
  message: string;
  createdAt: string;
}

// --- クライアント → サーバー ---
export type ClientMessage =
  | { type: "hello"; boardId: string; actor: string }
  | { type: "applyShift"; reqId: string; targetKey: string; deltaDays: number; scope: AdjustScope }
  | { type: "applyMinuteShift"; reqId: string; targetKey: string; deltaMinutes: number; scope: AdjustScope }
  | { type: "clearPendingExport"; reqId: string; keys: string[] }
  | { type: "applyAutoAdjustment"; reqId: string; moves: AutoAdjustApply[] };

// --- サーバー → クライアント ---
export type ServerMessage =
  | { type: "snapshot"; jobs: ProcessJob[]; audit: AuditEntryWire[] }
  | { type: "update"; jobs: ProcessJob[]; actor: string; action: string; message: string; audit: AuditEntryWire }
  | { type: "ack"; reqId: string; message: string }
  | { type: "error"; reqId?: string; message: string };
