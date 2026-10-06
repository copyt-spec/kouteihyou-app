import type { PointerEvent as ReactPointerEvent } from "react";
import type { ProcessJob } from "../types/processJob";
import type { BarGeom } from "../lib/geometry";

function processColor(processType: string): string {
  const PALETTE = ["#0B5FFF", "#7C4FE0", "#1E9E62", "#B8720A", "#D33B3B", "#0EA5A5", "#C2410C", "#2563EB"];
  let h = 0;
  const s = String(processType || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function GanttJobBar({
  job,
  geom,
  top,
  height,
  label,
  extraLines,
  warn,
  selected,
  dragOffsetPx,
  orientation = "h",
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  job: ProcessJob;
  geom: BarGeom;
  top: number;
  height: number;
  label: string;
  // 縦表示（orientation="v"）のバーは高さに余裕があるため、品名など追加の行を表示できる（2026-09-22追加）
  extraLines?: string[];
  warn: boolean;
  selected?: boolean;
  dragOffsetPx?: number;
  // "h"=横（時間軸が横、既定）／"v"=縦（時間軸が縦。ライン工程表の縦表示用、2026-09-22追加）
  orientation?: "h" | "v";
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const showProgress = (job.status === "active" || job.status === "reserved") && job.progress > 0;
  const dragging = !!dragOffsetPx;
  const vertical = orientation === "v";
  const style = vertical
    ? {
        top: geom.leftPct + "%",
        height: geom.widthPct + "%",
        left: top,
        width: height,
        transform: dragging ? `translateY(${dragOffsetPx}px)` : undefined,
      }
    : {
        left: geom.leftPct + "%",
        width: geom.widthPct + "%",
        top,
        height,
        transform: dragging ? `translateX(${dragOffsetPx}px)` : undefined,
      };
  const clipBefore = vertical ? "▲" : "◀";
  const clipAfter = vertical ? "▼" : "▶";
  return (
    <div
      className={`jobbar ${vertical ? "jobbar-v" : ""} status-${job.status} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {showProgress && <div className="progressfill" style={{ [vertical ? "height" : "width"]: job.progress + "%" }} />}
      {geom.clipL && <span className="clip">{clipBefore}</span>}
      <span className="label">
        <span className="labelmain">
          <span className="procdot" style={{ background: processColor(job.processType) }} title={job.processType} />
          {job.manualLock ? "🔒 " : ""}
          {label}
        </span>
        {vertical &&
          extraLines?.filter(Boolean).map((line, i) => (
            <span className="labelextra" key={i}>
              {line}
            </span>
          ))}
      </span>
      {warn && <span className="badge">⚠</span>}
      {geom.clipR && <span className="clip">{clipAfter}</span>}
    </div>
  );
}
