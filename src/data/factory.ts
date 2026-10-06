import type { FactoryLine, Resource } from "../types/processJob";

// ライン・資源マスタは2026-09-22よりボードごとに独立させた（src/lib/boardStorage.ts参照）。
// この定数は「北条工場サンプル」ボードを初回起動時に登録する際の初期値としてのみ使う。
// lineCode/resourceCodeは、連携設定タブ（src/lib/mapping.ts）のサンプルmcframe出力（RAW_LINE/RAW_RESOURCE）の
// コードとあえて一致させてあり、①マスタ設定でラインCD・資源CDを登録 → ②連携設定の結果プレビューでそのラインCDが
// 解決されて表示される、という紐付けの一連の流れをサンプルデータで確認できるようにしている（2026-09-23追加）。
export const DEFAULT_LINES: FactoryLine[] = [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, name: "北条工場" + n, lineCodes: ["L" + n] }));
const RESOURCE_DEFS: [string, string][] = [
  ["設備A", "RS01"],
  ["設備B", "RS02"],
  ["設備C", "RS03"],
  ["設備D", "RS04"],
  ["検査チーム1", "RT01"],
  ["検査チーム2", "RT02"],
];
export const DEFAULT_RESOURCES: Resource[] = RESOURCE_DEFS.map(([name, code]) => ({
  id: name,
  name,
  resourceCode: code,
}));

// 表示の基準となる「現在時刻」。実データ接続後はサーバー時刻／WebSocket配信に置き換える想定（設計ドキュメント5章）
export const TODAY = new Date("2026-10-08T10:30:00");
