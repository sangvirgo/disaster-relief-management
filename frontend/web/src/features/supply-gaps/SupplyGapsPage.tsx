import { useState } from 'react';
import type { Me } from '../../auth/session';
import { Tabs } from '../../components/ui/Tabs';
import { useUrlView } from '../../app/useUrlView';
import { NormEditor } from './NormEditor';
import { SupplyGapInbox } from './SupplyGapInbox';
import { Operations } from '../operations/Operations';

const supplyViews = ['drives', 'norms'] as const;

/** Manager workspace: supply-gap suggestions and the need norm table, kept together as one operations area. */
export function SupplyGapsPage({ user }: { user: Me }) {
  const [view, setView] = useUrlView('view', supplyViews, 'drives');
  const [expanded, setExpanded] = useState<'gaps' | 'needs' | null>(null);
  return (
    <div className="operations-workspace supply-page">
      <Tabs
        className="supply-page__tabs"
        ariaLabel="Nội dung đợt quyên góp và định mức"
        idBase="supply-page"
        items={[
          { id: 'drives', label: 'Đợt quyên góp' },
          { id: 'norms', label: 'Định mức vật tư' },
        ]}
        value={view}
        onChange={(value) => setView(value as (typeof supplyViews)[number])}
      />
      <div role="tabpanel" id="supply-page-tabpanel" aria-labelledby={`supply-page-tab-${view}`}>
        {view === 'drives' ? <>
          <div className="supply-page__quick">
            <section className="card">
              <h2>Đề xuất bổ sung vật tư</h2>
              <p>Hệ thống tổng hợp thiếu hụt theo kho và vật phẩm. Quản lý vận hành duyệt đề xuất để tạo đợt quyên góp nháp.</p>
              <button type="button" className="button secondary" aria-expanded={expanded === 'gaps'} onClick={() => setExpanded(expanded === 'gaps' ? null : 'gaps')}>
                {expanded === 'gaps' ? 'Ẩn đề xuất' : 'Xem đề xuất'}
              </button>
            </section>
            <section className="card">
              <h2>Nhu cầu vật tư từ SOS</h2>
              <p>Xem nhu cầu đã ghi nhận và cam kết xuất kho trước khi quyết định mở đợt quyên góp.</p>
              <button type="button" className="button secondary" aria-expanded={expanded === 'needs'} onClick={() => setExpanded(expanded === 'needs' ? null : 'needs')}>
                {expanded === 'needs' ? 'Ẩn nhu cầu' : 'Xem nhu cầu'}
              </button>
            </section>
          </div>
          {expanded === 'gaps' && <SupplyGapInbox user={user} />}
          {expanded === 'needs' && <Operations page="needs" user={user} />}
          <Operations page="drives" user={user} />
        </> : <NormEditor user={user} />}
      </div>
    </div>
  );
}
