import type { AIPageInput } from '../../src/types/ai';

const HASH = 'e'.repeat(64);

export function pageInput(pageIndex: number, text: string, ocrLowConfidence = false): AIPageInput {
  return { pageIndex, text, contentHash: HASH, ocrLowConfidence };
}

export const VOLCANS_PAGES: AIPageInput[] = [
  pageInput(0, [
    'Les volcans',
    'Un volcan est une montagne qui peut cracher de la lave. La lave est une roche fondue très chaude. Elle vient de l’intérieur de la Terre.',
    'Sous le volcan se trouve une grande poche de roche fondue. Quand la pression devient trop forte, le volcan entre en éruption. La lave sort alors par le cratère.',
  ].join('\n\n')),
  pageInput(1, [
    'Certains volcans sont endormis depuis très longtemps. Les scientifiques surveillent les volcans pour prévenir les habitants. Ils mesurent les mouvements du sol et les gaz.',
    'Autour des volcans, la terre est souvent très fertile. Les agriculteurs y cultivent des légumes et des fruits. Les cendres du volcan enrichissent le sol.',
  ].join('\n\n')),
  pageInput(2, [
    'Il existe des volcans sous la mer. Leur lave refroidit vite dans l’eau froide. Parfois, elle forme de nouvelles îles au milieu de l’océan.',
    'Les volcans sont impressionnants, mais on peut les observer sans danger avec un guide.',
  ].join('\n\n')),
];

export const HISTOIRE_PAGES: AIPageInput[] = [
  pageInput(3, [
    'Le petit renard vivait au bord de la forêt avec sa mère. Chaque matin, il sortait du terrier pour chercher des baies. Un jour, il découvrit une cabane abandonnée près du ruisseau.',
    'La cabane était remplie de vieux livres couverts de poussière. Le renard ouvrit le premier livre et regarda les images. Il y vit des montagnes, des bateaux et des villes lointaines.',
  ].join('\n\n')),
  pageInput(4, [
    'Le soir, il raconta sa découverte à sa mère. Elle écouta son fils avec attention et sourit. Le lendemain, ils retournèrent ensemble à la cabane.',
    '— Maman, est-ce que nous pourrons voyager un jour ? demanda le renard.',
    'Sa mère répondit que les livres permettent déjà de voyager très loin. Le petit renard décida de lire un livre chaque semaine.',
  ].join('\n\n')),
];
