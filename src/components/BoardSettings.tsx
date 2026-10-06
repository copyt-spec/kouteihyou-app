import { useState } from "react";
import type { SettingsTabId } from "../state/types";
import { MasterSettings } from "./MasterSettings";
import { IntegrationSettings } from "./IntegrationSettings";
import { CapacitySettings, type CapacityModeId } from "./CapacitySettings";
import { LabelFieldsPanel } from "./LabelFieldsPanel";
import { LoadRowsPanel } from "./LoadRowsPanel";
import { WritebackSettings } from "./WritebackSettings";

// 設定画面（2026-09-23新設）。以前はライン工程表・オーダー進捗表と同列のタブだった
// マスタ設定／連携設定／稼働計画設定と、オーダー進捗表の画面内にあったオーダー行表示項目／
// 積み上げ工数・負荷率設定を、この1画面にまとめた（設計ドキュメント参照）。トップバー右上の
// 歯車アイコン（BoardView.tsx）から遷移する。
// 旧screen値（"master"/"integration"/"capacity"）で保存されたボードとの後方互換のため、
// それらの値のときは対応するサブタブを開いた状態でこの画面を表示する（BoardView.tsx参照）。

const SETTINGS_TABS: [SettingsTabId, string][] = [
  ["master", "マスタ設定"],
  ["integration", "連携設定"],
  ["capacity", "稼働計画設定"],
  ["labels", "オーダー行表示項目"],
  ["loadrows", "積み上げ工数・負荷率設定"],
  ["writeback", "書き戻し設定"],
];

interface Props {
  initialTab: SettingsTabId;
  // 工程表画面のAutoAdjustPanel（2026-09-24追加）から「③条件フロー・実行」を開いた状態で
  // 遷移してきた場合に渡される。initialTab==="capacity"のときのみ意味を持つ
  initialCapacityMode?: CapacityModeId;
  onBack: () => void;
}

export function BoardSettings({ initialTab, initialCapacityMode, onBack }: Props) {
  // どのサブタブを開いているかは表示のみの一時的な状態（永続化しない）。画面遷移直後は
  // initialTab（歯車アイコンからなら"master"、旧screen値からの後方互換遷移ならその値）を初期値にする
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  return (
    <div className="screenbody">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <button className="btn small" onClick={onBack}>
          ← 工程表に戻る
        </button>
      </div>
      <div className="segments settingsnav">
        {SETTINGS_TABS.map(([id, label]) => (
          <button key={id} className={`segbtn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "master" ? (
        <MasterSettings />
      ) : tab === "integration" ? (
        <IntegrationSettings />
      ) : tab === "capacity" ? (
        <CapacitySettings initialMode={initialCapacityMode} />
      ) : tab === "writeback" ? (
        <WritebackSettings />
      ) : tab === "labels" ? (
        <div className="panel">
          <div className="panel-head">
            <h2>オーダー行表示項目</h2>
            <span className="panel-note">オーダー進捗表の各行に表示する項目を選びます</span>
          </div>
          <LabelFieldsPanel />
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <h2>積み上げ工数・負荷率設定</h2>
            <span className="panel-note">オーダー進捗表の上部に表示する積み上げ工数・負荷率の行を設定します</span>
          </div>
          <LoadRowsPanel />
        </div>
      )}
    </div>
  );
}
