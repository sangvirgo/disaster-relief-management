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
      Đóng
    </button>
  );
}
