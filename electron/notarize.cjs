// electron-builderのafterSignフック（公証、設計ドキュメント5-1参照）。
//
// 公証にはApple IDのアプリ用パスワード（または App Store Connect API Key）が必要で、
// この情報はこのプロジェクト（Coworkのクラウド環境）には置かず、ビルドを実行するMac側の
// 環境変数として渡す運用にする（秘密情報をリポジトリ・成果物に含めないため）。
//
//   APPLE_ID                 … 公証に使うApple IDのメールアドレス
//   APPLE_APP_SPECIFIC_PASSWORD … そのApple IDで発行した「App用パスワード」
//   APPLE_TEAM_ID             … Apple Developer ProgramのチームID
//
// 3つとも設定されていない場合は、公証をスキップしてビルドを継続する（署名なし・公証なしの
// ローカル動作確認用ビルドを作りたいときのため）。3つのうち一部だけ設定されている場合はエラーで
// 停止する（設定ミスに気づかずアップロードしてしまうことを防ぐため）。

const path = require("node:path");

module.exports = async function notarizeAfterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  const provided = [APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID].filter(Boolean).length;

  if (provided === 0) {
    console.log("[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID が未設定のため、公証をスキップします（署名なしのローカル確認用ビルド）");
    return;
  }
  if (provided < 3) {
    throw new Error("[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID は3つとも設定するか、3つとも未設定にしてください（一部だけの設定は不可）");
  }

  const { notarize } = require("@electron/notarize");
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] 公証を開始します: ${appPath}`);
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("[notarize] 公証が完了しました");
};
