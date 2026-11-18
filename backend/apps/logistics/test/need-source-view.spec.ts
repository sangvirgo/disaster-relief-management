import { needSourceView, NeedSourceFields } from '../src/needs/needs.helpers';

const estimateBasis = {
  batch_id: 'batch-1', category: 'WATER', item_type_code: 'NUOC_UONG', norm_id: 'norm-1', norm_version: 1,
  people_count: 10, days: 3, infants: 0, elderly: 0, effective_persons: '10.00', raw_quantity: '90.00000',
  estimated_quantity: '90.000', reason_codes: ['NORM_PER_PERSON_DAY'] as const, estimated_at: '2026-11-18T00:00:00.000Z',
};

function declared(overrides: Partial<NeedSourceFields> = {}): NeedSourceFields {
  return {
    source: 'DECLARED',
    estimate_basis: null,
    reference_estimate_quantity: '90.000',
    requested_quantity: '270.000',
    unit_scale: 3,
    status: 'OPEN',
    ...overrides,
  };
}

describe('needSourceView', () => {
  it('flags a declared quantity strictly above three times the estimate', () => {
    expect(needSourceView(declared({ requested_quantity: '270.001' })).reason_codes).toEqual(['QUANTITY_FAR_ABOVE_ESTIMATE']);
  });

  it('does not flag a declared quantity exactly three times the estimate', () => {
    expect(needSourceView(declared({ requested_quantity: '270.000' })).reason_codes).toEqual([]);
  });

  it('does not flag a declared quantity below the threshold', () => {
    expect(needSourceView(declared({ requested_quantity: '50' })).reason_codes).toEqual([]);
  });

  it('compares with the unit scale, so a whole-piece item uses integer units', () => {
    const piece = declared({ unit_scale: 0, reference_estimate_quantity: '10', requested_quantity: '31' });
    expect(needSourceView(piece).reason_codes).toEqual(['QUANTITY_FAR_ABOVE_ESTIMATE']);
    expect(needSourceView({ ...piece, requested_quantity: '30' }).reason_codes).toEqual([]);
  });

  it('never flags without a reference estimate', () => {
    expect(needSourceView(declared({ reference_estimate_quantity: null, requested_quantity: '9999.000' })).reason_codes).toEqual([]);
  });

  it('never flags estimated, confirmed or cancelled lines', () => {
    expect(needSourceView(declared({ source: 'ESTIMATED', requested_quantity: '9999.000' })).reason_codes).toEqual([]);
    expect(needSourceView(declared({ source: 'CONFIRMED', requested_quantity: '9999.000' })).reason_codes).toEqual([]);
    expect(needSourceView(declared({ status: 'CANCELLED', requested_quantity: '9999.000' })).reason_codes).toEqual([]);
  });

  it('exposes the estimate basis on estimated and confirmed lines and the reference only on declared lines', () => {
    const estimated = needSourceView({
      source: 'ESTIMATED', estimate_basis: estimateBasis, reference_estimate_quantity: null,
      requested_quantity: '90.000', unit_scale: 3, status: 'OPEN',
    });
    expect(estimated).toMatchObject({ source: 'ESTIMATED', estimate: estimateBasis, estimate_reference_quantity: null });
    const declaredLine = needSourceView(declared());
    expect(declaredLine).toMatchObject({ source: 'DECLARED', estimate: null, estimate_reference_quantity: '90.000' });
    const confirmed = needSourceView({ ...declared(), source: 'CONFIRMED', estimate_basis: estimateBasis, reference_estimate_quantity: null });
    expect(confirmed).toMatchObject({ source: 'CONFIRMED', estimate: estimateBasis, estimate_reference_quantity: null });
  });
});
