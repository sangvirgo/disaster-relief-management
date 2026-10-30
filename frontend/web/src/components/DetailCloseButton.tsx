type DetailCloseButtonProps = {
  onClick: () => void;
};

export function DetailCloseButton({ onClick }: DetailCloseButtonProps) {
  return (
    <button
      type="button"
      className="detail-close-button"
      onClick={onClick}
      aria-label="Đóng chi tiết"
      title="Đóng chi tiết"
    >
      <svg className="close-icon" aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><span className="close-label">Đóng</span>
    </button>
  );
}
