// STUB: shared-core
import type { AnswerResponse, Question, Verdict } from '../types/exercises';

// null for reponse_libre; French kind feedback; 'association'/'ordre': partiel if >= 50% correct
export function correctClosedAnswer(q: Question, r: AnswerResponse): { verdict: Verdict; feedback: string } | null {
  if (q.type === 'reponse_libre' || r.type === 'reponse_libre') return null;
  let ok = false;
  if (q.type === 'qcm' && r.type === 'qcm') ok = q.correctIndex === r.choiceIndex;
  else if (q.type === 'vrai_faux' && r.type === 'vrai_faux') ok = q.answer === r.value;
  return ok
    ? { verdict: 'correct', feedback: 'Bravo !' }
    : { verdict: 'incorrect', feedback: 'Pas tout à fait. Relis le passage et essaie encore.' };
}
