// French UI strings shared by every area (ui-kit). Placeholders use {name}.
export const common = {
  back: 'Retour',
  close: 'Fermer',
  cancel: 'Annuler',
  validate: 'Valider',
  save: 'Enregistrer',
  saved: 'Enregistré',
  yes: 'Oui',
  no: 'Non',
  ok: 'D’accord',
  continue: 'Continuer',
  next: 'Suivant',
  previous: 'Précédent',
  edit: 'Modifier',
  delete: 'Supprimer',
  retry: 'Réessayer',
  done: 'Terminé',
  loading: 'Chargement…',
  pleaseWait: 'Un instant…',
  offline: 'Hors ligne',
  online: 'En ligne',
  offlineHint: 'Pas de connexion. Tu peux continuer à lire.',
  genericError: 'Oups, quelque chose n’a pas marché. Réessaie dans un instant.',
  optional: 'facultatif',
  required: 'obligatoire',

  toast: {
    regionLabel: 'Messages',
    dismiss: 'Fermer le message',
  },

  progress: {
    percent: '{value}\u202F%', // narrow no-break space (French typography)
  },

  slider: {
    decrease: 'Diminuer : {label}',
    increase: 'Augmenter : {label}',
  },

  pin: {
    backspace: 'Effacer le dernier chiffre',
    countOne: '1 chiffre',
    countMany: '{count} chiffres',
    countOf: '{digits} sur {total}',
    submit: 'Valider le code',
  },

  readingFonts: {
    lexend: 'Lexend',
    andika: 'Andika',
    atkinson: 'Atkinson Hyperlegible',
    opendyslexic: 'OpenDyslexic',
    systeme: 'Police de l’iPad',
  },

  themes: {
    creme: 'Crème',
    clair: 'Clair',
    sombre: 'Sombre',
  },

  unsupported: {
    documentTitle: 'Navigateur non pris en charge',
    title: 'Ce navigateur n’est pas pris en charge',
    intro: '{app} a besoin d’un iPad à jour pour fonctionner.',
    askAdult: 'Demande à un adulte de t’aider.',
    stepsTitle: 'Pour l’adulte',
    stepUpdate: 'Mets à jour l’iPad : Réglages › Général › Mise à jour logicielle (iPadOS 18 ou plus récent).',
    stepSafari: 'Ouvre ensuite l’app avec Safari.',
    stepLockdown: 'Si le mode Isolement est activé, l’app ne peut pas fonctionner : Réglages › Confidentialité et sécurité › Mode Isolement.',
    detailsTitle: 'Détails techniques',
    missingLabel: 'Fonctions manquantes :',
    retry: 'Réessayer',
  },
  routeError: {
    documentTitle: 'Petit problème',
    title: 'Oups, cette page ne s’est pas ouverte',
    lead: 'Ce n’est pas grave. Tu peux réessayer ou revenir à l’accueil.',
    offline: 'Il faut peut-être une connexion Internet pour l’ouvrir la première fois.',
    retry: 'Réessayer',
    home: 'Revenir à l’accueil',
  },
} as const;
