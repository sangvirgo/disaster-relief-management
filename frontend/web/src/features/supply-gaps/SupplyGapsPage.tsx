import type { Me } from '../../auth/session';
import { Tabs } from '../../components/ui/Tabs';
import { useUrlView } from '../../app/useUrlView';
import { NormEditor } from './NormEditor';
import { SupplyGapInbox } from './SupplyGapInbox';

const supplyViews = ['gaps', 'norms'] as const;

/** Manager workspace: supply-gap suggestions and the need norm table, kept together as one operations area. */
export function SupplyGapsPage({ user }: { user: Me }) {
  const [view, setView] = useUrlView('view', supplyViews, 'gaps');
  return (
    <div className="operations-workspace supply-page">
      <Tabs
        className="supply-page__tabs"
        ariaLabel="Nội dung đề xuất quyên góp và định mức"
        idBase="supply-page"
        items={[
          { id: 'gaps', label: 'Đề xuất quyên góp' },
          { id: 'norms', label: 'Định mức vật tư' },
        ]}
        value={view}
        onChange={(value) => setView(value as (typeof supplyViews)[number])}
      />
      <div role="tabpanel" id="supply-page-tabpanel" aria-labelledby={`supply-page-tab-${view}`}>
        {view === 'gaps' ? <SupplyGapInbox user={user} /> : <NormEditor user={user} />}
      </div>
    </div>
  );
}
