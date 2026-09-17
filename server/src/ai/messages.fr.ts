// French strings produced by the AI layer: child messages not covered by KID_MESSAGES and parent alert details.
import { KID_MESSAGES, type AIOperation, type AIUnavailableReason } from '@aide/shared';

export const AI_KID_MESSAGES_FR = {
  handwritingUnreadable: "Je n'arrive pas à lire ton écriture. Tu peux réessayer ou écrire avec le clavier.",
} as const;

export function unavailableMessage(reason: AIUnavailableReason): string {
  switch (reason) {
    case 'quota': return KID_MESSAGES.quota;
    case 'budget': return KID_MESSAGES.budget;
    case 'offline': return KID_MESSAGES.offline;
    default: return KID_MESSAGES.unavailable;
  }
}

const OPERATION_LABELS_FR: Record<AIOperation, string> = {
  explain_word: 'Explique (un mot)',
  explain_text: 'Explique (un passage)',
  simplify_text: 'Simplifie',
  summarize: 'Résumé',
  generate_questions: 'Questions sur le texte',
  correct_answer: 'Correction d’une réponse',
  question_on_text: 'Une question sur le texte',
  recognize_handwriting: 'Lecture de l’écriture',
};

function excerpt(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function pageLabel(pageIndex: number | null): string {
  return pageIndex === null ? '' : ` (page ${pageIndex + 1})`;
}

export const ALERT_DETAILS_FR = {
  adultRedirect: (op: AIOperation, childText: string) =>
    `${OPERATION_LABELS_FR[op]} : votre enfant a écrit un message qui peut exprimer une détresse ou une situation difficile. Message : « ${excerpt(childText)} ». Il a été invité à en parler avec un adulte de confiance.`,
  safetyInputChild: (op: AIOperation, childText: string) =>
    `${OPERATION_LABELS_FR[op]} : la demande écrite par votre enfant contient un contenu inadapté et n’a pas été envoyée à l’IA. Message : « ${excerpt(childText)} ».`,
  safetyInputDocument: (op: AIOperation, pageIndex: number | null, ref: string) =>
    `${OPERATION_LABELS_FR[op]} : un passage du document${pageLabel(pageIndex)} contient un contenu inadapté pour un enfant. L’aide IA a été refusée pour ce passage. Réf. ${ref}.`,
  safetyOutput: (op: AIOperation, ref: string) =>
    `${OPERATION_LABELS_FR[op]} : une réponse de l’IA a été bloquée par les contrôles de sécurité et n’a pas été montrée à votre enfant. Réf. ${ref}.`,
  injection: (op: AIOperation, pageIndex: number | null, suspicious: string) =>
    `${OPERATION_LABELS_FR[op]} : le document${pageLabel(pageIndex)} contient des phrases qui ressemblent à des consignes pour l’IA (« ${excerpt(suspicious, 160)} »). Elles ont été traitées comme du simple texte.`,
  injectionOutput: (op: AIOperation, ref: string) =>
    `${OPERATION_LABELS_FR[op]} : une réponse de l’IA semblait suivre des consignes cachées dans le document. Elle a été bloquée. Réf. ${ref}.`,
  budgetWarning: (spentEur: number, budgetEur: number) =>
    `Le budget IA du mois a atteint 80 % : ${spentEur.toFixed(2).replace('.', ',')} € sur ${budgetEur.toFixed(2).replace('.', ',')} €.`,
} as const;
