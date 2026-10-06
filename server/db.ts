import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { ProcessJob } from "../src/types/processJob";

// サーバー側の永続化層（ステップ2、設計ドキュメント5-6参照）。
// SQLiteファイル1つに「ボードごとの最新jobsスナップショット」と「監査ログ（誰がいつ何を調整したか）」を
// 持たせているだけの、意図的にごく単純な構成。理由：
//   ・別途DBサーバー（MySQL/Postgres等）を立てる必要がなく、サーバー役のPCを乗り換える際は
//     このファイル1つをコピーするだけで済む（サーバー変更のハードルを下げる、との要望に対応）。
//   ・better-sqlite3は同期APIなので、WebSocketの単純なリクエスト/ブロードキャストの流れと相性がよい。
export interface AuditEntry {
  id: number;
  boardId: string;
  actor: string;
  action: string; // "applyShift" | "applyMinuteShift" | "clearPendingExport"
  message: string;
  createdAt: string;
}

export interface BoardDb {
  getJobs(boardId: string, seed: () => ProcessJob[]): ProcessJob[];
  saveJobs(boardId: string, jobs: ProcessJob[]): void;
  appendAudit(entry: Omit<AuditEntry, "id" | "createdAt">): AuditEntry;
  listAudit(boardId: string, limit?: number): AuditEntry[];
  close(): void;
}

export function openBoardDb(dbPath: string): BoardDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS board_jobs (
      board_id TEXT PRIMARY KEY,
      jobs_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_board ON audit_log(board_id, id DESC);
  `);

  const getStmt = db.prepare("SELECT jobs_json FROM board_jobs WHERE board_id = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO board_jobs (board_id, jobs_json, updated_at) VALUES (@boardId, @jobsJson, @updatedAt) " +
      "ON CONFLICT(board_id) DO UPDATE SET jobs_json = excluded.jobs_json, updated_at = excluded.updated_at"
  );
  const insertAuditStmt = db.prepare(
    "INSERT INTO audit_log (board_id, actor, action, message, created_at) VALUES (@boardId, @actor, @action, @message, @createdAt)"
  );
  const listAuditStmt = db.prepare("SELECT * FROM audit_log WHERE board_id = ? ORDER BY id DESC LIMIT ?");

  return {
    getJobs(boardId, seed) {
      const row = getStmt.get(boardId) as { jobs_json: string } | undefined;
      if (row) return JSON.parse(row.jobs_json) as ProcessJob[];
      const initial = seed();
      this.saveJobs(boardId, initial);
      return initial;
    },
    saveJobs(boardId, jobs) {
      upsertStmt.run({ boardId, jobsJson: JSON.stringify(jobs), updatedAt: new Date().toISOString() });
    },
    appendAudit(entry) {
      const createdAt = new Date().toISOString();
      const info = insertAuditStmt.run({ ...entry, createdAt });
      return { id: Number(info.lastInsertRowid), createdAt, ...entry };
    },
    listAudit(boardId, limit = 200) {
      const rows = listAuditStmt.all(boardId, limit) as Array<{
        id: number;
        board_id: string;
        actor: string;
        action: string;
        message: string;
        created_at: string;
      }>;
      return rows.map((r) => ({ id: r.id, boardId: r.board_id, actor: r.actor, action: r.action, message: r.message, createdAt: r.created_at }));
    },
    close() {
      db.close();
    },
  };
}
