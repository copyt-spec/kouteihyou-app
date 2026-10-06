export function Legend({ withOrderExtras }: { withOrderExtras?: boolean }) {
  return (
    <div className="legend">
      <span className="sw"><span className="dot done" />完了</span>
      <span className="sw"><span className="dot active" />稼働中</span>
      <span className="sw"><span className="dot reserved" />確定予約</span>
      <span className="sw"><span className="dot delay" />遅延</span>
      <span className="sw"><span className="dot tentative" />仮押さえ</span>
      <span className="sw">🔒 手動ロック済み</span>
      <span className="sw">⚠ 前工程と重複</span>
      <span className="sw"><span className="dot" style={{ background: "var(--weekend)", border: "1px solid var(--line)" }} />非稼働日（カレンダーマスタ）</span>
      {withOrderExtras && (
        <>
          <span className="sw"><span className="procdot" style={{ background: "var(--signal)" }} />工程の色分け（工程種別ごと）</span>
          <span className="sw"><span className="procdot" style={{ background: "var(--violet)" }} />休暇・応援等のイベントで基準工数が増減している日</span>
        </>
      )}
    </div>
  );
}
