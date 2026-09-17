import { describe, expect, it } from 'vitest';
import { blocksToPlainText, buildBlocksFromLines, type LayoutLine } from '../../src/text/blocks';
import { joinOcrLines } from '../../src/text/dehyphenate';

describe('joinOcrLines', () => {
  it('joins lines with single spaces and skips empty lines', () => {
    expect(joinOcrLines(['  Le chat ', '', 'dort   bien.'])).toBe('Le chat dort bien.');
    expect(joinOcrLines([])).toBe('');
  });

  it('removes the line-end hyphen when both sides are lowercase', () => {
    expect(joinOcrLines(['La pho-', 'tosynthèse nourrit la plante.'])).toBe('La photosynthèse nourrit la plante.');
    expect(joinOcrLines(['un élé‐', 'phant'])).toBe('un éléphant');
    expect(joinOcrLines(['une mon¬', 'tagne'])).toBe('une montagne');
  });

  it('joins soft hyphen breaks', () => {
    expect(joinOcrLines(['pa­', 'pillon'])).toBe('papillon');
  });

  it('keeps the hyphen before an uppercase letter or a digit', () => {
    expect(joinOcrLines(['Jean-', 'Pierre arrive.'])).toBe('Jean-Pierre arrive.');
    expect(joinOcrLines(['de 1914-', '1918'])).toBe('de 1914-1918');
    expect(joinOcrLines(['SAINT-', 'MALO'])).toBe('SAINT-MALO');
  });

  it('keeps the hyphen of real compounds', () => {
    expect(joinOcrLines(['un arc-en-', 'ciel'])).toBe('un arc-en-ciel');
    expect(joinOcrLines(['c’est-à-', 'dire'])).toBe('c’est-à-dire');
  });

  it('uses the known-word callback when provided', () => {
    const known = new Set(['grand', 'mère', 'photo', 'photographie', 'graphie']);
    const isKnown = (w: string): boolean => known.has(w);
    expect(joinOcrLines(['ma grand-', 'mère'], isKnown)).toBe('ma grand-mère');
    expect(joinOcrLines(['une photo-', 'graphie'], isKnown)).toBe('une photographie');
    expect(joinOcrLines(['ma grand-', 'mère'])).toBe('ma grandmère');
  });

  it('keeps a spaced dash as punctuation', () => {
    expect(joinOcrLines(['Il partit -', 'vite.'])).toBe('Il partit - vite.');
  });
});

function line(text: string, top: number, opts: Partial<LayoutLine> = {}): LayoutLine {
  return { text, top, height: 20, left: 50, ...opts };
}

describe('buildBlocksFromLines', () => {
  it('returns nothing for empty input', () => {
    expect(buildBlocksFromLines([])).toEqual([]);
    expect(buildBlocksFromLines([line('   ', 0)])).toEqual([]);
  });

  it('splits paragraphs on vertical gaps and joins hyphenated lines', () => {
    const blocks = buildBlocksFromLines([
      line('Les volcans sont des montagnes qui peuvent cracher de la', 100),
      line('lave. Certains sont endormis depuis très long-', 124),
      line('temps et ne sont plus dangereux pour personne.', 148),
      line('La lave est une roche fondue très chaude qui coule sur', 200),
      line('les pentes et refroidit lentement.', 224),
    ]);
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Les volcans sont des montagnes qui peuvent cracher de la lave. Certains sont endormis depuis très longtemps et ne sont plus dangereux pour personne.' },
      { kind: 'paragraph', text: 'La lave est une roche fondue très chaude qui coule sur les pentes et refroidit lentement.' },
    ]);
  });

  it('splits short paragraphs whose gaps outnumber the line breaks (OCR page with two-line paragraphs)', () => {
    const blocks = buildBlocksFromLines([
      line('Au pied de la montagne, le village dormait encore. Léo ouvrit la', 100, { height: 30 }),
      line('fenêtre et regarda le sommet.', 145, { height: 30 }),
      line('Depuis trois jours, le volcan fumait sans bruit. Les habitants', 211, { height: 30 }),
      line('avaient pris l’habitude de cette petite colonne grise.', 256, { height: 30 }),
      line('Ce matin-là, une lueur rouge apparut. La lave coulait lentement', 322, { height: 30 }),
      line('sur la pente nord, loin des maisons.', 367, { height: 30 }),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      'Au pied de la montagne, le village dormait encore. Léo ouvrit la fenêtre et regarda le sommet.',
      'Depuis trois jours, le volcan fumait sans bruit. Les habitants avaient pris l’habitude de cette petite colonne grise.',
      'Ce matin-là, une lueur rouge apparut. La lave coulait lentement sur la pente nord, loin des maisons.',
    ]);
  });

  it('keeps one paragraph when OCR line tops jitter by a few pixels', () => {
    const tops = [100, 146, 189, 236, 280, 327];
    const blocks = buildBlocksFromLines(tops.map((top, i) => line(`Une ligne de texte assez longue numéro ${i + 1} qui continue`, top, { height: 30 })));
    expect(blocks).toHaveLength(1);
  });

  it('splits paragraphs on first-line indents', () => {
    const blocks = buildBlocksFromLines([
      line('Le chat dormait au soleil depuis le début de l’après-midi.', 100),
      line('Il ronronnait doucement.', 124),
      line('Soudain, un bruit le réveilla dans le jardin du voisin.', 148, { left: 80 }),
      line('Il ouvrit un œil.', 172),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      'Le chat dormait au soleil depuis le début de l’après-midi. Il ronronnait doucement.',
      'Soudain, un bruit le réveilla dans le jardin du voisin. Il ouvrit un œil.',
    ]);
  });

  it('detects titles from a larger font size', () => {
    const blocks = buildBlocksFromLines([
      line('Les volcans', 40, { height: 36, fontSize: 30 }),
      line('Un volcan est une montagne d’où sort parfois de la lave brûlante.', 100, { fontSize: 16 }),
      line('On en trouve sur tous les continents de la planète Terre.', 124, { fontSize: 16 }),
    ]);
    expect(blocks).toEqual([
      { kind: 'title', text: 'Les volcans' },
      { kind: 'paragraph', text: 'Un volcan est une montagne d’où sort parfois de la lave brûlante. On en trouve sur tous les continents de la planète Terre.' },
    ]);
  });

  it('detects titles from taller OCR lines, uppercase lines and short isolated lines', () => {
    const tall = buildBlocksFromLines([
      line('Chapitre deux', 40, { height: 34 }),
      line('Le lendemain matin, les enfants partirent tôt vers la forêt.', 100),
      line('Ils marchèrent longtemps sans rien dire à personne.', 124),
    ]);
    expect(tall[0]).toEqual({ kind: 'title', text: 'Chapitre deux' });

    const upper = buildBlocksFromLines([
      line('LA RESPIRATION', 40),
      line('Quand nous respirons, l’air entre dans nos poumons par le nez.', 100),
      line('Il ressort ensuite chargé d’un autre gaz.', 124),
    ]);
    expect(upper[0]).toEqual({ kind: 'title', text: 'LA RESPIRATION' });

    const isolated = buildBlocksFromLines([
      line('Le cycle de l’eau', 40),
      line('L’eau des océans s’évapore sous l’effet de la chaleur du soleil.', 100),
      line('La vapeur monte et forme des nuages dans le ciel bleu.', 124),
    ]);
    expect(isolated[0]).toEqual({ kind: 'title', text: 'Le cycle de l’eau' });
    expect(isolated[1]?.kind).toBe('paragraph');
  });

  it('does not take a short last line of a paragraph for a title', () => {
    const blocks = buildBlocksFromLines([
      line('La souris courut se cacher derrière le grand buffet de la cuisine.', 100),
      line('Le chat attendit.', 124),
    ]);
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'La souris courut se cacher derrière le grand buffet de la cuisine. Le chat attendit.' }]);
  });

  it('starts a new block on a column jump', () => {
    const blocks = buildBlocksFromLines([
      line('Première colonne du texte avec une phrase assez longue.', 500),
      line('Deuxième colonne du texte avec une autre phrase longue.', 100, { left: 400 }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it('blocksToPlainText joins blocks with a blank line', () => {
    expect(blocksToPlainText([{ kind: 'title', text: 'A' }, { kind: 'paragraph', text: 'B c.' }])).toBe('A\n\nB c.');
    expect(blocksToPlainText([])).toBe('');
  });
});
