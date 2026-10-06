// 工程表一覧に並ぶ「ボード」。ボードごとに完全に独立したProcessJob[]と表示設定(PersistedViewState)を持つ。
// ライン／資源マスタ（src/data/factory.ts）は当面すべてのボードで共通（北条工場のマスタ）とする。

export interface Board {
  id: string;
  name: string;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
}

// 俯瞰ビュー（複数工程表の負荷率サマリー画面）の「合体」表示（2026-09-23追加）。特定のボードに
// 属さない設定のため、boardIdをキーにしたボード単位のlocalStorageとは別に、単独のキーで永続化する
// （src/lib/boardStorage.ts参照）。ボード自体を跨いで合算するだけで、対象のボードを書き換えることはない
export interface OverviewCombo {
  id: string;
  name: string;
  boardIds: string[];
}
