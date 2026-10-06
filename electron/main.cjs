// Electronメインプロセス（段階的実装ステップ3、設計ドキュメント5-4・5-3-1参照）。
//
// このファイルはCommonJS（.cjs）で書く。package.jsonが"type":"module"のため、拡張子を.cjsに
// 固定することで、Electronのメインプロセス起動時に常にCommonJSとして解釈させ、ESM/CJS判定の
// 事故を避けている（server-bundle.cjs＝esbuildでバンドルした部分だけrequireで読み込む形にできる）。
//
// 「サーバーとして動作」モード（5-3-1）：部門内共有サーバー（server/index.ts）を、別配布の
// Node.jsプロセスとしてではなく、この同じElectronアプリのメインプロセスから直接起動できるように
// している。ON/OFFは「動作モード」メニューのチェックボックスで切り替え、設定はこのMac上の
// アプリデータフォルダ（userData）内のJSONファイルに保存する。サーバー役のPCを乗り換える際は、
// 同フォルダ内のSQLiteファイル（kouteihyou.sqlite3）をコピーするだけでよい（5-3-1参照）。
//
// まだ実装していないもの（設計ドキュメント5-4のステップ5で対応予定）：
//   ・ボードごとに「スタンドアロン／サーバー接続」を選ぶ画面内のUI（RealtimeBoardProviderへの
//     接続先アドレス・表示名の設定）。今回追加したのはあくまで「このMac自体をサーバー役にするか」
//     というElectronアプリ単位のOSレベルの設定であり、Webアプリ側（BoardSettings等）からサーバーに
//     接続する設定画面はまだ無い
//   ・監査ログの閲覧UI

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isMac = process.platform === "darwin";
const APP_DISPLAY_NAME = "工程表";

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;
/** @type {{ close(): Promise<void> } | null} */
let serverHandle = null;

/* ---------- 「サーバーとして動作」設定の読み書き（userData配下のJSON） ---------- */

function configPath() {
  return path.join(app.getPath("userData"), "server-config.json");
}
function defaultDbPath() {
  return path.join(app.getPath("userData"), "kouteihyou.sqlite3");
}
function readServerConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      runAsServer: !!parsed.runAsServer,
      port: Number(parsed.port) || 8787,
      dbPath: typeof parsed.dbPath === "string" && parsed.dbPath ? parsed.dbPath : defaultDbPath(),
    };
  } catch {
    return { runAsServer: false, port: 8787, dbPath: defaultDbPath() };
  }
}
function writeServerConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}

/* ---------- サーバー起動（「サーバーとして動作」ONのときのみ） ---------- */

function startEmbeddedServerIfEnabled() {
  const config = readServerConfig();
  if (!config.runAsServer) return;

  let startRealtimeServer;
  try {
    // esbuildで事前にバンドルしたCJSファイル（npm run build:server-bundleで生成。
    // better-sqlite3・wsはバンドルに含めず外部化してあるので、node_modules経由でrequireされる）
    ({ startRealtimeServer } = require("./server-bundle.cjs"));
  } catch (err) {
    console.error("[kouteihyou] サーバーモジュールの読み込みに失敗しました:", err);
    dialog.showErrorBox(
      "サーバー機能を起動できませんでした",
      "サーバーとして動作する設定になっていますが、サーバーモジュールの読み込みに失敗しました。\n" +
        "アプリを配布ビルド（npm run electron:build）で作り直してから再度お試しください。\n\n" +
        String(err)
    );
    return;
  }

  try {
    serverHandle = startRealtimeServer({ port: config.port, dbPath: config.dbPath });
    console.log(`[kouteihyou] サーバーとして起動しました（ws://0.0.0.0:${config.port}, db: ${config.dbPath}）`);
  } catch (err) {
    console.error("[kouteihyou] サーバーの起動に失敗しました:", err);
    dialog.showErrorBox("サーバーを起動できませんでした", String(err));
  }
}

/* ---------- ウィンドウ生成 ---------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    // 配布ビルドでは、Vite本体のビルド成果物（npm run build）をそのまま読み込む
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------- メニュー ---------- */

function buildMenu() {
  const config = readServerConfig();

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
          },
        ]
      : []),
    { label: "編集", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "表示",
      submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
    {
      label: "動作モード",
      submenu: [
        {
          label: "このMacをサーバーとして動作させる",
          type: "checkbox",
          checked: config.runAsServer,
          click: (menuItem) => {
            const next = { ...config, runAsServer: menuItem.checked };
            writeServerConfig(next);
            dialog
              .showMessageBox(mainWindow, {
                type: "info",
                buttons: ["今すぐ再起動", "後で"],
                defaultId: 0,
                message: menuItem.checked ? "サーバーとして動作する設定にしました" : "サーバーとして動作する設定を解除しました",
                detail: "この設定を反映するにはアプリの再起動が必要です。",
              })
              .then((res) => {
                if (res.response === 0) {
                  app.relaunch();
                  app.exit(0);
                } else {
                  // メニューのチェック表示自体は再構築するが、実際の切り替えは再起動後
                  Menu.setApplicationMenu(buildMenu());
                }
              });
          },
        },
        {
          label: "設定ファイルの場所を開く",
          click: () => {
            writeServerConfig(config); // ファイルが無ければ既定値で作成してから開く
            shell.showItemInFolder(configPath());
          },
        },
      ],
    },
    { role: "windowMenu" },
  ];

  return Menu.buildFromTemplate(template);
}

/* ---------- ライフサイクル ---------- */

app.whenReady().then(() => {
  startEmbeddedServerIfEnabled();
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("before-quit", async (e) => {
  if (serverHandle) {
    e.preventDefault();
    const handle = serverHandle;
    serverHandle = null;
    await handle.close().catch(() => {});
    app.quit();
  }
});
