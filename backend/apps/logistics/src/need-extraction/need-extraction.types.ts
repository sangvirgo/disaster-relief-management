import type { NeedReasonCode } from '../needs/need-reasons';

export type ExtractionSource = 'GEMINI' | 'ALIAS' | 'DEFAULT_BUNDLE';

/** Catalog item as seen by extraction: ACTIVE items only, aliases used for the fallback matcher. */
export interface ExtractionCatalogItem {
  id: string;
  name: string;
  item_type_code: string;
  aliases: string[];
}

/** Active need norm: the category an item type feeds, and the default item used by the default bundle. */
export interface ExtractionNorm {
  category: string;
  item_type_code: string;
  in_default_bundle: boolean;
  default_item_id: string | null;
}

/**
 * Stored as estimate_basis.extraction on every line created by the sweep. It records how the lines were chosen. It
 * never holds a quantity: quantities come from the norm estimator only.
 */
export interface ExtractionBasis {
  source: ExtractionSource;
  reason_codes: NeedReasonCode[];
  unmatched_terms: string[];
  mentioned_items: Array<{ item_id: string; category: string | null }>;
  model?: string;
}

export interface ExtractionLine {
  category: string;
  /** Null only for the default bundle, where the estimator uses the norm's default item. */
  item_id: string;
}

export interface ExtractionOutcome {
  basis: ExtractionBasis;
  lines: ExtractionLine[];
}
