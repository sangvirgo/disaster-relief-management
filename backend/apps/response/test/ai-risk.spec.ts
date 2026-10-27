import { buildAiAssessmentInput, serializeAiAssessmentInput, sanitizeAiDescription, scoreRequestRisk } from '../src/ai/ai-risk';

describe('Gemini assessment input', () => {
  beforeEach(() => { delete process.env.GEMINI_ADVISORY_INCLUDE_REDACTED_TEXT; });
  afterEach(() => { delete process.env.GEMINI_ADVISORY_INCLUDE_REDACTED_TEXT; });
  it('includes safe structured SOS facts even when the description is empty', () => {
    const input = buildAiAssessmentInput({
      incidentCategoryCode: 'FLOOD',
      description: null,
      reporterDeclaredDanger: true,
      peopleAffected: 8,
      childrenCount: 2,
      elderlyCount: 1,
      needsRescue: true,
      needsReliefSupplies: false,
    });

    expect(input).toEqual({
      incident_category_code: 'FLOOD',
      description: '',
      people_affected: 8,
      children_count: 2,
      elderly_count: 1,
      reporter_declared_danger: true,
      needs_rescue: true,
      needs_relief_supplies: false,
    });
  });

  it('omits narrative by default even when personal information is present', () => {
    const facts = {
      incidentCategoryCode: 'MEDICAL',
      description: 'Tôi tên là Nguyễn Văn An, cần cấp cứu. Email an@example.com.',
      peopleAffected: 1,
      childrenCount: null,
      elderlyCount: null,
      reporterDeclaredDanger: false,
      needsRescue: true,
      needsReliefSupplies: false,
    };

    const serialized = serializeAiAssessmentInput(facts);

    expect(serialized).toBe(serializeAiAssessmentInput(facts));
    expect(serialized).not.toContain('Nguyễn Văn An');
    expect(serialized).not.toContain('an@example.com');
    expect(JSON.parse(serialized)).toMatchObject({
      incident_category_code: 'MEDICAL',
      description: '',
      people_affected: 1,
    });
  });

  it('preserves title-case emergency facts when redaction is explicitly enabled', () => {
    expect(sanitizeAiDescription('Nước Đang Dâng; Cần Cấp Cứu')).toBe('Nước Đang Dâng; Cần Cấp Cứu');
    process.env.GEMINI_ADVISORY_INCLUDE_REDACTED_TEXT = 'true';
    expect(buildAiAssessmentInput({ incidentCategoryCode: 'FLOOD', description: 'Nước Đang Dâng' }).description).toBe('Nước Đang Dâng');
  });

  it('abstains when counts and the incident narrative are unknown', () => {
    expect(scoreRequestRisk({ needsRescue: true, reporterDeclaredDanger: true }).score).toBeNull();
  });

  it.each([{ elderlyCount: 1 }, { childrenCount: 2 }, { peopleAffected: 20 }])('does not infer low urgency from population modifiers alone: %j', (counts) => {
    expect(scoreRequestRisk({ ...counts, description: null, needsRescue: true }).score).toBeNull();
  });

  it('does not label emergency medical symptoms as STANDARD before validated triage rules exist', () => {
    const risk = scoreRequestRisk({
      description: 'Có người bất tỉnh, khó thở.', peopleAffected: 1,
      needsRescue: false, needsReliefSupplies: true,
    });

    expect(risk.score).toBeNull();
    expect(risk.reasonCodes).toContain('URGENT_MEDICAL_REVIEW_REQUIRED');
  });
});
