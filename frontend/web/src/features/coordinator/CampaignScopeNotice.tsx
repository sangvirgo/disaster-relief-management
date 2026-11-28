/** Explain campaign-scoped permissions without a disclosure or an account-specific role name. */
export function CampaignScopeNotice({ selfSelected = false }: { selfSelected?: boolean }) {
  return <aside className="campaign-scope-notice" aria-label="Phạm vi điều phối theo chiến dịch">
    <span className="campaign-scope-notice__icon" aria-hidden="true">i</span>
    <div><strong>Điều phối theo chiến dịch</strong>
      <p>Bạn có thể xác minh, đặt ưu tiên, giao đội và theo dõi SOS trong {selfSelected ? 'tối đa 3 chiến dịch đã nhận' : 'các chiến dịch được phân công'}.</p>
      <p className="campaign-scope-notice__secondary">SOS chưa thuộc chiến dịch, quản lý chiến dịch và hồ sơ đội do điều phối viên toàn hệ thống phụ trách.</p>
    </div>
  </aside>;
}
