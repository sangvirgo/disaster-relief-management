import './SelectedFiles.css';

export function SelectedFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return <small className="selected-files__empty">Chưa chọn tệp</small>;
  return <ul className="selected-files" aria-label="Tệp đã chọn">
    {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
      <span title={file.name}>{file.name}</span>
      <button type="button" onClick={() => onRemove(index)} aria-label={`Bỏ tệp ${file.name}`}>Bỏ tệp</button>
    </li>)}
  </ul>;
}
