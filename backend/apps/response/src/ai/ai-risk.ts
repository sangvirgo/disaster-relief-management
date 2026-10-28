import { createHash } from 'node:crypto';

export interface RiskFacts {
  description?: string | null;
  reporterDeclaredDanger?: boolean;
  peopleAffected?: number | null;
  childrenCount?: number | null;
  elderlyCount?: number | null;
  needsRescue?: boolean;
  needsReliefSupplies?: boolean;
}

export interface AiAssessmentFacts extends RiskFacts {
  incidentCategoryCode: string;
}

export interface AiAssessmentInput {
  incident_category_code: string;
  description: string;
  people_affected: number | null;
  children_count: number | null;
  elderly_count: number | null;
  reporter_declared_danger: boolean;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
}

const introducedName = /((?:[Tt]ôi\s+[Tt]ên(?:\s+[lL][àÀ])?|[Tt]ên\s+[Tt]ôi\s+[lL][àÀ]|[Nn]gười\s+[Tt]ên|(?:[Tt]ôi|[Mm]ình|[Ee]m|[Aa]nh|[Cc]hị)\s+[lL][àÀ])\s+)([\p{L}]+(?:\s+[\p{L}]+){0,3})/gu;

export function includeSyntheticDemoNarrative(): boolean {
  return process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE === 'true';
}

export function buildAiAssessmentInput(facts: AiAssessmentFacts, includeNarrative = includeSyntheticDemoNarrative()): AiAssessmentInput {
  return {
    incident_category_code: facts.incidentCategoryCode,
    description: includeNarrative ? sanitizeAiDescription(facts.description ?? '') : '',
    people_affected: facts.peopleAffected ?? null,
    children_count: facts.childrenCount ?? null,
    elderly_count: facts.elderlyCount ?? null,
    reporter_declared_danger: facts.reporterDeclaredDanger ?? false,
    needs_rescue: facts.needsRescue ?? false,
    needs_relief_supplies: facts.needsReliefSupplies ?? false,
  };
}

export function serializeAiAssessmentInput(facts: AiAssessmentFacts, includeNarrative = includeSyntheticDemoNarrative()): string {
  return JSON.stringify(buildAiAssessmentInput(facts, includeNarrative));
}

export function scoreRequestRisk(facts: RiskFacts): { score: number | null; reasonCodes: string[] } {
  const text = (facts.description ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, code: string) => { score += points; reasons.push(code); };
  // A reported life threat stays a prominent coordinator flag; it is not an automatic score input.
  if (facts.reporterDeclaredDanger) reasons.push('DECLARED_LIFE_DANGER');
  if (/lu lut|nuoc dang|nuoc len|mac ket|tren mai|bi co lap/.test(text)) add(25, 'FLOOD_OR_TRAPPED');
  if ((facts.childrenCount ?? 0) > 0) add(Math.min(20, 12 + Math.min(4, facts.childrenCount!) * 2), 'CHILDREN_PRESENT');
  if ((facts.elderlyCount ?? 0) > 0) add(10, 'ELDERLY_PRESENT');
  if ((facts.peopleAffected ?? 0) >= 10) {
    add(Math.min(12, 4 + Math.floor(((facts.peopleAffected ?? 10) - 10) / 10) * 2), 'LARGE_GROUP_AFFECTED');
  }
  const urgentMedicalRisk = /kho tho|bat tinh|ngat xiu|cap cuu/.test(text);
  if (urgentMedicalRisk) reasons.push('URGENT_MEDICAL_REVIEW_REQUIRED');
  else if (/bi thuong|chay mau/.test(text)) add(15, 'INJURY_OR_MEDICAL');
  const hasRiskEvidence = reasons.includes('FLOOD_OR_TRAPPED') || reasons.includes('INJURY_OR_MEDICAL');
  if (facts.needsRescue) add(6, 'RESCUE_REQUESTED');
  if (facts.needsReliefSupplies && !facts.needsRescue) add(3, 'RELIEF_SUPPLIES_ONLY');
  return { score: !urgentMedicalRisk && hasRiskEvidence ? Math.min(100, score) : null, reasonCodes: reasons };
}

export type RiskAttentionLevel = 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'STANDARD';

export function riskAttentionLevel(score: number | null): RiskAttentionLevel | null {
  if (score === null) return null;
  if (score >= 70) return 'CRITICAL';
  if (score >= 45) return 'HIGH';
  if (score >= 20) return 'ELEVATED';
  return 'STANDARD';
}

export function sanitizeAiDescription(value: string): string {
  return value
    .replace(introducedName, (_match, _intro: string, name: string) => {
      const words = name.split(/\s+/u);
      let nameWordCount = 1;
      while (nameWordCount < words.length && /^\p{Lu}/u.test(words[nameWordCount]!)) nameWordCount++;
      return ['[đã ẩn tên]', ...words.slice(nameWordCount)].join(' ');
    })
    .replace(/(?:địa\s+chỉ|số\s+nhà|ở\s+số)\s*[:#]?\s*[^,;\n]{1,100}/giu, '[đã ẩn địa chỉ]')
    .replace(/(?:tọa\s*độ|gps|coordinates?)\s*[:=]?\s*[+-]?\d{1,3}(?:\.\d+)?\s*[,; ]+\s*[+-]?\d{1,3}(?:\.\d+)?/giu, '[đã ẩn tọa độ]')
    .replace(/\b(?:https?|s3):\/\/[^\s<>"'`]+/giu, '[đã ẩn liên kết]')
    .replace(/\b(?:authorization|(?:x-)?tracking[-_ ]?(?:secret|code)|(?:access|refresh)[-_ ]?token|api[-_ ]?key|secret|token)["']?\s*[:=]\s*["']?(?:bearer\s+)?[^\s,;}"']+/giu, '[đã ẩn thông tin xác thực]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/giu, '[đã ẩn thông tin xác thực]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[đã ẩn email]')
    .replace(/(?<![\p{L}\p{N}_])(?:\+?84|0)?(?:\d[ ()-]?){7,14}\d(?![\p{L}\p{N}_])/gu, '[đã ẩn số điện thoại]')
    .replace(/(?<!\d)\d{9,12}(?!\d)/gu, '[đã ẩn dãy số]')
    .replace(/(?<![A-Z0-9])[0-9A-HJKMNP-TV-Z]{10,16}(?![A-Z0-9])/giu, '[đã ẩn mã theo dõi]')
    .replace(/(?<![\d.])[+-]?\d{1,3}\.\d{3,}(?:\s*[,;/]\s*|\s+)[+-]?\d{1,3}\.\d{3,}(?![\d.])/gu, '[đã ẩn tọa độ]')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function aiInputHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
