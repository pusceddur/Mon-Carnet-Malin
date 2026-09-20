import { describe, expect, it } from 'vitest';
import { segmentSentences } from '../../src/text/segment';

const sentences = (text: string): string[] => segmentSentences(text).map((s) => text.slice(s.start, s.end));

describe('segmentSentences', () => {
  it('splits simple sentences and trims spaces', () => {
    expect(sentences('  Le chat dort. Le chien joue !  Et toi ?  ')).toEqual(['Le chat dort.', 'Le chien joue !', 'Et toi ?']);
  });

  it('returns spans covering the sentence without outer spaces', () => {
    const text = ' Un.  Deux. ';
    expect(segmentSentences(text)).toEqual([{ start: 1, end: 4 }, { start: 6, end: 11 }]);
  });

  it('keeps a text without final punctuation as one sentence', () => {
    expect(sentences('Il était une fois un roi')).toEqual(['Il était une fois un roi']);
    expect(segmentSentences('   ')).toEqual([]);
    expect(segmentSentences('')).toEqual([]);
  });

  it('does not split after titles and abbreviations', () => {
    expect(sentences('M. Dupont et Mme Durand arrivent. Mlle Martin aussi.')).toEqual(['M. Dupont et Mme Durand arrivent.', 'Mlle Martin aussi.']);
    expect(sentences('MM. Petit et Grand sont là. Le Dr. Morel soigne. St. Malo est loin.')).toEqual(
      ['MM. Petit et Grand sont là.', 'Le Dr. Morel soigne.', 'St. Malo est loin.'],
    );
    expect(sentences('Voir p. 12 et pp. 14-15. Lis le chap. 3 et la fig. 2. Regarde le vol. 1.')).toEqual(
      ['Voir p. 12 et pp. 14-15.', 'Lis le chap. 3 et la fig. 2.', 'Regarde le vol. 1.'],
    );
    expect(sentences('Des fruits, par ex. Pommes et poires. Cf. Le livre rouge.')).toEqual(['Des fruits, par ex. Pommes et poires.', 'Cf. Le livre rouge.']);
    expect(sentences('Le n°. 5 gagne. Bravo.')).toEqual(['Le n°. 5 gagne.', 'Bravo.']);
  });

  it('handles av. J.-C. and apr. J.-C.', () => {
    expect(sentences('César arrive en 58 av. J.-C. et repart. Rome règne en 100 apr. J.-C. sur la Gaule.')).toEqual(
      ['César arrive en 58 av. J.-C. et repart.', 'Rome règne en 100 apr. J.-C. sur la Gaule.'],
    );
    expect(sentences('La Gaule est conquise en 50 av. J.-C. Les Gaulois deviennent romains.')).toEqual(
      ['La Gaule est conquise en 50 av. J.-C.', 'Les Gaulois deviennent romains.'],
    );
  });

  it('treats etc. as an end only before a capital', () => {
    expect(sentences('Des pommes, des poires, etc. Puis nous partons.')).toEqual(['Des pommes, des poires, etc.', 'Puis nous partons.']);
    expect(sentences('Des pommes, des poires, etc. et des noix.')).toEqual(['Des pommes, des poires, etc. et des noix.']);
  });

  it('does not split inside decimal numbers', () => {
    expect(sentences('Il mesure 3.5 m. Elle pèse 2,5 kg. Voilà.')).toEqual(['Il mesure 3.5 m.', 'Elle pèse 2,5 kg.', 'Voilà.']);
  });

  it('keeps initials with the name', () => {
    expect(sentences('Le livre de J. K. Martin est long. Il plaît.')).toEqual(['Le livre de J. K. Martin est long.', 'Il plaît.']);
    expect(sentences('J.K. Martin écrit. Elle lit.')).toEqual(['J.K. Martin écrit.', 'Elle lit.']);
  });

  it('handles ellipsis and combined punctuation', () => {
    expect(sentences('Il attendit… Personne ne vint. Quoi ?! Vraiment ?')).toEqual(['Il attendit…', 'Personne ne vint.', 'Quoi ?!', 'Vraiment ?']);
    expect(sentences('Il hésita... puis il partit. Fin.')).toEqual(['Il hésita... puis il partit.', 'Fin.']);
    expect(sentences('Oh ! dit-il. Bon.')).toEqual(['Oh ! dit-il.', 'Bon.']);
  });

  it('handles French quotes', () => {
    expect(sentences('« Viens ! » dit-elle. Il vint.')).toEqual(['« Viens ! » dit-elle.', 'Il vint.']);
    expect(sentences('Il cria : « Attention ! » Tout le monde recula.')).toEqual(['Il cria : « Attention ! »', 'Tout le monde recula.']);
    expect(sentences('Il partit. « Où vas-tu ? » demanda Léa.')).toEqual(['Il partit.', '« Où vas-tu ? » demanda Léa.']);
    expect(sentences('Elle dit : « Oui ! » Puis elle rit.')).toEqual(['Elle dit : « Oui ! »', 'Puis elle rit.']);
  });

  it('handles dialogues with dashes', () => {
    expect(sentences('— Bonjour, dit Paul. — Bonsoir, répondit Marie.')).toEqual(['— Bonjour, dit Paul.', '— Bonsoir, répondit Marie.']);
    expect(sentences('— Tu viens\n— Oui')).toEqual(['— Tu viens', '— Oui']);
    expect(sentences('- Tu viens ?\n- Oui !')).toEqual(['- Tu viens ?', '- Oui !']);
  });

  it('starts a new sentence after a blank line but not after a simple line break', () => {
    expect(sentences('Le Soleil\n\nLe Soleil est une étoile')).toEqual(['Le Soleil', 'Le Soleil est une étoile']);
    expect(sentences('Le chat\nnoir dort.')).toEqual(['Le chat\nnoir dort.']);
  });

  it('splits before digits and keeps list numbers', () => {
    expect(sentences('Il avait trois ans. 12 enfants jouaient.')).toEqual(['Il avait trois ans.', '12 enfants jouaient.']);
    expect(sentences('1. Le Soleil brille. 2. La Lune tourne.')).toEqual(['1. Le Soleil brille.', '2. La Lune tourne.']);
    expect(sentences('II. La Gaule romaine')).toEqual(['II. La Gaule romaine']);
  });

  it('§22 makes every list item its own sentence, so that the voice pauses between them', () => {
    // One line, as the « lecture intelligente » writes a paragraph.
    expect(sentences("1: lis l'article 2: souligne les verbes 3: réponds aux questions")).toEqual(
      ["1: lis l'article", '2: souligne les verbes', '3: réponds aux questions'],
    );
    expect(sentences('Consignes : 1) lis 2) écris 3) relis')).toEqual(['Consignes :', '1) lis', '2) écris', '3) relis']);
    expect(sentences('a) le chat b) le chien')).toEqual(['a) le chat', 'b) le chien']);
    // One item per line, with or without numbers.
    expect(sentences('Matériel\n1 : un cahier\n2 : un crayon')).toEqual(['Matériel', '1 : un cahier', '2 : un crayon']);
    expect(sentences('Il faut :\n• un cahier\n• un crayon')).toEqual(['Il faut :', '• un cahier', '• un crayon']);
  });

  it('§22 leaves numbers that are not a list alone', () => {
    expect(sentences('Page 1 : le début. Page 2 : la suite.')).toEqual(['Page 1 : le début.', 'Page 2 : la suite.']);
    expect(sentences('Exercice 1 : lis le texte et réponds à la question 2 : pourquoi ?')).toEqual(['Exercice 1 : lis le texte et réponds à la question 2 : pourquoi ?']);
    expect(sentences('Il avait 2 : ses frères.')).toEqual(['Il avait 2 : ses frères.']);
    expect(sentences('Il y a 3 ans, il a 1 chat.')).toEqual(['Il y a 3 ans, il a 1 chat.']);
    expect(sentences('Le rendez-vous est à 10 : 30 le 1er mai.')).toEqual(['Le rendez-vous est à 10 : 30 le 1er mai.']);
  });

  it('keeps closing quotes and parentheses in the sentence', () => {
    expect(sentences('Il a dit « oui. » Puis il est parti.')).toEqual(['Il a dit « oui. »', 'Puis il est parti.']);
    expect(sentences('(Voir plus haut.) Ensuite, lis.')).toEqual(['(Voir plus haut.)', 'Ensuite, lis.']);
  });

  it('does not split before a lowercase word', () => {
    expect(sentences('Il est 3 h. et demie.')).toEqual(['Il est 3 h. et demie.']);
  });
});
