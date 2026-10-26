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
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
