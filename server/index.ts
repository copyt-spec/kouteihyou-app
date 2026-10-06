import { WebSocketServer, type WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyShift, applyMinuteShift, applyAutoAdjustment } from "../src/lib/adjust";
import { jobKey } from "../src/types/processJob";
import type { ProcessJob } from "../src/types/processJob";
import { openBoardDb, type BoardDb } from "./db";
import type { ClientMessage, ServerMessage, AuditEntryWire } from "../src/state/realtimeProtocol";

// 部門内共有サーバー（ステップ2、設計ドキュメント5-6参照）。
//
// 設計方針（「サーバー変更のハードル」を下げるための決定）：
//   このファイルはNode.jsの素朴なWebSocketサーバーとして「単独でも」`tsx server/index.ts`で起動できるが、
//   `startRealtimeServer()`はブラウザ固有のAPIに一切依存しない、ただの関数としても作ってある。
//   これにより、将来Electronアプリの中に「サーバーとして動作」モードを追加するとき、この関数を
//   Electronのメインプロセス（Node.js実行環境）から直接importして呼ぶだけでよく、別のインストーラーや
//   別の技術スタックを用意する必要がない（＝全員が同じアプリをインストールし、設定でこのモードを
//   ONにするだけでサーバー役を移せる、という運用上のハードルの低さにつながる）。
//
// 永続化はSQLiteファイル1つ（server/db.ts）。サーバー役のPCを乗り換える際は、このファイルを
// コピーするだけで工程データ・監査ログを引き継げる。

type Client = { ws: WebSocket; boardId: string; actor: string };

export interface RealtimeServerOptions {
  port: number;
  dbPath: string;
}

export interface RealtimeServerHandle {
  close(): Promise<void>;
}

function toWireAudit(a: { id: number; boardId: string; actor: string; action: string; message: string; createdAt: string }): AuditEntryWire {
  return a;
}

export function startRealtimeServer(opts: RealtimeServerOptions): RealtimeServerHandle {
  const db: BoardDb = openBoardDb(opts.dbPath);
  const boardCache = new Map<string, ProcessJob[]>();
  const clients = new Set<Client>();

  function getJobs(boardId: string): ProcessJob[] {
    let jobs = boardCache.get(boardId);
    if (!jobs) {
      jobs = db.getJobs(boardId, () => []);
      boardCache.set(boardId, jobs);
    }
    return jobs;
  }

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastUpdate(boardId: string, jobs: ProcessJob[], actor: string, action: string, message: string, audit: AuditEntryWire) {
    boardCache.set(boardId, jobs);
    db.saveJobs(boardId, jobs);
    const payload: ServerMessage = { type: "update", jobs, actor, action, message, audit };
    for (const c of clients) {
      if (c.boardId === boardId) send(c.ws, payload);
    }
  }

  const wss = new WebSocketServer({ port: opts.port });

  wss.on("connection", (ws) => {
    let client: Client | null = null;

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", message: "invalid JSON" });
        return;
      }

      if (msg.type === "hello") {
        client = { ws, boardId: msg.boardId, actor: msg.actor || "（名称未設定）" };
        clients.add(client);
        const jobs = getJobs(msg.boardId);
        const audit = db.listAudit(msg.boardId).map(toWireAudit);
        send(ws, { type: "snapshot", jobs, audit });
        return;
      }

      if (!client) {
        send(ws, { type: "error", message: "hello を先に送ってください" });
        return;
      }

      const boardId = client.boardId;
      const jobs = getJobs(boardId);

      if (msg.type === "applyShift") {
        const result = applyShift(jobs, msg.targetKey, jobKey, msg.deltaDays, msg.scope);
        if (result.message) {
          const audit = db.appendAudit({ boardId, actor: client.actor, action: "applyShift", message: result.message });
          broadcastUpdate(boardId, result.jobs, client.actor, "applyShift", result.message, toWireAudit(audit));
        }
        send(ws, { type: "ack", reqId: msg.reqId, message: result.message });
        return;
      }

      if (msg.type === "applyMinuteShift") {
        const result = applyMinuteShift(jobs, msg.targetKey, jobKey, msg.deltaMinutes, msg.scope);
        if (result.message) {
          const audit = db.appendAudit({ boardId, actor: client.actor, action: "applyMinuteShift", message: result.message });
          broadcastUpdate(boardId, result.jobs, client.actor, "applyMinuteShift", result.message, toWireAudit(audit));
        }
        send(ws, { type: "ack", reqId: msg.reqId, message: result.message });
        return;
      }

      if (msg.type === "clearPendingExport") {
        const keySet = new Set(msg.keys);
        const nextJobs = jobs.map((j) => (keySet.has(jobKey(j)) ? { ...j, pendingExport: false } : j));
        const message = `${msg.keys.length}件を書き戻し済みにしました`;
        const audit = db.appendAudit({ boardId, actor: client.actor, action: "clearPendingExport", message });
        broadcastUpdate(boardId, nextJobs, client.actor, "clearPendingExport", message, toWireAudit(audit));
        send(ws, { type: "ack", reqId: msg.reqId, message });
        return;
      }

      if (msg.type === "applyAutoAdjustment") {
        const result = applyAutoAdjustment(jobs, msg.moves, jobKey);
        if (result.message) {
          const audit = db.appendAudit({ boardId, actor: client.actor, action: "applyAutoAdjustment", message: result.message });
          broadcastUpdate(boardId, result.jobs, client.actor, "applyAutoAdjustment", result.message, toWireAudit(audit));
        }
        send(ws, { type: "ack", reqId: msg.reqId, message: result.message });
        return;
      }
    });

    ws.on("close", () => {
      if (client) clients.delete(client);
    });
  });

  return {
    close() {
      return new Promise((resolve, reject) => {
        for (const c of clients) c.ws.close();
        wss.close((err) => {
          db.close();
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

// `tsx server/index.ts` で直接起動された場合のみ、単独プロセスとしてサーバーを立ち上げる
// （importして呼ばれるだけ＝Electronのメインプロセスに組み込まれた場合はここは実行されない）。
// このファイルはEelectronパッケージング（5-4ステップ3）のためesbuildでCJS形式にバンドルされ、
// electron/main.cjsからrequire()される経路も持つ。esbuildはCJS出力時に`import.meta`を空の
// オブジェクトへ置き換える（`import.meta.url`は常にundefinedになる）ため、`typeof import.meta.url
// === "string"`を先頭に置いて短絡評価させ、その場合はfileURLToPathを呼ばないようにしている
// （呼んでしまうと`require()`されるたびに例外を投げてElectron側のサーバー起動が壊れるバグになる）
const isDirectRun = typeof import.meta.url === "string" && !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const port = Number(process.env.PORT || 8787);
  const dbPath = process.env.DB_PATH || path.resolve("server/data/kouteihyou.sqlite3");
  startRealtimeServer({ port, dbPath });
  console.log(`[kouteihyou realtime server] listening on ws://0.0.0.0:${port} (db: ${dbPath})`);
}
