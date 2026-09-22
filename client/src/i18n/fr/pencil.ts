// French UI strings for the "pencil" area (annotations, toolbar, answer pad). Placeholders use {name}.
export const pencil = {
  toolbar: {
    label: 'Outils pour écrire',
    pencil: 'Crayon',
    pen: 'Stylo',
    highlighter: 'Surligneur',
    eraser: 'Gomme',
    undo: 'Annuler',
    redo: 'Refaire',
    colors: 'Couleur et épaisseur',
    more: 'Plus d’options',
    close: 'Fermer',
  },

  colors: {
    title: 'Couleur',
    noir: 'Noir',
    bleu: 'Bleu',
    rouge: 'Rouge',
    vert: 'Vert',
    violet: 'Violet',
    jaune: 'Jaune',
    vertClair: 'Vert clair',
    bleuClair: 'Bleu clair',
    rose: 'Rose',
  },

  thickness: {
    title: 'Épaisseur',
    fin: 'Fin',
    moyen: 'Moyen',
    epais: 'Épais',
  },

  eraser: {
    title: 'Gomme',
    stroke: 'Effacer le trait',
    partial: 'Gomme partielle',
    page: 'Effacer la page',
    strokeHint: 'Touche un trait pour l’effacer en entier.',
    partialHint: 'Frotte pour effacer seulement un morceau.',
    pageHint: 'Touche la page pour tout effacer.',
  },

  more: {
    title: 'Options',
    fingerDraws: 'Dessiner avec le doigt',
    fingerDrawsHint: 'Pour un iPad sans Apple Pencil. Le doigt ne fait plus défiler la page.',
    backToReading: 'Revenir à la lecture',
  },

  clearPage: {
    title: 'Effacer toute la page ?',
    message: 'Tous tes traits et tes surlignages de cette page vont disparaître. Tu pourras annuler avec ↩️.',
    confirm: 'Tout effacer',
    cancel: 'Garder',
  },

  answerPad: {
    tabsLabel: 'Comment veux-tu répondre ?',
    draw: 'Dessiner',
    write: 'Écrire',
    drawArea: 'Case pour écrire ta réponse avec le crayon',
    drawHint: 'Écris ou dessine ta réponse dans la case.',
    writeLabel: 'Ta réponse',
    writePlaceholder: 'Écris ta réponse ici…',
    scribbleHint: 'Écris directement avec ton Apple Pencil dans la case',
    tools: 'Outils de la case',
    pencil: 'Crayon',
    eraser: 'Gomme',
    undo: 'Annuler',
    redo: 'Refaire',
    clear: 'Tout effacer',
    clearTitle: 'Effacer ta réponse dessinée ?',
    clearMessage: 'Tout ce que tu as écrit dans la case va disparaître. Tu pourras annuler avec ↩️.',
    clearConfirm: 'Tout effacer',
    clearCancel: 'Garder',
    fingerDraws: 'Dessiner avec le doigt',
  },

  notes: {
    detached: 'Note détachée du texte',
  },

  /** §19.2 text boxes on the original page. */
  textBox: {
    tool: 'Écrire du texte',
    toolHint: 'Touche la page là où tu veux écrire.',
    label: 'Zone de texte',
    placeholder: 'Écris ici…',
    tools: 'Outils de la zone de texte',
    read: 'Lire mon texte',
    smaller: 'Texte plus petit',
    bigger: 'Texte plus grand',
    color: 'Changer la couleur',
    move: 'Déplacer la zone de texte',
    resize: 'Élargir ou rétrécir la zone de texte',
    remove: 'Supprimer la zone de texte',
    done: 'J’ai fini d’écrire',
    listen: 'Écouter : {text}',
    // §24 « Corriger » (shown when switched on in the Options).
    correct: 'Corriger mon texte',
    correcting: 'Correction en cours…',
    correctedOne: 'J’ai corrigé 1 petite faute ({kinds}).',
    correctedMany: 'J’ai corrigé {count} petites fautes ({kinds}).',
    correctNone: 'Bravo, je n’ai trouvé aucune faute !',
    correctChanged: 'Ton texte a changé pendant la correction : appuie encore sur « Corriger ».',
    // §24: said on its own line, because it is the only change that touches la façon dont la phrase est construite.
    correctedConstruction: 'J’ai aussi changé la construction d’une phrase pour que la grammaire soit juste.',
    correctedConstructionMany: 'J’ai aussi changé la construction de {count} phrases pour que la grammaire soit juste.',
    undo: 'Annuler',
    kinds: {
      accent: 'accents',
      orthographe: 'orthographe',
      grammaire: 'grammaire',
      construction: 'construction de la phrase',
      ponctuation: 'ponctuation',
      majuscule: 'majuscules',
      espace: 'espaces',
    },
  },

  errors: {
    saveFailed: 'Ton trait n’a pas pu être enregistré. Réessaie.',
    eraseFailed: 'La gomme n’a pas marché. Réessaie.',
    undoFailed: 'Impossible d’annuler pour le moment.',
  },
} as const;
