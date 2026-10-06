import { useState } from "react";
import { readAppSettings, writeTheme, type ThemeChoice } from "../lib/theme";

interface Props {
  onBack: () => void;
}

const THEME_OPTIONS: { id: ThemeChoice; label: string; desc: string }[] = [
  { id: "system", label: "端末の設定に合わせる", desc: "OS／ブラウザのライト・ダーク設定に自動で追従します" },
  { id: "light", label: "ライト", desc: "常に明るい配色で表示します" },
  { id: "dark", label: "ダーク", desc: "常に暗い配色で表示します" },
];

export function SettingsScreen({ onBack }: Props) {
  const [theme, setTheme] = useState<ThemeChoice>(() => readAppSettings().theme);

  function choose(next: ThemeChoice) {
    setTheme(next);
    writeTheme(next);
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar-title">
          <button className="btn backbtn" onClick={onBack}>
            ← メインメニュー
          </button>
          <h1>設定</h1>
          <span className="topbar-sub">アプリ全体に関わる設定です。今後、他の設定項目もここに追加していく予定です。</span>
        </div>
      </div>

      <div className="panel settingspanel">
        <div className="settings-section-title">画面の配色</div>
        <div className="themeoptions">
          {THEME_OPTIONS.map((opt) => (
            <label key={opt.id} className={"themeoption" + (theme === opt.id ? " active" : "")}>
              <input
                type="radio"
                name="theme"
                checked={theme === opt.id}
                onChange={() => choose(opt.id)}
              />
              <span className="themeoption-label">{opt.label}</span>
              <span className="themeoption-desc">{opt.desc}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
