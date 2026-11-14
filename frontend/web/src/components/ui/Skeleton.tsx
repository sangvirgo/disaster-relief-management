import './Skeleton.css';

export function Skeleton({
  rows = 5,
  label = 'Đang tải dữ liệu…',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="ui-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <span className="ui-skeleton__row" aria-hidden="true" key={index} />
      ))}
      <span className="ui-skeleton__sr" role="status">
        {label}
      </span>
    </div>
  );
}
