import { EvidenceGallery, type EvidenceMedia } from '../../components/EvidenceGallery';

export function RequestEvidencePanel({ items }: { items: EvidenceMedia[] }) {
  if (!items.length) return null;
  return <section className="request-evidence-panel" aria-label="Ảnh và video hiện trường">
    <h3>Ảnh và video hiện trường ({items.length})</h3>
    <EvidenceGallery items={items} />
  </section>;
}
