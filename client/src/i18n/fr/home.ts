// French UI strings of the child home and the child selection screen. Placeholders use {name}.
export const home = {
  documentTitle: 'Accueil',
  greeting: 'Bonjour {prenom} !',
  greetingNoName: 'Bonjour !',
  tiles: {
    books: 'Mes livres',
    continue: 'Continuer la lecture',
    exercises: 'Exercices',
    notes: 'Mes notes',
  },
  continuePage: 'Page {page}',
  continueNone: 'Choisis un livre',
  parentAccess: 'Réglages',
  switchChild: 'Changer de lecteur',
  update: {
    message: 'Une nouvelle version est prête.',
    action: 'Mettre à jour',
  },

  childSelect: {
    documentTitle: 'Qui lit ?',
    title: 'Qui lit aujourd’hui ?',
    choose: 'C’est moi, {prenom}',
    emptyTitle: 'Pas encore de profil',
    emptyMessage: 'Un adulte peut créer ton profil dans les réglages.',
    emptyAction: 'Réglages',
  },
} as const;
