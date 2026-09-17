// Deterministic lemma candidates for French words (dictionary lookup). Heuristic: candidates may not be real words.

interface Family { lemma: string; prefixes: readonly string[]; forms: string }

// Irregular verbs: `forms` are the forms of `lemma`; each prefix builds a derived verb (« de » + « venir » → « devenir »).
const VERB_FAMILIES: readonly Family[] = [
  { lemma: 'être', prefixes: [''], forms: 'suis es est sommes êtes sont étais était étions étiez étaient fus fut fûmes fûtes furent serai seras sera serons serez seront serais serait serions seriez seraient sois soit soyons soyez soient été étant' },
  { lemma: 'avoir', prefixes: [''], forms: 'ai as a avons avez ont avais avait avions aviez avaient eus eut eûmes eûtes eurent aurai auras aura aurons aurez auront aurais aurait aurions auriez auraient aie aies ait ayons ayez aient eu eue eues ayant' },
  { lemma: 'aller', prefixes: [''], forms: 'vais vas va allons allez vont irai iras ira irons irez iront irais irait irions iriez iraient aille ailles aillent allé allée allés allées allais allait allions alliez allaient allai alla allâmes allèrent allant' },
  { lemma: 'faire', prefixes: ['', 'dé', 're', 'satis', 'contre'], forms: 'fais fait faisons faites font faisais faisait faisions faisiez faisaient ferai feras fera ferons ferez feront ferais ferait ferions feriez feraient fasse fasses fassions fassiez fassent fis fit fîmes fîtes firent faite faits faisant' },
  { lemma: 'dire', prefixes: ['', 're', 'contre', 'inter', 'pré', 'mau'], forms: 'dis dit disons dites disent disais disait disions disiez disaient dirai diras dira dirons direz diront dirais dirait dirions diriez diraient dise dises dirent dite dits disant' },
  { lemma: 'pouvoir', prefixes: [''], forms: 'peux peut pouvons pouvez peuvent pouvais pouvait pouvions pouviez pouvaient pourrai pourras pourra pourrons pourrez pourront pourrais pourrait pourrions pourriez pourraient puisse puisses puissions puissiez puissent pu put purent pouvant' },
  { lemma: 'vouloir', prefixes: [''], forms: 'veux veut voulons voulez veulent voulais voulait voulions vouliez voulaient voudrai voudras voudra voudrons voudrez voudront voudrais voudrait voudrions voudriez voudraient veuille veuilles veuillent voulu voulut voulurent voulant' },
  { lemma: 'savoir', prefixes: [''], forms: 'sais sait savons savez savent savais savait savions saviez savaient saurai sauras saura saurons saurez sauront saurais saurait saurions sauriez sauraient sache saches sachions sachiez sachent su sue sut surent sachant' },
  { lemma: 'voir', prefixes: ['', 're', 'pré', 'entre'], forms: 'vois voit voyons voyez voient voyais voyait voyions voyiez voyaient verrai verras verra verrons verrez verront verrais verrait verrions verriez verraient voie voies vu vue vus vues vis vit vîmes vîtes virent voyant' },
  { lemma: 'venir', prefixes: ['', 'de', 're', 'sou', 'par', 'con', 'inter', 'pré', 'sur', 'ad', 'pro', 'contre', 'circon'], forms: 'viens vient venons venez viennent venais venait venions veniez venaient viendrai viendras viendra viendrons viendrez viendront viendrais viendrait viendrions viendriez viendraient vienne viennes venu venue venus venues vins vint vînmes vîntes vinrent venant' },
  { lemma: 'tenir', prefixes: ['', 're', 'ob', 'con', 'main', 'appar', 'sou', 'dé', 'abs', 'en'], forms: 'tiens tient tenons tenez tiennent tenais tenait tenions teniez tenaient tiendrai tiendras tiendra tiendrons tiendrez tiendront tiendrais tiendrait tiendrions tiendriez tiendraient tienne tiennes tenu tenue tenus tenues tins tint tînmes tîntes tinrent tenant' },
  { lemma: 'prendre', prefixes: ['', 'ap', 'com', 'sur', 're', 'entre', 'dé', 'é'], forms: 'prends prend prenons prenez prennent prenais prenait prenions preniez prenaient prendrai prendras prendra prendrons prendrez prendront prendrais prendrait prendrions prendriez prendraient prenne prennes pris prise prises prit prîmes prîtes prirent prenant' },
  { lemma: 'mettre', prefixes: ['', 'pro', 'per', 'ad', 're', 'com', 'sou', 'trans', 'o'], forms: 'mets met mettons mettez mettent mettais mettait mettions mettiez mettaient mettrai mettras mettra mettrons mettrez mettront mettrais mettrait mettrions mettriez mettraient mette mettes mis mise mises mit mîmes mîtes mirent mettant' },
  { lemma: 'devoir', prefixes: [''], forms: 'dois doit devons devez doivent devais devait devions deviez devaient devrai devras devra devrons devrez devront devrais devrait devrions devriez devraient doive doives dû due dus dues dut durent' },
  { lemma: 'falloir', prefixes: [''], forms: 'faut fallait faudra faudrait faille fallu fallut' },
  { lemma: 'valoir', prefixes: ['', 'pré'], forms: 'vaux vaut valons valez valent valais valait valaient vaudra vaudrait vaille valu valut valurent valant' },
  { lemma: 'naître', prefixes: ['', 're'], forms: 'nais naît nait naissons naissez naissent naissais naissait naissaient naîtra naîtront naîtrait né née nés nées naquit naquirent naissant' },
  { lemma: 'mourir', prefixes: [''], forms: 'meurs meurt mourons mourez meurent mourais mourait mouraient mourra mourront mourrait meure mort morte morts mortes mourut moururent mourant' },
  { lemma: 'vivre', prefixes: ['', 're', 'sur'], forms: 'vis vit vivons vivez vivent vivais vivait vivions viviez vivaient vivrai vivras vivra vivrons vivrez vivront vivrait vivraient vive vives vécu vécue vécus vécues vécut vécurent vivant' },
  { lemma: 'courir', prefixes: ['', 'ac', 'par', 'se', 're', 'con', 'dis', 'en', 'par'], forms: 'cours court courons courez courent courais courait courions couriez couraient courrai courras courra courrons courrez courront courrait courraient coure coures couru courue courus courues courut coururent courant' },
  { lemma: 'connaître', prefixes: ['', 're', 'mé'], forms: 'connais connaît connait connaissons connaissez connaissent connaissais connaissait connaissions connaissiez connaissaient connaîtrai connaîtra connaîtront connaîtrait connaisse connaissent connu connue connus connues connut connurent connaissant' },
  { lemma: 'paraître', prefixes: ['', 'ap', 'dis', 're', 'com'], forms: 'parais paraît parait paraissons paraissez paraissent paraissais paraissait paraissions paraissiez paraissaient paraîtrai paraîtra paraîtront paraîtrait paraisse paru parue parus parues parut parurent paraissant' },
  { lemma: 'croire', prefixes: [''], forms: 'crois croit croyons croyez croient croyais croyait croyions croyiez croyaient croirai croiras croira croirons croirez croiront croirait croie croies cru crue crus crues crut crurent croyant' },
  { lemma: 'boire', prefixes: [''], forms: 'bois boit buvons buvez boivent buvais buvait buvions buviez buvaient boirai boiras boira boirons boirez boiront boirait boive boives bu bue bus bues but burent buvant' },
  { lemma: 'crire', prefixes: ['é', 'dé', 'ins', 'pres', 'sous', 'trans', 'ré', 'pros'], forms: 'cris crit crivons crivez crivent crivais crivait crivions criviez crivaient crirai criras crira crirons crirez criront crirait crive crives crite crits crites crivit crivirent crivant' },
  { lemma: 'lire', prefixes: ['', 're', 'é'], forms: 'lis lit lisons lisez lisent lisais lisait lisions lisiez lisaient lirai liras lira lirons lirez liront lirait lise lises lu lue lus lues lut lurent lisant' },
  { lemma: 'ouvrir', prefixes: ['', 'c', 'déc', 'rec', 'r', 'entr'], forms: 'ouvre ouvres ouvrons ouvrez ouvrent ouvrais ouvrait ouvrions ouvriez ouvraient ouvrirai ouvriras ouvrira ouvrirons ouvrirez ouvriront ouvrirait ouvert ouverte ouverts ouvertes ouvrit ouvrirent ouvrant' },
  { lemma: 'offrir', prefixes: [''], forms: 'offre offres offrons offrez offrent offrais offrait offraient offrirai offrira offrirait offert offerte offerts offertes offrit offrirent offrant' },
  { lemma: 'souffrir', prefixes: [''], forms: 'souffre souffres souffrons souffrez souffrent souffrais souffrait souffraient souffrira souffert soufferte souffrit souffrirent souffrant' },
  { lemma: 'cevoir', prefixes: ['re', 'aper', 'dé', 'con', 'per'], forms: 'çois çoit cevons cevez çoivent cevais cevait cevions ceviez cevaient cevrai cevras cevra cevrons cevrez cevront cevrait çoive çoives çu çue çus çues çut çurent cevant' },
  { lemma: 'partir', prefixes: ['', 're'], forms: 'pars part partons partez partent partais partait partions partiez partaient partirai partiras partira partirons partirez partiront partirait parte partes parti partie partis parties partit partirent partant' },
  { lemma: 'sortir', prefixes: ['', 'res'], forms: 'sors sort sortons sortez sortent sortais sortait sortions sortiez sortaient sortirai sortira sortiront sortirait sorte sorti sortie sortis sorties sortit sortirent sortant' },
  { lemma: 'dormir', prefixes: ['', 'en', 'ren'], forms: 'dors dort dormons dormez dorment dormais dormait dormions dormiez dormaient dormirai dormira dormiront dormirait dorme dormi dormit dormirent dormant' },
  { lemma: 'sentir', prefixes: ['', 'res', 'con', 'pres'], forms: 'sens sent sentons sentez sentent sentais sentait sentions sentiez sentaient sentirai sentira sentiront sentirait sente senti sentie sentis senties sentit sentirent sentant' },
  { lemma: 'mentir', prefixes: ['', 'dé'], forms: 'mens ment mentons mentez mentent mentais mentait mentaient mentira menti mentit mentirent mentant' },
  { lemma: 'servir', prefixes: ['', 'des', 'as'], forms: 'sers sert servons servez servent servais servait servions serviez servaient servirai servira serviront servirait serve servi servie servis servies servit servirent servant' },
  { lemma: 'suivre', prefixes: ['', 'pour'], forms: 'suis suit suivons suivez suivent suivais suivait suivions suiviez suivaient suivrai suivra suivront suivrait suive suivi suivie suivis suivies suivit suivirent suivant' },
  { lemma: 'plaire', prefixes: ['', 'dé', 'com'], forms: 'plais plaît plait plaisons plaisez plaisent plaisais plaisait plaisaient plaira plairait plaise plu plut plurent plaisant' },
  { lemma: 'pleuvoir', prefixes: [''], forms: 'pleut pleuvait pleuvra pleuvrait pleuve plut pleuvant' },
  { lemma: 'eindre', prefixes: ['p', 'ét', 'att', 't', 'f', 'rep', 'dép', 'ce'], forms: 'eins eint eignons eignez eignent eignais eignait eignions eigniez eignaient eindrai eindras eindra eindrons eindrez eindront eindrait eigne eignes einte eints eintes eignit eignirent eignant' },
  { lemma: 'aindre', prefixes: ['cr', 'pl', 'contr'], forms: 'ains aint aignons aignez aignent aignais aignait aignions aigniez aignaient aindrai aindras aindra aindrons aindrez aindront aindrait aigne aignes ainte aints aintes aignit aignirent aignant' },
  { lemma: 'oindre', prefixes: ['j', 'rej', 'adj'], forms: 'oins oint oignons oignez oignent oignais oignait oignaient oindrai oindra oindront oindrait oigne ointe oints ointes oignit oignirent oignant' },
  { lemma: 'uire', prefixes: ['cond', 'constr', 'détr', 'prod', 'réd', 'trad', 'introd', 'instr', 'red', 'sed', 'l', 'c', 'n', 'reprod', 'reconstr', 'rec'], forms: 'uis uit uisons uisez uisent uisais uisait uisions uisiez uisaient uirai uiras uira uirons uirez uiront uirait uise uises uite uits uites uisit uisirent uisant' },
  { lemma: 'battre', prefixes: ['', 'com', 'a', 'dé', 'ra'], forms: 'bats bat battons battez battent battais battait battions battiez battaient battrai battra battront battrait batte battu battue battus battues battit battirent battant' },
  { lemma: 'rire', prefixes: ['', 'sou'], forms: 'ris rit rions riez rient riais riait riions riiez riaient rirai riras rira rirons rirez riront rirait rie ries ri rirent riant' },
  { lemma: 'asseoir', prefixes: ['', 'r'], forms: 'assieds assied asseyons asseyez asseyent assois assoit assoient asseyais asseyait asseyaient assiérai assiéra assiéront assiérait asseye assis assise assises assit assirent asseyant' },
  { lemma: 'cueillir', prefixes: ['', 'ac', 're'], forms: 'cueille cueilles cueillons cueillez cueillent cueillais cueillait cueillaient cueillerai cueillera cueilleront cueillerait cueilli cueillie cueillis cueillies cueillit cueillirent cueillant' },
  { lemma: 'fuir', prefixes: ['', 'en'], forms: 'fuis fuit fuyons fuyez fuient fuyais fuyait fuyions fuyiez fuyaient fuirai fuiras fuira fuirons fuirez fuiront fuirait fuie fuies fui fuirent fuyant' },
  { lemma: 'envoyer', prefixes: ['', 'r'], forms: 'envoie envoies envoient enverrai enverras enverra enverrons enverrez enverront enverrait envoyé envoyée envoyés envoyées' },
  { lemma: 'érir', prefixes: ['acqu', 'conqu', 'requ', 'enqu'], forms: 'iers iert érons érez ièrent érais érait éraient errai erra erront errait ière is ise ises it irent érant' },
  { lemma: 'vaincre', prefixes: ['', 'con'], forms: 'vaincs vainc vainquons vainquez vainquent vainquais vainquait vainquaient vaincrai vaincra vaincront vaincrait vainque vaincu vaincue vaincus vaincues vainquit vainquirent vainquant' },
  { lemma: 'soudre', prefixes: ['ré', 'dis', 'ab'], forms: 'sous sout solvons solvez solvent solvais solvait solvaient soudrai soudra soudront soudrait solve solu solue solus solues solut solurent soute soutes solvant' },
];

// Irregular nouns and adjectives.
const WORD_IRREGULARS: Readonly<Record<string, string>> = {
  yeux: 'œil', cieux: 'ciel', aïeux: 'aïeul', travaux: 'travail', vitraux: 'vitrail', coraux: 'corail', émaux: 'émail',
  soupiraux: 'soupirail', messieurs: 'monsieur', mesdames: 'madame', mesdemoiselles: 'mademoiselle', bonshommes: 'bonhomme',
  gentilshommes: 'gentilhomme', belle: 'beau', belles: 'beau', bel: 'beau', beaux: 'beau', nouvelle: 'nouveau', nouvelles: 'nouveau',
  nouvel: 'nouveau', nouveaux: 'nouveau', vieille: 'vieux', vieilles: 'vieux', vieil: 'vieux', folle: 'fou', folles: 'fou', fol: 'fou',
  molle: 'mou', molles: 'mou', douce: 'doux', douces: 'doux', fausse: 'faux', fausses: 'faux', rousse: 'roux', rousses: 'roux',
  fraîche: 'frais', fraîches: 'frais', sèche: 'sec', sèches: 'sec', blanche: 'blanc', blanches: 'blanc', franche: 'franc',
  franches: 'franc', longue: 'long', longues: 'long', grecque: 'grec', grecques: 'grec', turque: 'turc', turques: 'turc',
  maligne: 'malin', malignes: 'malin', bénigne: 'bénin', favorite: 'favori', favorites: 'favori', jumelle: 'jumeau',
  jumelles: 'jumeau', jumeaux: 'jumeau', héroïne: 'héros', héroïnes: 'héros', cheveux: 'cheveu', genoux: 'genou',
};

// Suffix rules: [ending, replacements]. All matching rules contribute, longest ending first.
const SUFFIX_RULES: readonly (readonly [string, readonly string[]])[] = [
  ['issements', ['ir']], ['eusement', ['eux']], ['issaient', ['ir']], ['eraient', ['er']], ['iraient', ['ir']], ['geaient', ['ger']],
  ['çaient', ['cer']], ['issions', ['ir']], ['emment', ['ent']], ['amment', ['ant']], ['issais', ['ir']], ['issait', ['ir']],
  ['issiez', ['ir']], ['issons', ['ir']], ['issent', ['ir']], ['issant', ['ir']], ['erions', ['er']], ['irions', ['ir']],
  ['ellent', ['eler']], ['ettent', ['eter']], ['ènent', ['ener']], ['èvent', ['ever']], ['ètent', ['eter', 'éter']],
  ['èdent', ['éder']], ['èrent', ['er', 'érer']], ['issez', ['ir']], ['isses', ['ir']], ['eriez', ['er']], ['iriez', ['ir']],
  ['erais', ['er']], ['erait', ['er']], ['irais', ['ir']], ['irait', ['ir']], ['erons', ['er']], ['eront', ['er']],
  ['irons', ['ir']], ['iront', ['ir']], ['geons', ['ger']], ['geais', ['ger']], ['geait', ['ger']], ['geant', ['ger']],
  ['aient', ['er', 're', 'ir', 'ayer']], ['oient', ['oyer']], ['uient', ['uyer']], ['irent', ['ir', 're']], ['dront', ['dre']],
  ['drons', ['dre']], ['drais', ['dre']], ['drait', ['dre']], ['euses', ['eux', 'eur']], ['rices', ['eur']], ['ennes', ['en']],
  ['onnes', ['on']], ['elles', ['el', 'eau', 'eler']], ['ettes', ['et', 'eter']], ['ement', ['e', '']], ['çons', ['cer']],
  ['çais', ['cer']], ['çait', ['cer']], ['çant', ['cer']], ['isse', ['ir']], ['erez', ['er']], ['irez', ['ir']], ['erai', ['er']],
  ['eras', ['er']], ['irai', ['ir']], ['iras', ['ir']], ['drai', ['dre']], ['eaux', ['eau']], ['euse', ['eux', 'eur']],
  ['rice', ['eur']], ['enne', ['en']], ['onne', ['on']], ['elle', ['el', 'eau', 'eler']], ['ette', ['et', 'eter']],
  ['ères', ['er', 'érer']], ['ives', ['if']], ['ques', ['c', 'que']], ['ment', ['']], ['ions', ['er', 'ir', 're']],
  ['âmes', ['er']], ['âtes', ['er']], ['ène', ['ener']], ['ève', ['ever']], ['ète', ['et', 'eter', 'éter']], ['ède', ['éder']],
  ['ère', ['er', 'érer']], ['èle', ['eler', 'éler']], ['oie', ['oyer']], ['uie', ['uyer']], ['aie', ['ayer']],
  ['ive', ['if']], ['que', ['c']], ['gue', ['g']], ['lle', ['l']], ['sse', ['s']], ['aux', ['al', 'ail', 'au']], ['oux', ['ou']],
  ['ées', ['é', 'er']], ['ies', ['i', 'ir']], ['ues', ['u', 're']], ['ais', ['er', 're', 'ir']], ['ait', ['er', 're', 'ir']],
  ['iez', ['er', 'ir', 're']], ['ons', ['er', 're', 'ir']], ['ent', ['er', 're', 'ir']], ['ant', ['er', 're', 'ir']],
  ['geas', ['ger']], ['era', ['er']], ['ira', ['ir']], ['dra', ['dre']], ['gea', ['ger']], ['ças', ['cer']], ['ça', ['cer']], ['ée', ['é', 'er']], ['és', ['é', 'er']],
  ['ie', ['i', 'ir']], ['is', ['ir', 'i']], ['it', ['ir', 'ire']], ['ue', ['u', 're']], ['us', ['u', 're']], ['ez', ['er', 're', 'ir']],
  ['es', ['e', '', 'er']], ['ds', ['dre']], ['as', ['er']], ['ai', ['er']], ['é', ['er']], ['u', ['re', 'oir', 'ir']],
  ['d', ['dre']], ['a', ['er']], ['i', ['ir']], ['s', ['']], ['x', ['']], ['e', ['', 'er']],
];

const AUXILIARIES = new Set(['être', 'avoir']);
const ELISION_RE = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)['\u2019\u02BC](?=\p{L})/u;
const MIN_STEM = 1;
const MIN_CANDIDATE = 2;

function buildIrregularMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (form: string, lemma: string): void => {
    const list = map.get(form);
    if (!list) map.set(form, [lemma]);
    else if (!list.includes(lemma)) list.push(lemma);
  };
  for (const family of VERB_FAMILIES) {
    for (const prefix of family.prefixes) {
      const lemma = prefix + family.lemma;
      for (const form of family.forms.split(' ')) {
        add(prefix + form, lemma);
        if (form.includes('î')) add(prefix + form.replace(/î/g, 'i'), lemma);
      }
    }
  }
  for (const [form, lemma] of Object.entries(WORD_IRREGULARS)) add(form, lemma);
  return map;
}

let irregularMap: Map<string, string[]> | null = null;

function irregularLemmas(form: string): readonly string[] {
  irregularMap ??= buildIrregularMap();
  return irregularMap.get(form) ?? [];
}

export interface LemmaTiers { exact: string[]; irregular: string[]; heuristic: string[] }

function pushUnique(list: string[], value: string): void {
  if (value.length > 0 && !list.includes(value)) list.push(value);
}

/** Candidates split by reliability: the word itself (and without elision), irregular lemmas, suffix heuristics. */
export function lemmaCandidateTiers(word: string): LemmaTiers {
  const lower = word.normalize('NFC').trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const exact: string[] = [];
  pushUnique(exact, word.normalize('NFC').trim().toLowerCase());
  pushUnique(exact, lower);
  const withoutElision = lower.replace(ELISION_RE, '');
  pushUnique(exact, withoutElision);
  const unified = withoutElision.replace(/[\u2019\u02BC]/g, "'");
  pushUnique(exact, unified);

  const irregular: string[] = [];
  for (const form of exact) for (const lemma of irregularLemmas(form)) pushUnique(irregular, lemma);
  const heuristic: string[] = [];
  if (irregular.some((l) => AUXILIARIES.has(l)) && irregular.length === irregular.filter((l) => AUXILIARIES.has(l)).length) {
    return { exact, irregular, heuristic };
  }

  const base = unified;
  const bases = [base];
  if (/[sx]$/.test(base) && base.length > 3) bases.push(base.slice(0, -1));
  const matches: { length: number; order: number; candidates: string[] }[] = [];
  bases.forEach((b, baseIndex) => {
    SUFFIX_RULES.forEach(([ending, replacements], ruleIndex) => {
      if (!b.endsWith(ending) || b.length - ending.length < MIN_STEM) return;
      const stem = b.slice(0, -ending.length);
      matches.push({
        length: ending.length - baseIndex,
        order: baseIndex * 1000 + ruleIndex,
        candidates: replacements.map((r) => stem + r),
      });
    });
    for (const lemma of irregularLemmas(b)) pushUnique(irregular, lemma);
  });
  matches.sort((a, b) => b.length - a.length || a.order - b.order);
  for (const m of matches) for (const c of m.candidates) if (c !== base && c.length >= MIN_CANDIDATE) pushUnique(heuristic, c);
  return { exact, irregular, heuristic: heuristic.filter((h) => !exact.includes(h) && !irregular.includes(h)) };
}

/**
 * Lemma candidates, most likely first; the first one is the word itself lowercased.
 * Handles elisions (« l’arbre »), irregular forms (« yeux » → « œil », « font » → « faire »), plurals, feminine forms
 * and common verb endings of the three groups.
 */
export function lemmaCandidates(word: string): string[] {
  const { exact, irregular, heuristic } = lemmaCandidateTiers(word);
  const out: string[] = [];
  for (const c of [...exact, ...irregular, ...heuristic]) pushUnique(out, c);
  return out;
}
