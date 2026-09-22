// French UI strings for the "reader" area. Placeholders use {name}.
export const reader = {
  loading: 'J’ouvre ton livre…',
  notFound: {
    title: 'Je ne trouve pas ce livre',
    message: 'Il n’est pas sur cet iPad pour le moment.',
    action: '📚 Mes livres',
  },

  header: {
    back: 'Retour à mes livres',
    pageOf: 'Page {current} / {total}',
    modeLabel: 'Mode du lecteur',
    modeLecture: 'Lecture',
    modeAnnotation: 'Annotation',
    settings: 'Réglages de lecture',
    listen: 'Écouter le texte',
    listenClose: 'Fermer la lecture à voix haute',
    menu: 'Plus d’options',
  },

  menu: {
    title: 'Plus d’options',
    question: '❓ Une question sur le texte',
    exercises: '🧠 Exercices',
    summary: '📝 Résumé',
    showOriginal: '🖼️ Voir la page originale',
    showText: '📖 Voir le texte',
  },

  nav: {
    label: 'Changer de page',
    previous: '◀ Page précédente',
    next: 'Page suivante ▶',
    previousLabel: 'Page précédente',
    nextLabel: 'Page suivante',
  },

  page: {
    label: 'Page {page}',
    notReady: 'Cette page se prépare. Tu peux lire les autres pages.',
    noText: 'Il n’y a pas de texte sur cette page.',
  },

  original: {
    title: 'Page originale',
    alt: 'Photo de la page {page}',
    loading: 'Je charge l’image…',
    unavailable: 'Image non disponible sur cet appareil',
    zoomIn: 'Agrandir',
    zoomOut: 'Rétrécir',
    zoomReset: 'Taille normale',
    zoomValue: '{value}×',
  },

  selection: {
    toolbarLabel: 'Que veux-tu faire avec ce texte ?',
    read: 'Lire',
    definition: 'Définition',
    explain: 'Explique',
    simplify: 'Simplifie',
    highlight: 'Surligner',
    unhighlight: 'Enlever',
    unhighlightLabel: 'Enlever le surlignage',
    previousWord: '◀ Mot précédent',
    nextWord: 'Mot suivant ▶',
    previousWordLabel: 'Ajouter le mot précédent',
    nextWordLabel: 'Ajouter le mot suivant',
    sentence: 'Toute la phrase',
    paragraph: 'Tout le paragraphe',
    close: 'Fermer',
    tooLong: 'C’est un peu long. Choisis un morceau plus petit.',
    highlighted: 'C’est surligné !',
    unhighlighted: 'Le surlignage est enlevé.',
    highlightFailed: 'Je n’ai pas réussi à surligner. Réessaie.',
  },

  quote: {
    notFound: 'Je n’ai pas retrouvé ce passage exact, mais tu es sur la bonne page.',
  },

  guide: {
    handle: 'Règle de lecture : fais glisser pour la déplacer',
  },

  settings: {
    title: 'Réglages de lecture',
    preview: 'Le petit renard lit un livre sous le grand arbre.',
    fontSample: 'Aa',
    sectionText: 'Le texte',
    sectionSpace: 'Les espaces',
    sectionDisplay: 'L’affichage',
    sectionVoice: 'La voix',
    font: 'Police',
    fontSize: 'Taille des lettres',
    lineHeight: 'Espace entre les lignes',
    letterSpacing: 'Espace entre les lettres',
    wordSpacing: 'Espace entre les mots',
    columnWidth: 'Largeur du texte',
    theme: 'Couleur du fond',
    palette: 'Couleurs de l’app',
    layout: 'Façon de lire',
    layoutPage: 'Page par page',
    layoutContinu: 'Texte continu',
    sentenceHighlight: 'Montrer la phrase lue',
    sentenceHighlightHint: 'La phrase lue à voix haute est colorée.',
    readingGuide: 'Règle de lecture',
    readingGuideHint: 'Une bande t’aide à suivre la ligne.',
    rate: 'Vitesse de la voix',
    voice: 'Voix de cet appareil',
    voiceTest: '🔊 Écouter la voix',
    reset: 'Revenir aux réglages de départ',
    values: {
      px: '{value} px',
      times: '{value}×',
      em: '{value}',
    },
  },
} as const;
