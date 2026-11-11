export function SuccessBanner({ title, description }: { title: string; description?: string }) {
  return <div className="success-banner" role="status" aria-live="polite">
    <span className="success-banner-icon" aria-hidden="true">✓</span>
    <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
  </div>;
}
