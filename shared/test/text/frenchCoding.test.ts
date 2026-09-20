import { describe, expect, it } from 'vitest';
import { codeFrenchText, formatCoding } from '../../src/text/frenchCoding';

const code = (text: string): string => formatCoding(text, codeFrenchText(text));

describe('French reading aids (§26)', () => {
  it.each([
    // syllables and silent endings
    ['petit', 'pe|ti{t}'],
    ['pomme', 'pom|m{e}'],
    ['table', 'ta|bl{e}'],
    ['arbre', 'ar|br{e}'],
    ['jardin', 'jar|d[in]'],
    ['école', 'é|co|l{e}'],
    ['papillon', 'pa|p[il|l][on]'],
    ['obstacle', 'obs|ta|cl{e}'],
    ['matin', 'ma|t[in]'],
    ['elle', 'el|l{e}'],
    ['une', 'u|n{e}'],
    ['joie', 'j[oi]{e}'],
    ['journée', 'j[ou]r|né{e}'],
    ['enfants', '[en]|f[an]{ts}'],
    ['grand', 'gr[an]{d}'],
    ['temps', 't[em]{ps}'],
    ['doigt', 'd[oi]{gt}'],
    ['pieds', 'pie{ds}'],
    ['chanter', '[ch][an]|te{r}'],
    ['premier', 'pre|mie{r}'],
    ['hiver', '{h}i|ver'],
    ['mer', 'mer'],
    ['les', 'le{s}'],
    ['des', 'de{s}'],
    ['et', 'e{t}'],
    ['est', 'e{st}'],
    ['chez', '[ch]e{z}'],
    ['sac', 'sac'],
    ['blanc', 'bl[an]{c}'],
    ['gentil', '<g>[en]|ti{l}'],
    ['bus', 'bus'],
    ['leur', 'l[eu]r'],
    ['trop', 'tro{p}'],
    ['beaucoup', 'b[eau]|c[ou]{p}'],
    ['moment', 'mo|m[en]{t}'],
    // one sound for several letters
    ['oiseau', '[oi]|<s>[eau]'],
    ['maison', 'm[ai]|<s>[on]'],
    ['chanson', '[ch][an]|s[on]'],
    ['soigner', 's[oi]|[gn]e{r}'],
    ['montagne', 'm[on]|ta|[gn]{e}'],
    ['photo', '[ph]o|to'],
    ['quand', '[qu][an]{d}'],
    ['guitare', '[gu]i|ta|r{e}'],
    ['pain', 'p[ain]'],
    ['semaine', 'se|m[ai]|n{e}'],
    ['bonne', 'bon|n{e}'],
    ['comme', 'com|m{e}'],
    ['nom', 'n[om]'],
    ['ennui', '[en]|nui'],
    ['fille', 'f[il|l]{e}'],
    ['famille', 'fa|m[il|l]{e}'],
    ['paille', 'p[ail|l]{e}'],
    ['abeille', 'a|b[eil|l]{e}'],
    ['soleil', 'so|l[eil]'],
    ['travail', 'tra|v[ail]'],
    ['ailes', '[ai]|l{es}'],
    ['ville', 'vil|l{e}'],
    ['cœur', 'c[œu]r'],
    // letters that change their sound
    ['girafe', '<g>i|ra|f{e}'],
    ['cerise', '<c>e|ri|<s>{e}'],
    ['pigeon', 'pi|<g>{e}[on]'],
    ['nation', 'na|<t>i[on]'],
    ['exemple', 'e|<x>[em]|pl{e}'],
    ['deuxième', 'd[eu]|<x>iè|m{e}'],
    ['chorale', '[<ch>]o|ra|l{e}'],
    ['piscine', 'pi[s|c]i|n{e}'],
    // glides stay with their vowel
    ['chien', '[ch]i[en]'],
    ['piano', 'pia|no'],
    ['nuit', 'nui{t}'],
    ['crier', 'cri|e{r}'],
    ['hier', '{h}ier'],
    // irregular words
    ['femme', 'f<e>m|m{e}'],
    ['monsieur', 'm<on>|si[eu]{r}'],
    ['sept', 'se{p}t'],
    ['villes', 'vil|l{es}'],
  ])('%s → %s', (word, expected) => {
    expect(code(word)).toBe(expected);
  });

  it('keeps capitals and punctuation, and codes each part of an elision or a compound word', () => {
    expect(code('Léa')).toBe('Lé|a');
    expect(code("l'école")).toBe("l'é|co|l{e}");
    expect(code("aujourd'hui")).toBe("[au]|j[ou]rd'{h}ui");
    expect(code('dit-elle.')).toBe('di{t}-el|l{e}.');
  });

  it('knows the silent -ent of verbs from the sentence', () => {
    expect(code('Ils mangent.')).toBe('Il{s} m[an]|<g>{ent}.');
    expect(code('Les enfants jouent dans le jardin.')).toBe('Le{s}‿[en]|f[an]{ts} j[ou]{ent} d[an]{s} le jar|d[in].');
    expect(code('Le vent souffle souvent.')).toBe('Le v[en]{t} s[ou]f|fl{e} s[ou]|v[en]{t}.');
    expect(code('Ils étaient contents.')).toBe('Il{s}‿é|t[ai]{ent} c[on]|t[en]{ts}.');
  });

  it('links the words of a liaison, never after « et » nor before an h aspiré', () => {
    expect(code('les amis')).toBe('le{s}‿a|mi{s}');
    expect(code("C'est un petit oiseau.")).toBe("C'e{st}‿[un] pe|ti{t}‿[oi]|<s>[eau].");
    expect(code('nous avons')).toBe('n[ou]{s}‿a|v[on]{s}');
    expect(code('les héros')).toBe('le{s} {h}é|ro{s}');
    expect(code('les hommes')).toBe('le{s}‿{h}om|m{es}');
    expect(code('et il')).toBe('e{t} il');
    expect(code('grand ou petit')).toBe('gr[an]{d} [ou] pe|ti{t}');
  });

  it('codes a whole paragraph (the text the model coded in 34 s with mistakes on 2026-09-19)', () => {
    expect(code("Un matin d'hiver, les enfants ont trouvé un petit oiseau dans le jardin. Il avait froid et ses ailes étaient mouillées."))
      .toBe("[Un] ma|t[in] d'{h}i|ver, le{s}‿[en]|f[an]{ts} [on]{t} tr[ou]|vé [un] pe|ti{t}‿[oi]|<s>[eau] d[an]{s} le jar|d[in]. "
        + 'Il a|v[ai]{t} fr[oi]{d} e{t} se{s}‿[ai]|l{es} é|t[ai]{ent} m[ouil|l]é{es}.');
    expect(code('Léa a pris une boîte en carton. « Nous allons le soigner », dit-elle.'))
      .toBe('Lé|a a pri{s} u|n{e} b[oî]|t{e} [en] car|t[on]. « N[ou]{s}‿al|l[on]{s} le s[oi]|[gn]e{r} », di{t}-el|l{e}.');
    expect(code("Aujourd'hui, nous étudions les volcans. Les scientifiques observent les éruptions."))
      .toBe("[Au]|j[ou]rd'{h}ui, n[ou]{s}‿é|tu|di[on]{s} le{s} vol|c[an]{s}. Le{s} [sc]i[en]|ti|fi|[qu]{es} ob|ser|v{ent} le{s}‿é|rup|<t>i[on]{s}.");
  });

  it('codes a long page in a few milliseconds', () => {
    const page = 'Il était une fois une petite fille qui vivait avec sa mère au bord d’une grande forêt. '.repeat(60);
    const started = performance.now();
    codeFrenchText(page);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('leaves digits and other characters without marks', () => {
    const coding = codeFrenchText('page 12 !');
    expect(Array.from(coding.syllable.slice(4))).toEqual([-1, -1, -1, -1, -1]);
    expect(code('page 12 !')).toBe('pa|<g>{e} 12 !');
  });
});
