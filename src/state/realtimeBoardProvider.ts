import type { ProcessJob } from "../types/processJob";
import type { AdjustScope, AutoAdjustApply, ShiftResult } from "../lib/adjust";
import type { BoardDataProvider } from "./boardDataProvider";
import type { AuditEntryWire, ClientMessage, ServerMessage } from "./realtimeProtocol";

// RealtimeBoardProvider：部門内サーバーへWebSocket接続し、工程調整をサーバーへ依頼する
// BoardDataProviderの実装（ステップ2、設計ドキュメント5-6参照）。
//
// LocalBoardProviderとの違いはjobsの正本（source of truth）がサーバー側にある点のみで、
// 呼び出し側（OrderScreen/LineScreen/DetailSheet/WritebackSettings）から見たインターフェースは
// まったく同じ（applyShift/applyMinuteShift/clearPendingExportがPromiseを返し、結果はsubscribe経由で
// 配信される）ため、画面側のコードは一切変更していない。
//
// 接続が切れた場合は簡易的な自動再接続（バックオフ）を行い、再接続時にサーバーから最新スナップショットを
// もらい直す。監査ログ（誰がいつ何を調整したか）もサーバーから配信され、onAuditで購読できる（ステップ3の
// 監査ログ閲覧UIから利用する想定）。
export interface RealtimeBoardProviderOptions {
  boardId: string;
  actor: string; // 調整した人の表示名（本格的な認証ではなく、簡易的な識別。5-3参照）
  serverUrl: string; // 例: "ws://192.168.1.20:8787"
}

export interface RealtimeBoardProvider extends BoardDataProvider {
  readonly mode: "realtime";
  onAudit(listener: (entry: AuditEntryWire) => void): () => void;
  onConnectionChange(listener: (state: "connecting" | "open" | "closed") => void): () => void;
  close(): void;
}

export function createRealtimeBoardProvider(opts: RealtimeBoardProviderOptions): RealtimeBoardProvider {
  let jobs: ProcessJob[] = [];
  const listeners = new Set<(jobs: ProcessJob[]) => void>();
  const auditListeners = new Set<(entry: AuditEntryWire) => void>();
  const connListeners = new Set<(state: "connecting" | "open" | "closed") => void>();
  const pending = new Map<string, { resolve: (r: ShiftResult) => void }>();
  let reqSeq = 0;
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let retryDelayMs = 500;

  function notifyJobs(next: ProcessJob[]) {
    jobs = next;
    listeners.forEach((l) => l(next));
  }
  function notifyConn(state: "connecting" | "open" | "closed") {
    connListeners.forEach((l) => l(state));
  }

  function connect() {
    if (closedByUser) return;
    notifyConn("connecting");
    ws = new WebSocket(opts.serverUrl);
    ws.addEventListener("open", () => {
      retryDelayMs = 500;
      const hello: ClientMessage = { type: "hello", boardId: opts.boardId, actor: opts.actor };
      ws!.send(JSON.stringify(hello));
      notifyConn("open");
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "snapshot") {
        notifyJobs(msg.jobs);
        msg.audit.forEach((a) => auditListeners.forEach((l) => l(a)));
        return;
      }
      if (msg.type === "update") {
        notifyJobs(msg.jobs);
        auditListeners.forEach((l) => l(msg.audit));
        return;
      }
      if (msg.type === "ack") {
        const p = pending.get(msg.reqId);
        if (p) {
          pending.delete(msg.reqId);
          p.resolve({ jobs, message: msg.message });
        }
        return;
      }
      if (msg.type === "error") {
        // eslint-disable-next-line no-console
        console.error("[realtimeBoardProvider] server error:", msg.message);
      }
    });
    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", () => {
      /* closeイベントが続けて発火するため、再接続はcloseハンドラ側にまとめる */
    });
  }

  function scheduleReconnect() {
    notifyConn("closed");
    if (closedByUser) return;
    setTimeout(connect, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
  }

  function request(msg: ClientMessage): Promise<ShiftResult> {
    return new Promise((resolve) => {
      if (!ws || ws.readyState !== ws.OPEN) {
        resolve({ jobs, message: "" }); // サーバー未接続時は何もしない（画面側は再接続後の配信を待つ）
        return;
      }
      const reqId = msg.type === "hello" ? "" : msg.reqId;
      pending.set(reqId, { resolve });
      ws.send(JSON.stringify(msg));
    });
  }

  connect();

  return {
    mode: "realtime",
    getJobs: () => jobs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAudit(listener) {
      auditListeners.add(listener);
      return () => auditListeners.delete(listener);
    },
    onConnectionChange(listener) {
      connListeners.add(listener);
      return () => connListeners.delete(listener);
    },
    applyShift(targetKey, _jobKeyFn, deltaDays, scope: AdjustScope) {
      return request({ type: "applyShift", reqId: String(++reqSeq), targetKey, deltaDays, scope });
    },
    applyMinuteShift(targetKey, _jobKeyFn, deltaMinutes, scope: AdjustScope) {
      return request({ type: "applyMinuteShift", reqId: String(++reqSeq), targetKey, deltaMinutes, scope });
    },
    async clearPendingExport(keys, jobKeyFn) {
      const wireKeys = jobs.filter((j) => keys.has(jobKeyFn(j))).map(jobKeyFn);
      await request({ type: "clearPendingExport", reqId: String(++reqSeq), keys: wireKeys });
    },
    applyAutoAdjustment(moves: AutoAdjustApply[]) {
      return request({ type: "applyAutoAdjustment", reqId: String(++reqSeq), moves });
    },
    close() {
      closedByUser = true;
      ws?.close();
    },
  };
}
