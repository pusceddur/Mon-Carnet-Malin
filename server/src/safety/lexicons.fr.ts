// French safety lexicons (§8.4, §15.5). Every pattern runs on normalizeForMatch() output:
// lowercase, no diacritics, apostrophes/hyphens/punctuation turned into single spaces.

export interface LexiconEntry {
  id: string;
  re: RegExp;
}

/** Whole-word alternation on normalized text. */
function words(id: string, alternation: string): LexiconEntry {
  return { id, re: new RegExp(`(?:^| )(?:${alternation})(?= |$)`) };
}

const KILL_FORMS = 'suicider|tuer|pendre|scarifier|mutiler|faire du mal|faire mal|couper les veines|trancher les veines|ouvrir les veines';
const WEAPON_DRUG_NOUNS =
  'bombes?|explosifs?|engins? explosifs?|cocktails? molotov|armes?(?: a feu)?|pistolets?|fusils?|revolvers?|poisons?|drogues?|cannabis|cocaine|crack|heroine|methamphetamine|meth|ecstasy|lsd|munitions?|poudre noire|napalm|dynamite|tnt|grenades?|silencieux';

/** §15.5 block_explicit: always blocked (input and output). */
export const BLOCK_EXPLICIT: readonly LexiconEntry[] = [
  // Sexually explicit content
  words('porn', 'porno|pornos|pornographie|pornographies|pornographique|pornographiques|pedopornographie|pedopornographique|xxx'),
  words('sex_acts', 'masturbation|masturber|se masturber|masturbe|fellation|fellations|cunnilingus|sodomie|sodomies|partouze|partouzes|orgasme|orgasmes|sexe oral|positions? sexuelles?'),
  words('sex_media', '(?:film|films|video|videos|site|sites|photo|photos|image|images) (?:porno\\w*|x|pour adultes|erotiques?|cochonnes?)'),
  words('sexting', 'sexto|sextos|sexting|nudes?'),
  words('nude_request', '(?:envoie|envoies|envoyer|montre|montres|montrer|donne|donner)(?: moi| nous)? (?:une |des |ta |tes )?photos? (?:de toi |de ton corps )?(?:nue?s?|sans (?:vetements|habits)|toute? nue?s?|en sous vetements)'),
  words('explicit_intercourse', '(?:rapport|rapports|acte|actes) sexuels? (?:explicites?|detailles?)'),
  // Self-harm / suicide methods
  words('self_harm_howto', `comment (?:se|me|te|nous|vous) (?:${KILL_FORMS})`),
  words('self_harm_method', `(?:meilleures?|bonnes?|la|une|les|des) (?:facons?|manieres?|methodes?|moyens?|techniques?) (?:de|pour) (?:se|me|te) (?:${KILL_FORMS})`),
  words('self_harm_cut', '(?:se|me|te) (?:trancher|taillader|ouvrir|couper) les (?:veines|poignets)'),
  words('lethal_dose', '(?:dose|doses) (?:mortelles?|letales?)|combien (?:de|d) (?:comprimes|medicaments|cachets|pilules) (?:pour|faut il pour) (?:mourir|se tuer|me tuer)'),
  // Weapons / explosives / drugs instructions
  words('weapon_howto', `comment (?:fabriquer|faire|construire|preparer|faire exploser|assembler|obtenir|acheter|se procurer|cultiver|synthetiser|cuisiner) (?:une |un |des |du |de la |de l |l |les |le |la |sa |son |ses )?(?:${WEAPON_DRUG_NOUNS})`),
  words('weapon_recipe', `(?:recette|recettes|tutoriel|tutoriels|tuto|tutos|mode d emploi|plan de fabrication|etapes) (?:pour fabriquer |pour faire |pour preparer |de fabrication |de la fabrication |pour )?(?:de |du |d |des |une |un |d une |d un |de la |de l )?(?:${WEAPON_DRUG_NOUNS})`),
  words('drug_buy', '(?:ou|comment) (?:acheter|trouver|se procurer|commander|vendre) (?:de la |du |des |une |un |d |de )?(?:drogues?|cannabis|cocaine|crack|heroine|ecstasy|armes?|pistolets?|fusils?)'),
  words('explosive_mix', '(?:melanger|melangez|melange|melanges)(?: \\w+){0,8} pour (?:faire exploser|fabriquer une bombe|obtenir un explosif|faire une bombe)'),
];

/** §15.5 sensitive_educational: allowed only when present in the source; strict level → no AI. */
export const SENSITIVE_EDUCATIONAL: readonly LexiconEntry[] = [
  // Sexuality education, reproduction, puberty
  words('sexuality', 'sexe|sexes|sexuel|sexuels|sexuelle|sexuelles|sexualite|sexualites|sexue|sexuee|sexues|sexuees'),
  words('reproduction_cells', 'spermatozoide|spermatozoides|sperme|ovule|ovules|ovocyte|ovocytes'),
  words('fertilization', 'fecondation|fecondations|feconde|fecondee|fecondes|fecondees|feconder|fecondent'),
  words('puberty', 'puberte|pubere|menstruation|menstruations|regles douloureuses'),
  words('genitals', 'vagin|vagins|penis|testicule|testicules|uterus|vulve|erection|erections|ejaculation|ejaculations'),
  words('intercourse', 'accouplement|accouplements|s accoupler|s accouplent|s accouple|faire l amour|rapport sexuel|rapports sexuels|relation sexuelle|relations sexuelles'),
  words('contraception', 'contraception|contraceptif|contraceptifs|preservatif|preservatifs'),
  // Death as a fact, suicide
  words('suicide', 'suicide|suicides|suicider|suicidaire|suicidaires|se suicida|s est suicide|s est suicidee|se donner la mort|s est donne la mort|mettre fin a ses jours'),
  // Violence, war, genocide, crime
  words('killing', 'tuer|tue|tuee|tuees|tues|tuait|tuaient|tua|tuerent|tuera|tueront|tueur|tueurs|tueuse|meurtre|meurtres|meurtrier|meurtriers|meurtriere|assassin|assassins|assassinat|assassinats|assassiner|assassine|assassinee|assassines'),
  words('massacre', 'massacre|massacres|massacrer|massacre|massacrerent|genocide|genocides|extermination|exterminations|exterminer|extermine|extermines|shoah|holocauste|camp de concentration|camps de concentration|camp d extermination|camps d extermination|chambre a gaz|chambres a gaz'),
  words('torture', 'torture|tortures|torturer|torture|torturee|tortures|torturees|decapite|decapitee|decapites|decapiter|decapitation|egorge|egorgee|egorger|pendaison|pendaisons|cadavre|cadavres'),
  words('war', 'guerre|guerres'),
  words('terrorism', 'terrorisme|terroriste|terroristes|attentat|attentats|kamikaze|kamikazes'),
  words('firearms', 'arme a feu|armes a feu|fusil|fusils|pistolet|pistolets|revolver|revolvers|mitraillette|mitraillettes|bombe|bombes|explosif|explosifs|grenade|grenades|munition|munitions'),
  words('sexual_violence', 'viol|viols|violer|violee|violees|agression sexuelle|agressions sexuelles|abus sexuel|abus sexuels|attouchement|attouchements|pedophile|pedophiles|pedophilie|inceste|prostitution|prostituee|prostituees|prostitue'),
  words('abuse', 'maltraitance|maltraitances|maltraite|maltraitee|harcelement|harcelements|harceler|harcele|harcelee'),
  // Drugs (prevention)
  words('drugs', 'drogue|drogues|drogue|droguee|drogues|cannabis|cocaine|heroinomane|overdose|overdoses|stupefiant|stupefiants|toxicomanie|toxicomane|dealer|dealers|alcoolisme|alcoolique|alcooliques|ivresse'),
];

/** §15.5 adult_redirect: first-person distress, self-harm or abuse written BY the child (never document text). */
export const ADULT_REDIRECT: readonly LexiconEntry[] = [
  words('wish_to_die', 'je (?:veux|voudrais|vais|pense a|compte|prefererais|prefere) (?:mourir|me tuer|me suicider|disparaitre|en finir|me faire du mal|me faire mal|me pendre)'),
  words('wish_to_die_2', 'j ai (?:envie|pense|decide) (?:de|a) (?:mourir|me tuer|me suicider|disparaitre|en finir|me faire du mal|me faire mal|me pendre)'),
  words('wish_to_die_3', 'envie de mourir|besoin de mourir|je veux plus vivre|je ne veux plus vivre|j ai plus envie de vivre|je n ai plus envie de vivre|ma vie ne sert a rien|je sers a rien|je ne sers a rien|je devrais mourir|je vais me suicider|me suicider'),
  words('self_harm', 'je me scarifie|je me mutile|je me (?:coupe|brule|griffe|tape|frappe) (?:expres|volontairement|les bras|les poignets|les jambes|la tete)|je me fais (?:du )?mal (?:expres|volontairement|tout seul|toute seule)'),
  words('unloved', 'personne ne m aime|tout le monde me deteste|tout le monde me hait|je suis (?:toujours|tout le temps) (?:triste|seul|seule)|je suis triste (?:tout le temps|tous les jours|chaque jour)|je pleure (?:tout le temps|tous les soirs|tous les jours|chaque soir|chaque nuit)'),
  words('abuse_hit', '(?:on|il|elle|ils|elles|quelqu un|papa|maman|(?:mon|ma|mes|un|une) \\w+(?: \\w+)?) (?:me|m) (?:frappe|frappent|tape|tapent|bat|battent|touche|touchent|fait mal|font mal|menace|menacent|enferme|enferment|harcele|harcelent|insulte|insultent|oblige a|obligent a)'),
  words('abuse_past', '(?:on|il|elle|ils|elles|quelqu un) m a (?:touche|touchee|frappe|frappee|battu|battue|fait mal|enferme|enfermee|menace|menacee|oblige|obligee)'),
  words('bullying', 'on se moque de moi|ils se moquent de moi|je suis harcele|je suis harcelee|je me fais harceler|on me harcele'),
  words('fear_home', 'j ai peur de (?:rentrer|retourner) (?:a la maison|chez moi)|j ai peur de (?:mon|ma) (?:pere|mere|papa|maman|beau pere|belle mere)'),
  words('secret_adult', '(?:il|elle) m a dit de ne (?:rien|pas le|pas en) (?:dire|parler)|c est un secret avec (?:un|une) (?:adulte|grand|grande)'),
];

/** 1st/2nd person dependency, secrecy, personal data and affection phrases addressed to the child (output only). */
export const DEPENDENCY_PATTERNS: readonly LexiconEntry[] = [
  words('best_friend', 'je suis (?:ton|ta) (?:meilleur |meilleure |seul |seule |vrai |vraie |unique |plus grand |plus grande )?(?:ami|amie|copain|copine|confident|confidente|pote)|je serai (?:toujours )?(?:ton|ta) (?:meilleur |meilleure |seul |seule |vrai |vraie )?(?:ami|amie|copain|copine|confident|confidente)'),
  words('need_only_me', 'tu n as besoin que de moi|t as besoin que de moi|tu as seulement besoin de moi|tu n as besoin de personne d autre|tu peux compter (?:que|seulement|uniquement) sur moi|je suis (?:le|la) seule? (?:a|qui) (?:te comprendre|te comprend|t aimer|t aime)|personne ne te comprend comme moi'),
  words('secret_parents', 'ne (?:le |la |les |leur |lui |en )?(?:dis|raconte|montre|repete|parle) (?:rien |pas |jamais )?(?:a |de ca a |en a )?(?:tes|ton|ta) (?:parents|mere|pere|maman|papa|famille|maitresse|maitre|professeur|professeure|prof)|(?:tes|ton|ta) (?:parents|mere|pere|maman|papa) (?:ne doivent|ne doit) pas (?:le )?savoir'),
  words('our_secret', 'notre (?:petit )?secret|c est (?:un|notre) secret entre (?:nous|toi et moi)|entre toi et moi|garde (?:le|ca|ce) secret|gardons (?:le|ca|ce) secret'),
  words('personal_data', '(?:donne|donnes|dis|dis moi|envoie|ecris|indique|montre|partage|communique)(?: moi| nous)? (?:ton|ta|tes) (?:adresse|nom de famille|numero|numero de telephone|telephone|mot de passe|code|code secret|ecole|photo|photos|age|email|e mail|mail|identifiant)'),
  words('personal_question', '(?:quel|quelle|quels|quelles) (?:est|sont) (?:ton|ta|tes) (?:adresse|mot de passe|numero|numero de telephone|nom de famille|ecole|code secret|identifiant)|ou (?:habites|vis) tu|tu habites ou|dans quelle ecole vas tu|(?:ton|ta) (?:mot de passe|code secret|adresse (?:e mail|mail|postale)?)'),
  words('affection', 'je t aime|je t adore|tu me manques|je pense (?:toujours |tout le temps )?a toi|je serai toujours la pour toi|je suis la pour toi|je tiens a toi|tu es (?:mon|ma) (?:meilleur|meilleure|prefere|preferee)'),
  words('meeting', '(?:on|nous) (?:pourrait|pourrions|peut|pouvons|devrait|devrions) (?:se voir|nous voir|se rencontrer|nous rencontrer)|rencontrons nous|viens me (?:voir|rejoindre)|rejoins moi'),
];

/** Generic AI self-reference terms (§15.5), completed at runtime by transport.selfReferenceTerms. */
export const GENERIC_SELF_REFERENCE: readonly LexiconEntry[] = [
  words('ai_identity', 'je suis (?:un |une )?(?:ia|intelligence artificielle|modele de langage|grand modele de langage|chatbot|robot conversationnel|agent conversationnel|assistant virtuel|programme informatique)|en tant qu (?:ia|intelligence artificielle|assistant virtuel)|en tant que (?:modele de langage|chatbot|robot conversationnel|programme)'),
  words('language_model', 'modele de langage|modeles de langage|grand modele de langage|llm'),
];

/** Constructions that make a brand/model name a self-reference. `TERM` is replaced by the escaped normalized term. */
export const SELF_REFERENCE_TEMPLATES: readonly string[] = [
  '(?:je suis|moi c est|je m appelle|mon nom est|on m appelle|en tant que|c est moi) (?:un |une |le |la |l )?TERM',
  'moi TERM',
  'TERM (?:ton|ta|votre|un|une|l) (?:assistant|assistante|ia|robot|modele|aide)',
  '(?:cree|creee|concu|concue|developpe|developpee|entraine|entrainee|fabrique|fabriquee|programme|programmee) par TERM',
];

/** URL / e-mail / phone numbers (raw text, §8.4). */
export const CONTACT_PATTERNS: readonly LexiconEntry[] = [
  { id: 'url', re: /\bhttps?:\/\/\S+|\bwww\.[^\s]+|\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|fr|net|org|io|be|ch|ca|info|eu|app|ai|xyz)\b/i },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: 'phone', re: /(?:\+|00)\s?\d{2,3}(?:[\s.-]?\d{1,4}){3,5}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/ },
];
