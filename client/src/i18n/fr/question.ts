// French UI strings of « Pose ta question » (free question, child screen). The child is addressed with « tu ».
// Blocked / redirected messages come from KID_MESSAGES (shared constants) or from the server. Placeholders use {name}.
export const question = {
  documentTitle: 'Pose ta question',
  title: 'Pose ta question',
  back: 'Accueil',

  form: {
    label: 'Ta question',
    hint: 'Écris-la, ou parle avec le micro du clavier.',
    placeholder: 'Par exemple : pourquoi le ciel est bleu ?',
    counter: '{count} / {max}',
    counterLabel: '{count} caractères sur {max}',
    tooLong: 'Ta question est un peu longue. Essaie de la raccourcir.',
    submit: 'Demander',
    offline: 'Il faut Internet pour poser une question. Tu peux lire tes livres en attendant.',
  },

  waiting: {
    normal: 'Je réfléchis…',
    simpler: 'Je cherche une façon plus simple de t’expliquer…',
    stop: 'Arrêter',
  },

  answer: {
    title: 'Voici la réponse',
    yourQuestion: 'Ta question :',
    example: 'Exemple :',
    listen: 'Écouter',
    listenLabel: 'Écouter la réponse',
    notUnderstood: 'Je n’ai pas compris',
    suggestionsTitle: 'Tu veux savoir autre chose ?',
    newQuestion: 'Nouvelle question',
  },

  message: {
    listen: 'Écouter',
    listenLabel: 'Écouter le message',
    retry: 'Réessayer',
    newQuestion: 'Nouvelle question',
    offline: 'Pas de connexion pour le moment. Réessaie quand Internet revient.',
  },

  disabled: {
    title: 'Pas de questions pour le moment',
    message: 'Si tu te demandes quelque chose, demande à un adulte.',
    home: 'Revenir à l’accueil',
  },
} as const;
