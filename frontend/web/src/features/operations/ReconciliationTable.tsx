import { reconciliationMetrics, reconciliationResult } from './reconciliationModel';
export { reconciliationMetrics, reconciliationResult } from './reconciliationModel';
import { formatQuantity } from '../../i18n/quantity';
import './reconciliation.css';

type ReconciliationRow = Record<string, unknown>;
export function ReconciliationTable({ rows }: { rows: ReconciliationRow[] }) {
  return <div className="operations-table-scroll" role="region" aria-label="Bảng kiểm tra số liệu kho, có thể cuộn ngang" tabIndex={0}>
    <table className="stock-table reconciliation-summary-table">
      <caption>Đối chiếu số liệu của kho đã chọn. Dấu “—” nghĩa là chưa có dữ liệu; 0 là số lượng bằng không.</caption>
      <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Đơn vị</th>{reconciliationMetrics.map(([key, title]) => <th key={key} scope="col" className="numeric">{title}</th>)}<th scope="col">Kết quả kiểm tra</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const item = row.item as { id?: string; name?: string } | undefined;
        const unit = row.unit as { display_name?: string } | undefined;
        const result = reconciliationResult(row.flags);
        return <tr key={item?.id || String(row.item_id || index)}><th scope="row">{item?.name || String(row.item_name || 'Chưa rõ vật phẩm')}</th><td>{unit?.display_name || '—'}</td>
          {reconciliationMetrics.map(([key]) => <td key={key} className="numeric">{formatQuantity(row[key])}</td>)}
          <td><span className={`reconciliation-status reconciliation-status--${result.tone}`}>{result.text}</span></td></tr>;
      })}</tbody>
    </table>
  </div>;
}
