import { buildAiAssessmentInput, serializeAiAssessmentInput, sanitizeAiDescription, scoreRequestRisk } from '../src/ai/ai-risk';

describe('Gemini assessment input', () => {
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

  it('excludes narrative by default and masks direct identifiers only when explicitly enabled', () => {
    const facts = {
      incidentCategoryCode: 'FLOOD',
      description: 'Nước lũ dâng nhanh, 4 người mắc kẹt. Tôi tên là Nguyễn Văn An, email an@example.com.',
      peopleAffected: 4,
      childrenCount: null,
      elderlyCount: null,
      reporterDeclaredDanger: false,
      needsRescue: true,
      needsReliefSupplies: false,
    };

    const serialized = serializeAiAssessmentInput(facts, true);

    expect(buildAiAssessmentInput(facts).description).toBe('');
    expect(serializeAiAssessmentInput(facts)).not.toContain(facts.description);
    expect(serialized).toBe(serializeAiAssessmentInput(facts, true));
    expect(serialized).not.toContain('Nguyễn Văn An');
    expect(serialized).not.toContain('an@example.com');
    expect(JSON.parse(serialized)).toMatchObject({
      incident_category_code: 'FLOOD',
      description: 'Nước lũ dâng nhanh, 4 người mắc kẹt. [đã ẩn tên], email [đã ẩn email].',
      people_affected: 4,
    });
  });

  it('preserves title-case emergency facts only in explicitly enabled synthetic narratives', () => {
    expect(sanitizeAiDescription('Nước Đang Dâng; Cần Cấp Cứu')).toBe('Nước Đang Dâng; Cần Cấp Cứu');
    expect(buildAiAssessmentInput({ incidentCategoryCode: 'FLOOD', description: 'Nước Đang Dâng' }).description).toBe('');
    expect(buildAiAssessmentInput({ incidentCategoryCode: 'FLOOD', description: 'Nước Đang Dâng' }, true).description).toBe('Nước Đang Dâng');
  });

  it('masks exact coordinates, signed URLs, and credential assignments', () => {
    const sanitized = sanitizeAiDescription(
      'Nước lũ dâng nhanh. Link https://a.vn/p?token=abc_1234567890; vị trí 10.7769 106.7009; secret=secret_1234567890; "access_token":"json_credential_1234567890"',
    );
    expect(sanitized).toContain('Nước lũ dâng nhanh.');
    expect(sanitized).not.toMatch(/https?:\/\/|abc_1234567890|10\.7769|106\.7009|secret_1234567890/u);
    expect(sanitized).not.toContain('json_credential_');
  });

  it('masks only the name and preserves symptoms that follow it', () => {
    const sanitized = sanitizeAiDescription('Tôi tên An đang khó thở; tôi tên Bình đau ngực, 2 người cần cứu.');
    expect(sanitized).toContain('[đã ẩn tên]');
    expect(sanitized).toContain('đang khó thở');
    expect(sanitized).toContain('đau ngực');
    expect(sanitized).toContain('2 người cần cứu.');
  });

  it('does not truncate the incident narrative before sending it to Gemini', () => {
    const narrative = `${'x'.repeat(2_000)}; cần cứu.`;
    expect(sanitizeAiDescription(narrative)).toBe(narrative);
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
