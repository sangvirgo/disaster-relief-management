import type { EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { aiInputHash, buildAiAssessmentInput, scoreRequestRisk, type AiAssessmentFacts } from './ai-risk';

export interface StoredAssessmentFacts extends AiAssessmentFacts {
  version: number;
  workCycle: number;
}

export function aiAssessmentHash(facts: AiAssessmentFacts, requestVersion: number, workCycle: number): string {
  return aiInputHash(JSON.stringify({
    schema_version: 'v5', request_version: Number(requestVersion), work_cycle: Number(workCycle),
    input_mode: 'SANITIZED_NARRATIVE',
    input: buildAiAssessmentInput(facts),
  }));
}

export function isAiAdvisoryFresh(advisory: Record<string, unknown>, facts: AiAssessmentFacts, workCycle: number): boolean {
  const version = Number(advisory.request_version);
  return Number.isInteger(version) && version > 0 && advisory.input_hash === aiAssessmentHash(facts, version, workCycle);
}

export async function loadAssessmentFacts(manager: Pick<EntityManager, 'query'>, requestId: string): Promise<StoredAssessmentFacts> {
  const rows = await manager.query(
    `SELECT r.version,r.work_cycle AS "workCycle",r.incident_category_code AS "incidentCategoryCode",r.description,
            r.reporter_declared_danger AS "reporterDeclaredDanger",r.needs_rescue AS "needsRescue",
            r.needs_relief_supplies AS "needsReliefSupplies",s.people_affected AS "peopleAffected",
            s.children_count AS "childrenCount",s.elderly_count AS "elderlyCount"
       FROM assistance_request r JOIN request_subject s ON s.request_id=r.id WHERE r.id=$1`, [requestId],
  ) as StoredAssessmentFacts[];
  if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return rows[0];
}

export const assessmentFields = ['description', 'people_affected', 'children_count', 'elderly_count', 'reporter_declared_danger', 'needs_rescue', 'needs_relief_supplies'];

// Call inside the fact-update transaction: the hash always describes persisted values.
export async function enqueueAiAdvisory(manager: Pick<EntityManager, 'query'>, requestId: string): Promise<void> {
  const facts = await loadAssessmentFacts(manager, requestId);
  const risk = scoreRequestRisk(facts);
  await manager.query(
    `INSERT INTO ai_advisory (request_id,request_version,input_hash,model,prompt_version,schema_version,risk_score,reason_codes)
     VALUES ($1,$2,$3,$4,'v3','v4',$5,$6) ON CONFLICT (request_id,input_hash) DO NOTHING`,
    [requestId, Number(facts.version), aiAssessmentHash(facts, facts.version, facts.workCycle),
      process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite', risk.score, risk.reasonCodes],
  );
}
