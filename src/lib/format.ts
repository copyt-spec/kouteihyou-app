export type HoursUnit = "h" | "min";

// 工数の表示単位（時間／分）変換。データは常に時間の小数で保持し、表示だけ変換する（設計ドキュメント 3-3・7-3参照）
export function fmtHours(h: number, unit: HoursUnit): string {
  const n = Number(h) || 0;
  if (unit === "min") return Math.round(n * 60) + "分";
  const rounded = Math.round(n * 10) / 10;
  return (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)) + "h";
}
