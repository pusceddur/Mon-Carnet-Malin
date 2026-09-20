// Reader model invariants with the real shared text functions (no mocks): whatever the segmenter decides,
// no character is lost, every word belongs to a sentence and offsets match the block text.
import { describe, expect, it } from 'vitest';
import { buildBlockModel, findQuote, type BlockModel } from '../../src/features/reader/model';

const SAMPLES = [
  'La photosynthèse est un processus biologique. Les plantes utilisent la lumière du Soleil !',
  '« Où vas-tu ? » demanda M. Dupont. — Je vais à l’école, répondit Léa.',
  'Il y avait 3,5 kg de pommes… et 12 poires. En 1789, la Révolution commença.',
  'L’arc-en-ciel apparaît après la pluie\nsans point final',
  '   ',
  'Chap. 2 : les volcans (p. 34)',
];

function flatten(model: BlockModel): string {
  return model.segments
    .map((s) => (s.kind === 'gap' ? s.text : s.sentence.parts.map((p) => (p.kind === 'text' ? p.text : p.word.text)).join('')))
    .join('');
}

describe('reader model with shared text functions', () => {
  for (const text of SAMPLES) {
    it(`keeps every character and word: ${JSON.stringify(text.slice(0, 30))}`, () => {
      const model = buildBlockModel(0, 0, { kind: 'paragraph', text }, 'h');
      expect(flatten(model)).toBe(text);
      const inSentences = model.sentences.flatMap((s) => s.words);
      expect(inSentences).toEqual(model.words);
      for (const word of model.words) expect(text.slice(word.offset, word.end)).toBe(word.text);
      model.sentences.forEach((s, i) => {
        expect(s.index).toBe(i);
        expect(text.slice(s.start, s.end)).toBe(s.text);
      });
    });
  }

  it('finds quotes with the real tokenizer', () => {
    const model = buildBlockModel(0, 0, { kind: 'paragraph', text: SAMPLES[1] ?? '' }, 'h');
    expect(findQuote([model], 'je vais a l’ecole')).not.toBeNull();
  });
});

describe('§22 text prepared for the voice (real segmentation)', () => {
  it('gives each sentence its part of the prepared block, while the words match', () => {
    const text = "Consignes 1: lis l'article 2: souligne les verbes";
    const spoken = "Consignes. 1. Lis l'article. 2. Souligne les verbes.";
    const block = buildBlockModel(0, 0, { kind: 'paragraph', text, spoken }, 'h');
    expect(block.sentences.map((s) => [s.text, s.spoken])).toEqual([
      ['Consignes', 'Consignes.'],
      ["1: lis l'article", "1. Lis l'article."],
      ['2: souligne les verbes', '2. Souligne les verbes.'],
    ]);
    const stale = buildBlockModel(0, 0, { kind: 'paragraph', text: 'Autre texte.', spoken }, 'h');
    expect(stale.sentences.map((s) => s.spoken)).toEqual([null]);
  });
});
