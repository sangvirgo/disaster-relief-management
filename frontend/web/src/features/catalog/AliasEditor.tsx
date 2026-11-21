import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import { forgetCommandKey, sendRetryableCommand } from '../../api/retryableCommand';
import { Button } from '../../components/ui/Button';
import { addAlias, aliasListChanged, removeAlias, validateAliasList, ALIAS_MAX_COUNT, ALIAS_MAX_LENGTH } from './itemAliasModel';
import { proposalErrorMessage } from '../need-proposals/needProposalModel';

export interface AliasItem {
  id: string;
  name: string;
  version: number;
  aliases: string[];
}

/** Tag input for item aliases. Saves with PATCH /items/{id} and expected_version; changing the list gives a new command key. */
export function AliasEditor({ item, onSaved, onStale }: {
  item: AliasItem;
  onSaved: (aliases: string[]) => void;
  onStale: () => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<string[]>(item.aliases);
  const [candidate, setCandidate] = useState('');
  const [inputError, setInputError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = aliasListChanged(item.aliases, draft);

  function add() {
    if (!candidate.trim()) return;
    if (/[;,]/u.test(candidate)) {
      setInputError('Mỗi lần chỉ nhập một từ khóa. Nhấn Enter để thêm từ khóa tiếp theo.');
      return;
    }
    const result = addAlias(draft, candidate);
    setInputError(result.error ?? '');
    if (result.error) return;
    setDraft(result.aliases);
    setCandidate('');
    setSaveError('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveError('');
    if (candidate.trim()) {
      setInputError('Nhấn Enter để thêm từ khóa đang nhập trước khi lưu.');
      return;
    }
    const problem = validateAliasList(draft);
    if (problem) return setSaveError(problem);
    if (!changed) return setSaveError('Chưa có thay đổi nào để lưu.');
    setBusy(true);
    try {
      const saved = await sendRetryableCommand<{ aliases: string[]; version: number }>(
        `aliases:${item.id}`,
        'logistics',
        `/items/${item.id}`,
        { expected_version: item.version, aliases: draft },
        'PATCH',
      );
      forgetCommandKey(`aliases:${item.id}`);
      onSaved(saved.aliases ?? draft);
    } catch (cause) {
      setSaveError(proposalErrorMessage(cause));
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') onStale();
    } finally {
      setBusy(false);
    }
  }

  const inputId = `${formId}-alias`;
  const labelId = `${formId}-alias-label`;
  const helpId = `${formId}-help`;
  const errorId = `${formId}-error`;

  function onCandidateKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    add();
  }

  return (
    <form className="alias-editor" onSubmit={(event) => void save(event)} noValidate>
      <p id={helpId} className="muted alias-editor__help">
        Từ khóa giúp hệ thống nhận ra vật phẩm, ví dụ: mì tôm, mì gói. Từ khóa chỉ dùng để nhận diện trong mô tả của người dân; không thay đổi số lượng hay tồn kho.
      </p>

      <div className="alias-editor__field">
        <span id={labelId} className="alias-editor__label">Từ khóa mới</span>
        <input
          id={inputId}
          type="text"
          value={candidate}
          maxLength={ALIAS_MAX_LENGTH + 1}
          autoComplete="off"
          disabled={busy || draft.length >= ALIAS_MAX_COUNT}
          aria-labelledby={labelId}
          aria-describedby={inputError ? `${helpId} ${errorId}` : helpId}
          aria-invalid={Boolean(inputError)}
          placeholder="Nhập một từ khóa rồi nhấn Enter"
          onChange={(event) => { setCandidate(event.target.value); setInputError(''); }}
          onKeyDown={onCandidateKeyDown}
        />
      </div>
      {inputError && <small id={errorId} className="field-error" role="alert">{inputError}</small>}

      <p className="muted alias-editor__count" aria-live="polite">{draft.length} / {ALIAS_MAX_COUNT} từ khóa</p>

      {draft.length > 0 ? (
        <ul className="alias-chips alias-editor__list" aria-label={`Từ khóa của ${item.name}`}>
          {draft.map((alias) => (
            <li key={alias} className="alias-chip">
              <span>{alias}</span>
              <button
                type="button"
                className="alias-chip__remove"
                aria-label={`Xóa từ khóa ${alias}`}
                disabled={busy}
                onClick={() => { setDraft((current) => removeAlias(current, alias)); setSaveError(''); }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Chưa có từ khóa nào.</p>
      )}

      {saveError && <p className="notice error" role="alert">{saveError}</p>}

      <div className="alias-editor__actions">
        <Button type="submit" loading={busy} disabled={busy || !changed}>Lưu từ khóa</Button>
      </div>
    </form>
  );
}
