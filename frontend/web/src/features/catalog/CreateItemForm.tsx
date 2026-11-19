import { useEffect, useState } from 'react';
import { fetchAll } from '../../api/fetchAll';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { Skeleton } from '../../components/ui/Skeleton';
import { proposalErrorMessage } from '../need-proposals/needProposalModel';
import { parseAliasText, validateAliasList } from './itemAliasModel';

type TypeRow = { code: string; display_name: string };
type UnitRow = { code: string; display_name: string; scale: number };

function createSpec(types: TypeRow[], units: UnitRow[]): CommandSpec {
  return {
    title: 'Thêm vật phẩm',
    hideTitle: true,
    service: 'logistics',
    method: 'POST',
    path: '/items',
    fields: [
      { name: 'name', label: 'Tên vật phẩm', type: 'text', required: true, maxLength: 200, placeholder: 'Ví dụ: Nước uống đóng chai' },
      {
        name: 'item_type_code', label: 'Nhóm hàng', type: 'select', required: true,
        options: types.map((row) => ({ value: row.code, label: row.display_name })),
        emptyLabel: 'Chọn nhóm hàng',
      },
      {
        name: 'unit_code', label: 'Đơn vị tính', type: 'select', required: true,
        options: units.map((row) => ({ value: row.code, label: row.display_name })),
        emptyLabel: 'Chọn đơn vị',
        hintFor: (values) => {
          const unit = units.find((row) => row.code === values.unit_code);
          if (!unit) return undefined;
          return unit.scale === 0 ? 'Đơn vị này chỉ nhận số nguyên.' : `Đơn vị này nhận tối đa ${unit.scale} chữ số thập phân.`;
        },
      },
      {
        name: 'aliases', label: 'Từ khóa (tên gọi khác)', type: 'textarea', maxLength: 1500,
        hintFor: () => 'Mỗi từ khóa một dòng hoặc cách nhau bằng dấu phẩy. Giúp hệ thống nhận ra vật phẩm trong mô tả của người dân.',
      },
    ],
    build: (values) => {
      const aliases = parseAliasText(values.aliases ?? '');
      const problem = validateAliasList(aliases);
      if (problem) throw new Error(problem);
      return {
        name: (values.name ?? '').trim(),
        item_type_code: values.item_type_code,
        unit_code: values.unit_code,
        ...(aliases.length ? { aliases } : {}),
      };
    },
  };
}

/** Form to add a catalog item (POST /items). Groups and units come from the existing catalog. */
export function CreateItemForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [lookup, setLookup] = useState<{ types: TypeRow[]; units: UnitRow[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([
      fetchAll<TypeRow>('logistics', '/item-types'),
      fetchAll<UnitRow>('logistics', '/units'),
    ])
      .then(([types, units]) => { if (live) setLookup({ types, units }); })
      .catch((cause) => { if (live) setError(proposalErrorMessage(cause)); });
    return () => { live = false; };
  }, []);
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!lookup) return <Skeleton rows={3} label="Đang tải nhóm hàng và đơn vị…" />;
  if (!lookup.types.length || !lookup.units.length) {
    return <p className="notice error" role="alert">Chưa có nhóm hàng hoặc đơn vị tính trong danh mục nên chưa thể thêm vật phẩm.</p>;
  }
  return (
    <CommandForm
      spec={createSpec(lookup.types, lookup.units)}
      onSuccess={(result) => onCreated(String((result as { name?: string } | undefined)?.name ?? 'vật phẩm mới'))}
      onStale={() => undefined}
    />
  );
}
