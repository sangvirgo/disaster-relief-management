import { aiPriorityAdvisory } from '../src/ai/ai-priority-advisory';

describe('AI priority advisory view', () => {
  it('maps Gemini priority into a separate human-reviewed advisory', () => {
    expect(aiPriorityAdvisory({
      model: 'gemini-3.1-flash-lite',
      status: 'COMPLETED',
      extracted_json: { priority_score: 74, priority_reasons: ['Có dấu hiệu cháy lan.'], confidence: 0.82 },
      review_status: null,
    })).toEqual({
      status: 'COMPLETED',
      score: 74,
      level: 'CRITICAL',
      reasons: ['Có dấu hiệu cháy lan.'],
      confidence: 0.82,
      source: 'GEMINI',
      human_review_required: true,
      review_status: null,
    });
  });

  it('labels seeded samples as fixtures and omits invalid provider scores', () => {
    expect(aiPriorityAdvisory({
      model: 'demo-fixture:gemini-3.1-flash-lite',
      status: 'COMPLETED',
      extracted_json: { priority_score: 101, priority_reasons: ['demo'] },
      review_status: 'ACCEPTED',
    })).toEqual({
      status: 'COMPLETED',
      score: null,
      level: null,
      reasons: [],
      confidence: null,
      source: 'DEMO_FIXTURE',
      human_review_required: true,
      review_status: 'ACCEPTED',
    });
  });

  it('keeps pending and failed states visible without fabricating a score', () => {
    expect(aiPriorityAdvisory({ model: 'gemini-test', status: 'QUEUED' })).toMatchObject({
      status: 'QUEUED', score: null, level: null, human_review_required: true,
    });
    expect(aiPriorityAdvisory(null)).toBeNull();
  });

  it('suppresses stale and rejected suggestions', () => {
    const completed = { status: 'COMPLETED', extracted_json: { priority_score: 74, priority_reasons: ['Có nguy cơ.'], confidence: 0.8 } };
    expect(aiPriorityAdvisory({ ...completed, status: 'STALE' })).toMatchObject({ status: 'STALE', score: null, confidence: null, reasons: [] });
    expect(aiPriorityAdvisory({ ...completed, review_status: 'REJECTED' })).toMatchObject({ score: null, level: null, reasons: [], confidence: null });
  });

  it('retains the Vietnamese explanation when the model abstains', () => {
    expect(aiPriorityAdvisory({ status: 'COMPLETED', extracted_json: { priority_score: null, priority_reasons: ['Chưa đủ dữ kiện để đánh giá.'], confidence: 0.5 } }))
      .toMatchObject({ score: null, level: null, reasons: ['Chưa đủ dữ kiện để đánh giá.'], confidence: null });
  });
});
