import { roles, type Me } from '../../auth/session';
import { useUrlView } from '../../app/useUrlView';
import { supplySections } from '../../app/routeViews';

import { Tabs } from '../../components/ui/Tabs';
import { ItemCatalogPage } from '../catalog/ItemCatalogPage';
import { NormEditor } from './NormEditor';
import { SupplyGapInbox } from './SupplyGapInbox';

/**
 * Operations: stock shortages and the goods catalog. SOS needs are not shown here (2026-11-26): teams ask for goods from
 * their mission, and the shortage warnings already aggregate what campaigns still need per warehouse.
 */
export function SupplyGapsPage({ user }: { user: Me }) {
  const canManage = roles(user).has('OPERATIONS_MANAGER');
  const [section, setSection] = useUrlView('section', supplySections, 'gaps');

  return (
    <div className="operations-workspace supply-page">
      <p className="muted">Cảnh báo được cập nhật theo đợt quét nhu cầu và tồn kho. Bấm Làm mới để lấy kết quả đã xử lý gần nhất.</p>
      {canManage && <Tabs
        ariaLabel="Thiếu hàng và danh mục"
        idBase="supply-page"
        className="supply-page__tabs"
        items={[
          { id: 'gaps', label: 'Cảnh báo thiếu hàng' },
          { id: 'catalog', label: 'Vật phẩm và định mức' },
        ]}
        value={section}
        onChange={(value) => setSection(value as (typeof supplySections)[number])}
      />}
      <div role="tabpanel" id="supply-page-tabpanel" aria-labelledby={`supply-page-tab-${section}`} className="supply-page__content">
        {section === 'gaps' && <SupplyGapInbox user={user} />}
        {section === 'catalog' && <>
          <ItemCatalogPage user={user} />
          <NormEditor user={user} />
        </>}
      </div>
    </div>
  );
}
