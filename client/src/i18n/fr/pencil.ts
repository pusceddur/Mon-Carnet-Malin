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

  errors: {
    saveFailed: 'Ton trait n’a pas pu être enregistré. Réessaie.',
    eraseFailed: 'La gomme n’a pas marché. Réessaie.',
    undoFailed: 'Impossible d’annuler pour le moment.',
  },
} as const;
