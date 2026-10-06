import { useEffect, useState } from "react";
import { MainMenu } from "./components/MainMenu";
import { SettingsScreen } from "./components/SettingsScreen";
import { BoardList } from "./components/BoardList";
import { BoardView } from "./components/BoardView";
import { OverviewScreen } from "./components/OverviewScreen";
import { applyTheme, readAppSettings } from "./lib/theme";
import { listBoards } from "./lib/boardStorage";

type Screen = { type: "menu" } | { type: "settings" } | { type: "boards" } | { type: "board"; boardId: string } | { type: "overview" };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: "menu" });

  useEffect(() => {
    applyTheme(readAppSettings().theme);
  }, []);

  if (screen.type === "settings") {
    return <SettingsScreen onBack={() => setScreen({ type: "menu" })} />;
  }

  if (screen.type === "boards") {
    return (
      <BoardList
        onBack={() => setScreen({ type: "menu" })}
        onOpenBoard={(boardId) => setScreen({ type: "board", boardId })}
      />
    );
  }

  if (screen.type === "board") {
    const board = listBoards().find((b) => b.id === screen.boardId);
    return (
      <BoardView
        boardId={screen.boardId}
        boardName={board ? board.name : "工程表"}
        onBack={() => setScreen({ type: "boards" })}
      />
    );
  }

  if (screen.type === "overview") {
    return (
      <OverviewScreen
        onBack={() => setScreen({ type: "menu" })}
        onOpenBoard={(boardId) => setScreen({ type: "board", boardId })}
      />
    );
  }

  return (
    <MainMenu
      onOpenBoards={() => setScreen({ type: "boards" })}
      onOpenSettings={() => setScreen({ type: "settings" })}
      onOpenOverview={() => setScreen({ type: "overview" })}
    />
  );
}
