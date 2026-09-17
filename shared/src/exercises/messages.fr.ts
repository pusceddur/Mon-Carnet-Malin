// Child-facing French texts produced by the local exercise logic (« tu », short and kind).

export const EXERCISE_TEXTS_FR = {
  correct: [
    'Bravo, c’est la bonne réponse !',
    'Exactement ! Tu as bien lu.',
    'Oui, c’est juste. Bien joué !',
  ],
  qcmIncorrect: 'Pas tout à fait. La bonne réponse est « {answer} ».',
  vraiFauxShouldBeTrue: 'Pas tout à fait : d’après le texte, c’est vrai.',
  vraiFauxShouldBeFalse: 'Pas tout à fait : d’après le texte, c’est faux.',
  associationPartial: 'Presque ! Tu as trouvé {found} bonnes paires sur {total}. Regarde encore les autres.',
  associationIncorrect: 'Ce n’est pas encore ça : tu as trouvé {found} bonne paire sur {total}.',
  associationIncorrectPlural: 'Ce n’est pas encore ça : tu as trouvé {found} bonnes paires sur {total}.',
  ordrePartial: 'Presque ! Une bonne partie est dans l’ordre. Regarde encore où vont les autres phrases.',
  ordreIncorrect: 'L’ordre n’est pas encore le bon.',
  rereadAndRetry: 'Relis le passage du texte, puis essaie encore.',
  rereadToUnderstand: 'Relis le passage pour bien comprendre.',
  // Local question generation
  qcmPrompt: 'Quel mot manque ? « {sentence} »',
  qcmExplanation: 'Dans le texte, on lit : « {sentence} »',
  vraiFauxPrompt: 'D’après le texte, est-ce vrai ou faux ? « {sentence} »',
  vraiFauxExplanation: 'C’est vrai : cette phrase est écrite dans le texte.',
  ordrePrompt: 'Remets ces phrases dans l’ordre du texte.',
  blank: '_____',
} as const;

export function formatText(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}
