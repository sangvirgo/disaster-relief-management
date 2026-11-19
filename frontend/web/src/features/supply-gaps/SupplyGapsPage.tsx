import { useState } from 'react';
import { roles, type Me } from '../../auth/session';
import { useUrlView } from '../../app/useUrlView';
import { Tabs } from '../../components/ui/Tabs';
import { ItemCatalogPage } from '../catalog/ItemCatalogPage';
import { NeedProposalsPage } from '../need-proposals/NeedProposalsPage';
import { Operations } from '../operations/Operations';
import { NormEditor } from './NormEditor';
import { SupplyGapInbox } from './SupplyGapInbox';
import { UnassignedSupplyNotice } from './SupplyBadges';

const supplySections = ['proposals', 'donations', 'catalog'] as const;
const reviewerSections = ['donations'] as const;

/** One navigation destination with distinct SOS, donation and catalog work areas. */
export function SupplyGapsPage({ user }: { user: Me }) {
  const canManage = roles(user).has('OPERATIONS_MANAGER');
  const legacyNorms = new URL(window.location.href).searchParams.get('view') === 'norms';
  const [section, setSection] = useUrlView('section', canManage ? supplySections : reviewerSections, canManage && legacyNorms ? 'catalog' : 'donations');
  const [showNeeds, setShowNeeds] = useState(false);
  const [showGaps, setShowGaps] = useState(false);

  return (
    <div className="operations-workspace supply-page">
      {canManage && <Tabs
        ariaLabel="Công việc vật tư và quyên góp"
        idBase="supply-page"
        className="supply-page__tabs"
        items={[
          { id: 'proposals', label: 'Nhu cầu từ SOS' },
          { id: 'donations', label: 'Đợt quyên góp' },
          { id: 'catalog', label: 'Vật phẩm và định mức' },
        ]}
        value={section}
        onChange={(value) => setSection(value as (typeof supplySections)[number])}
      />}
      <div role={canManage ? 'tabpanel' : undefined} id="supply-page-tabpanel"
        aria-labelledby={canManage ? `supply-page-tab-${section}` : undefined} className="supply-page__content">
        {section === 'proposals' && <>
          <p className="supply-page__intro">SOS đã xác minh và cần hàng cứu trợ sẽ tạo đề xuất vật tư. Quản lý duyệt từng đề xuất; nhu cầu được xác nhận xuất hiện ở danh sách bên dưới.</p>
          <UnassignedSupplyNotice user={user} />
          <NeedProposalsPage user={user} />
          <section className="card supply-page__related" aria-labelledby="supply-needs-title">
            <div>
              <h2 id="supply-needs-title">Nhu cầu vật tư đã ghi nhận</h2>
              <p>Xem các nhu cầu đã có và cam kết xuất kho của SOS.</p>
            </div>
            <button type="button" className="button secondary" aria-expanded={showNeeds} aria-controls="supply-needs-content"
              onClick={() => setShowNeeds((value) => !value)}>{showNeeds ? 'Ẩn nhu cầu' : 'Xem nhu cầu'}</button>
          </section>
          <div id="supply-needs-content">{showNeeds && <Operations page="needs" user={user} />}</div>
        </>}
        {section === 'donations' && <>
          <p className="supply-page__intro">Tạo đợt quyên góp thủ công từ danh sách này, hoặc xem đề xuất tự động từ thiếu hụt vật tư bên dưới.</p>
          <Operations page="drives" user={user} />
          {canManage && <>
            <section className="card supply-page__related" aria-labelledby="supply-gaps-title">
              <div>
                <h2 id="supply-gaps-title">Thiếu hụt và đề xuất mở đợt</h2>
                <p>Hệ thống so sánh nhu cầu đã duyệt với tồn kho và số hàng đang kêu gọi. Quản lý quyết định có tạo đợt quyên góp nháp từ đề xuất hay không.</p>
              </div>
              <button type="button" className="button secondary" aria-expanded={showGaps} aria-controls="supply-gaps-content"
                onClick={() => setShowGaps((value) => !value)}>{showGaps ? 'Ẩn đề xuất' : 'Xem đề xuất tự động'}</button>
            </section>
            <div id="supply-gaps-content">{showGaps && <SupplyGapInbox user={user} />}</div>
          </>}
        </>}
        {section === 'catalog' && <>
          <ItemCatalogPage user={user} />
          <NormEditor user={user} />
        </>}
      </div>
    </div>
  );
}
