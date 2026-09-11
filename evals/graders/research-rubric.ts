import type { AssertionResult, EvalResult } from '../contracts.ts';

export const researchDimensions = [
  'analyticsScope',
  'informationGap',
  'sourceAssessment',
  'responsiveFollowUp',
  'usefulHypothesis',
] as const;

export type ResearchDimension = typeof researchDimensions[number];
export type ResearchRubricScores = Record<ResearchDimension, 0 | 1 | 2>;

export function gradeResearchRubric(caseId: string, scores: ResearchRubricScores, hardResult: EvalResult): EvalResult {
  if (hardResult.status !== 'pass') {
    return { ...hardResult, caseId, reason: `Semantic score cannot override hard result: ${hardResult.reason ?? hardResult.status}` };
  }
  const total = researchDimensions.reduce((sum, dimension) => sum + scores[dimension], 0);
  const noZero = researchDimensions.every((dimension) => scores[dimension] > 0);
  const assertions: AssertionResult[] = [
    ...hardResult.assertions,
    { name: 'semantic score is at least 8/10', passed: total >= 8, evidence: { total, scores } },
    { name: 'no semantic dimension is absent', passed: noZero, evidence: researchDimensions.filter((dimension) => scores[dimension] === 0) },
  ];
  const passed = total >= 8 && noZero;
  return { caseId, status: passed ? 'pass' : 'fail', assertions, ...(passed ? {} : { reason: 'Research rubric gate failed' }) };
}
