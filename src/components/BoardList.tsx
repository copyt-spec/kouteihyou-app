import { useState } from "react";
import type { Board } from "../types/board";
import { createBoard, deleteBoard, listBoards, renameBoard } from "../lib/boardStorage";

interface Props {
  onBack: () => void;
  onOpenBoard: (boardId: string) => void;
}

function fmtUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BoardList({ onBack, onOpenBoard }: Props) {
  const [boards, setBoards] = useState<Board[]>(() => listBoards());
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function refresh() {
    setBoards(listBoards());
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const board = createBoard(name);
    setNewName("");
    refresh();
    onOpenBoard(board.id);
  }

  function startRename(b: Board) {
    setRenamingId(b.id);
    setRenameValue(b.name);
  }

  function commitRename() {
    if (renamingId) {
      renameBoard(renamingId, renameValue);
      setRenamingId(null);
      refresh();
    }
  }

  function handleDelete(b: Board) {
    if (window.confirm(`「${b.name}」を削除します。よろしいですか？（この操作は取り消せません）`)) {
      deleteBoard(b.id);
      refresh();
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar-title">
          <button className="btn backbtn" onClick={onBack}>
            ← メインメニュー
          </button>
          <h1>工程表一覧</h1>
          <span className="topbar-sub">工程表は互いに完全に独立したデータを持ちます。用途に応じて新しく作成してください。</span>
        </div>
      </div>

      <div className="panel newboardpanel">
        <input
          className="newboardinput"
          type="text"
          placeholder="新しい工程表の名前（例：北条工場 東ライン）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <button className="btn primary" onClick={handleCreate} disabled={!newName.trim()}>
          ＋ 新規作成
        </button>
      </div>

      {boards.length === 0 ? (
        <div className="panel panel-note">工程表がまだありません。上の欄から新規作成してください。</div>
      ) : (
        <div className="boardlist">
          {boards.map((b) => (
            <div className="boardcard" key={b.id}>
              {renamingId === b.id ? (
                <div className="boardcard-rename">
                  <input
                    className="newboardinput"
                    type="text"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <button className="btn small" onClick={commitRename}>
                    保存
                  </button>
                  <button className="btn small" onClick={() => setRenamingId(null)}>
                    キャンセル
                  </button>
                </div>
              ) : (
                <>
                  <button className="boardcard-open" onClick={() => onOpenBoard(b.id)}>
                    <span className="boardcard-name">{b.name}</span>
                    <span className="boardcard-meta">更新: {fmtUpdatedAt(b.updatedAt)}</span>
                  </button>
                  <div className="boardcard-actions">
                    <button className="btn small" onClick={() => startRename(b)}>
                      名前変更
                    </button>
                    <button className="btn small danger" onClick={() => handleDelete(b)}>
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
  );
}
