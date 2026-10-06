import { useState } from "react";
import { GanttProvider, useGantt } from "../state/GanttContext";
import { UnitToggle } from "./UnitToggle";
import { ScreenNav } from "./ScreenNav";
import { LineScreen } from "./LineScreen";
import { OrderScreen } from "./OrderScreen";
import { BoardSettings } from "./BoardSettings";
import { DetailSheet } from "./DetailSheet";
import type { SettingsTabId } from "../state/types";
import type { CapacityModeId } from "./CapacitySettings";

interface Props {
  boardId: string;
  boardName: string;
  onBack: () => void;
}

// 旧screen値（設定画面集約より前に保存されたボード）を、新しい設定画面のどのサブタブとして開くかへの対応
const LEGACY_SETTINGS_TAB: Record<string, SettingsTabId> = {
  master: "master",
  integration: "integration",
  capacity: "capacity",
};

function BoardInner({ boardName, onBack }: { boardName: string; onBack: () => void }) {
  const { view, updateView } = useGantt();
  // 設定画面から「工程表に戻る」で戻る先（ライン工程表／オーダー進捗表のどちらを見ていたか）。
  // 設定画面自体はscreenに保存せず一時的な表示状態として扱う（2026-09-23設定画面集約より）
  const [boardScreen, setBoardScreen] = useState<"line" | "order">(view.screen === "order" ? "order" : "line");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 工程表画面のAutoAdjustPanel（2026-09-24追加）から「③条件フロー・実行」の詳細設定を開いた状態で
  // 設定画面へ遷移するために使う。値を持たない（undefined）ときは通常どおり①持ち工数タブで開く
  const [pendingCapacityMode, setPendingCapacityMode] = useState<CapacityModeId | undefined>(undefined);

  const legacyTab = LEGACY_SETTINGS_TAB[view.screen];
  const showSettings = settingsOpen || !!legacyTab;

  function openSettings() {
    if (view.screen === "line" || view.screen === "order") setBoardScreen(view.screen);
    setPendingCapacityMode(undefined);
    setSettingsOpen(true);
  }
  // AutoAdjustPanel「詳細設定を開く」用：稼働計画設定タブの指定サブタブを開いた状態で遷移する
  function openCapacitySettings(mode: CapacityModeId) {
    if (view.screen === "line" || view.screen === "order") setBoardScreen(view.screen);
    setPendingCapacityMode(mode);
    setSettingsOpen(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    // 旧screen値（"master"等）のまま保存されていたボードは、閉じるタイミングで新しいscreen値に正規化する
    if (legacyTab) updateView({ screen: boardScreen });
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar-title">
          <button className="btn backbtn" onClick={onBack}>
            ← 工程表一覧
          </button>
          <span className="eyebrow">
            <span className="livedot" />
            {boardName}
          </span>
          <h1>工程表</h1>
          <span className="topbar-sub">
            {showSettings
              ? "マスタ設定・連携設定・稼働計画設定・表示項目をここでまとめて設定します"
              : view.screen === "line"
              ? "ラインの稼働状況を時刻単位で確認します（日時ベース配置・前後工程の重複検知・手動ロック表示に対応）"
              : "オーダー単位の進捗を日付単位で確認します（指図前はオーダーNoのまま、指図後にライン・日時が確定して反映されます）"}
          </span>
        </div>
        <div className="topbar-actions">
          {!showSettings && (view.screen === "line" || view.screen === "order") && <UnitToggle />}
          <button className="btn icon gearbtn" onClick={openSettings} title="設定">
            ⚙
          </button>
        </div>
      </div>

      {!showSettings && <ScreenNav />}

      {showSettings ? (
        <BoardSettings initialTab={legacyTab ?? (pendingCapacityMode ? "capacity" : "master")} initialCapacityMode={pendingCapacityMode} onBack={closeSettings} />
      ) : view.screen === "line" ? (
        <LineScreen onOpenAutoAdjustRules={() => openCapacitySettings("rules")} />
      ) : (
        <OrderScreen onOpenAutoAdjustRules={() => openCapacitySettings("rules")} />
      )}

      <DetailSheet />
    </div>
  );
}

export function BoardView({ boardId, boardName, onBack }: Props) {
  return (
    <GanttProvider boardId={boardId} key={boardId}>
      <BoardInner boardName={boardName} onBack={onBack} />
    </GanttProvider>
  );
}
