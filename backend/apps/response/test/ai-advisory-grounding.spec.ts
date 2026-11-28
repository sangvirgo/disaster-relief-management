import { advisoryCountsMatchInput } from '../src/ai/ai-advisory-grounding';

const text = JSON.stringify({ sos: { people_affected: 14, children_count: 3, elderly_count: 2 } });
describe('AI structured count grounding', () => {
  it('accepts exact reported counts and omitted unknown facts', () => {
    expect(advisoryCountsMatchInput({ facts: { people_affected: 14, children_count: 3, elderly_count: 2 } }, text)).toBe(true);
    expect(advisoryCountsMatchInput({ facts: {} }, text)).toBe(true);
  });
  it('rejects stale totals, swapped groups and a fabricated zero', () => {
    for (const facts of [{ people_affected: 12 }, { children_count: 2 }, { elderly_count: 3 }, { elderly_count: 0 }]) {
      expect(advisoryCountsMatchInput({ facts }, text)).toBe(false);
    }
  });
  it('rejects subgroup counts exceeding the known total', () => {
    expect(advisoryCountsMatchInput({ facts: { children_count: 4, elderly_count: 3 } }, '{"sos":{"people_affected":5}}')).toBe(false);
  });
  it('isolates each input and rejects malformed envelopes', () => {
    expect(advisoryCountsMatchInput({ facts: { people_affected: 14 } }, '{"sos":{"people_affected":2}}')).toBe(false);
    expect(advisoryCountsMatchInput({ facts: {} }, 'invalid')).toBe(false);
    expect(advisoryCountsMatchInput({ facts: {} }, '{"sos":null}')).toBe(false);
  });
});
