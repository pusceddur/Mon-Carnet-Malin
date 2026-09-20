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
/** Bath bombs and water balloons are not weapons. */
const NOT_A_WEAPON = '(?! (?:de bain|a eau|a graines|de graines|glacees?|de chantilly|au chocolat|de table))';
const WEAPON_DRUG_NOUNS =
  `bombes?${NOT_A_WEAPON}|explosifs?|engins? explosifs?|cocktails? molotov|armes?(?: a feu)?|pistolets?|fusils?|revolvers?|poisons?|drogues?|cannabis|cocaine|crack|heroine|methamphetamine|meth|ecstasy|lsd|munitions?|poudre noire|napalm|dynamite|tnt|grenades?|silencieux`;

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

// ---------------------------------------------------------------------------------------------------------------------
// §18 « Pose ta question »: free questions typed by the child, not tied to a book. Applied to the child's text only,
// in addition to checkInputSafety. Patterns target an intent (how to get, make, use, hurt, meet…) rather than a topic,
// so that school and curiosity questions (volcanoes, wars, dinosaurs, diseases, drugs as prevention…) still pass.

/** Filler words allowed between an intent opener (« comment », « je veux »…) and the verb. */
const FQ_FILLERS = '(?: (?:on|je|j|tu|il|elle|nous|vous|ils|faut|faudrait|faire|pour|peut|peux|pourrait|pourrais|pouvoir|doit|dois|est|ce|qu|que|reussir a|arriver a|va|vais|bien|vraiment|facilement|vite|en cachette|discretement|sans se faire prendre|sans me faire prendre))*';
const FQ_INTENT = `(?:comment|je veux|je voudrais|j aimerais|j ai envie de|je vais|on va|aide moi a|aidez moi a|apprends moi a|explique moi comment|dis moi comment|montre moi comment|il faut|(?:un|le|le meilleur) moyen (?:de|d|pour)|(?:une|la|la meilleure) (?:facon|maniere|technique|methode|astuce) (?:de|d|pour))${FQ_FILLERS}`;
/** Determiners and small adjectives between a verb and its object. */
const FQ_DETS = '(?: (?:une|un|des|du|de la|de l|d|de|sa|son|ses|ma|mon|mes|ta|ton|tes|l|la|le|les|leur|leurs|vraie?s?|vrais|petite?s?|grosse?s?|gros|maison|artisanale?s?|puissante?s?|dangereuse?s?))*';
const FQ_FAMILY =
  'frere|freres|soeur|soeurs|pere|mere|papa|maman|parents|cousin|cousine|cousins|cousines|oncle|tante|grand pere|grand mere|grands parents|papi|papy|mamie|mami|copain|copine|copains|copines|ami|amie|amis|amies|voisin|voisine|voisins|voisines|prof|profs|professeur|professeure|maitre|maitresse|camarade|camarades|beau pere|belle mere|demi frere|demi soeur|bebe|ennemi|ennemie|ennemis|chat|chats|chien|chiens|chaton|chiot|hamster|lapin|poisson|oiseau|cheval|famille';
/** People (and pets) a question could want to harm. */
const FQ_LIVING = `(?:quelqu un|qqn|une personne|des personnes|des gens|les gens|un humain|des humains|un enfant|des enfants|un bebe|un adulte|un eleve|une eleve|un garcon|une fille|un homme|une femme|un camarade|une camarade|un chat|un chien|un chaton|un chiot|la maitresse|le maitre|le prof|la prof|lui|elle|eux|(?:mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|un|une|le|la|les|des) (?:${FQ_FAMILY}))`;
const FQ_HURT_VERBS =
  'tuer|assassiner|empoisonner|etrangler|etouffer|poignarder|egorger|noyer|bruler|torturer|kidnapper|frapper|tabasser|blesser|faire mal a|faire du mal a|faire souffrir|faire pleurer|humilier|harceler|insulter|racketter|se venger de|me venger de|violer|droguer|assommer|defigurer';
const FQ_WEAPON_NOUNS =
  `bombes?${NOT_A_WEAPON}|explosifs?|engins? explosifs?|cocktails? molotov|dynamite|tnt|napalm|poudre noire|poudre a canon|grenades?|petards?|pistolets?|fusils?|revolvers?|armes?(?: a feu| blanches?)?|kalachnikovs?|mitraillettes?|munitions?|balles? reelles?|silencieux|couteaux? (?:papillon|a cran d arret)|poisons?|arsenic|cyanure`;
const FQ_MAKE_VERBS =
  'fabriquer|faire|construire|preparer|creer|obtenir|avoir|acheter|trouver|se procurer|me procurer|commander|voler|cacher|utiliser|charger|tirer avec|me servir d|se servir d|allumer|lancer|poser|faire exploser|faire sauter|amener a l ecole|apporter a l ecole';
const FQ_SUBSTANCES =
  'alcool|biere|bieres|vin|vodka|whisky|rhum|champagne|pastis|tequila|cigarettes?|clopes?|tabac|cigares?|puffs?|vapoteuses?|cigarettes? electroniques?|vapes?|chicha|joints?|shit|weed|beuh|cannabis|marijuana|drogues?|cocaine|coke|crack|heroine|ecstasy|ecsta|lsd|champignons? hallucinogenes?|proto|protoxyde d azote|gaz hilarant|poppers|codeine|somniferes?';
const FQ_ONLINE =
  'internet|en ligne|un jeu en ligne|un jeu video|les jeux video|roblox|fortnite|minecraft|tiktok|snapchat|snap|discord|instagram|insta|whatsapp|youtube|twitch|brawl stars|un forum|un tchat|un chat en ligne';
const FQ_HATE_TARGETS =
  'noirs|noires|arabes|juifs|juives|musulmans|musulmanes|chretiens|blancs|blanches|chinois|chinoises|asiatiques|gays|homos|homosexuels|lesbiennes|trans|etrangers|etrangeres|immigres|migrants|refugies|handicapes|handicapees|roms|gitans|gitanes|africains|africaines|maghrebins|renois|rebeus|feujs';

/** Whole-word alternation that also requires `mustContain` somewhere in the text (checked by lookahead). */
function wordsWith(id: string, mustContain: string, alternation: string): LexiconEntry {
  return { id, re: new RegExp(`^(?=(?:.* )?(?:${mustContain})(?: |$))(?:.* )?(?:${alternation})(?= |$)`) };
}

/** §18.2.1 forbidden categories: blocked before any AI call (questionBlocked + parent alert with the question). */
export const FREE_QUESTION_BLOCK: readonly LexiconEntry[] = [
  // Sexuality / pornography (sex education goes to an adult: the answer would need details a free answer cannot check)
  words('fq_sexuality', 'sexes?(?! (?:d un|d une|du|de la|de l|des|de mon|de ma|de mes|de ton|de ta|de son|de sa|de ce|de cette|de ces|masculin|feminin|oppose))|sexuel|sexuels|sexuelle|sexuelles|sexualite|sexy|faire l amour|fait l amour|font l amour|faisaient l amour|coucher avec|penis|vagin|vagins|vulve|clitoris|testicules?|zizi|zizis|zezette|foufoune|bite|bites|couilles?|nichons?|seins nus|erections?|ejaculations?|sperme|orgasmes?|preservatifs?|pilule contraceptive|contraception|masturb\\w*|porno\\w*|pornographi\\w*|strip tease|prostitu\\w*|putes?|kamasutra|chaud au lit|chaude au lit|capotes?(?! (?:de|d|du) (?:la |une |sa )?(?:voiture|cabriolet|landau|poussette))|comment (?:on |est ce qu on |les gens |les parents |les adultes )?(?:fait|font|fabrique|fabriquent|faire|fabriquer) (?:un|des|les) (?:bebe|bebes|enfant|enfants)(?! (?:animaux|chats|chiens|oiseaux|poissons|tortues|lapins|d animaux))|d ou viennent les bebes(?! (?:animaux|chats|chiens|oiseaux|poissons|tortues|lapins|d animaux))|(?:montre|montrer|voir|regarder|photos? de|images? de|videos? de)(?: moi)?(?: des| les| ses| tes| mes)? (?:seins|fesses|zizis?|parties intimes)|(?:interdite?s?|deconseillee?s?) aux moins de (?:16|18) ans|(?:videos?|films?|sites?|images?|photos?|contenus?|jeux?) (?:pour adultes|reservee?s? aux adultes)'),
  words('fq_nudity', '(?:photos?|videos?|images?|selfies?) (?:de |d )?(?:moi |toi |fille |filles |femme |femmes |garcon |garcons |gens )?(?:toute?s? nue?s?|tous nus|nue?s?|sans (?:habits|vetements|culotte|slip)|en sous vetements)|(?:me|se|te) (?:mettre|montrer) (?:tout nu|toute nue|tout nus|toutes nues)|montrer (?:mon|ma|mes|son|sa|ses) (?:zizi|fesses|sexe|parties intimes)'),
  // Dangerous instructions: weapons, explosives, poisons, fire, hurting someone
  words('fq_weapon_make', `${FQ_INTENT} (?:${FQ_MAKE_VERBS})${FQ_DETS} (?:${FQ_WEAPON_NOUNS})`),
  words('fq_weapon_make_2', `comment (?:on |tu |je |nous |vous |ils |les gens )?(?:fait|fais|faisait|fabrique|construit|prepare|cree|obtient|trouve|achete|utilise|se procure)${FQ_DETS} (?:${FQ_WEAPON_NOUNS})`),
  words('fq_weapon_make_3', `(?:fabriquer|construire|preparer|faire exploser|faire sauter)${FQ_DETS} (?:${FQ_WEAPON_NOUNS})`),
  words('fq_weapon_use', '(?:fabriquer|faire|avoir|trouver|acheter|amener|apporter|cacher|prendre|utiliser) (?:un|une|des|mon|ma|mes) (?:couteau|couteaux|arme|armes|matraque|poing americain|bombe lacrymogene)(?: \\w+){0,3} (?:pour|a) (?:me defendre|se defendre|attaquer|frapper|blesser|tuer|l ecole|le college)'),
  words('fq_hurt', `${FQ_INTENT} (?:${FQ_HURT_VERBS}) ${FQ_LIVING}`),
  words('fq_death_wish', `(?:je veux|je voudrais|j aimerais|comment faire pour|il faut|j ai envie) (?:que|qu) (?:quelqu un|il|elle|ils|elles|(?:mon|ma|mes|son|sa|ses|le|la|les|notre|nos) (?:${FQ_FAMILY})) (?:meure|meurent|creve|crevent|soit mort|soit morte|soient morts|disparaisse pour toujours)`),
  words('fq_poison', '(?:poison|poisons|produit|produits|medicament|medicaments|plante|plantes|champignon|champignons)(?: \\w+){0,3} (?:pour|qui peut|qui peuvent|capable de) (?:tuer|empoisonner|faire mourir|endormir|assommer|rendre malade) (?:quelqu un|qqn|une personne|des gens|les gens|un humain|mon|ma|mes|ton|ta|tes|son|sa|ses)'),
  words('fq_fire', `${FQ_INTENT} (?:mettre le feu|allumer un feu|allumer le feu|allumer du feu|faire du feu|faire un feu|faire un incendie|provoquer un incendie|declencher un incendie|incendier|bruler (?:une|un|la|le|les|des|ma|mon|mes|sa|son|ses|l) (?:maison|ecole|voiture|foret|arbre|immeuble|appartement|chambre|classe|cheveux|livre|cahier|papier|affaires|poubelle))|mettre le feu (?:a|au|aux)`),
  // Drugs, alcohol, tobacco: how to get or use them (prevention questions pass)
  words('fq_substance_get', `(?:ou|comment)${FQ_FILLERS} (?:acheter|trouver|avoir|obtenir|commander|se procurer|me procurer|recuperer|voler|vendre|cultiver|cacher|faire pousser)${FQ_DETS} (?:${FQ_SUBSTANCES})`),
  words('fq_substance_use', `${FQ_INTENT} (?:fumer|vapoter|boire|gouter|prendre|essayer|tester|sniffer|inhaler|rouler|consommer)${FQ_DETS} (?:${FQ_SUBSTANCES})`),
  words('fq_substance_use_2', `${FQ_INTENT} (?:fumer|vapoter|se droguer|me droguer|se souler|me souler|se bourrer la gueule|me bourrer la gueule|se defoncer|me defoncer|planer|etre bourre|etre bourree|etre soul|etre saoul|etre ivre|etre drogue|etre droguee)`),
  // Theft
  words('fq_theft', 'voler (?:de l argent|des bonbons|dans un magasin|dans les magasins|dans le porte monnaie|dans le sac|un telephone|une voiture|un velo|a l etalage|sans se faire prendre|sans me faire prendre|sans que personne)|a l etalage|cambrioler|braquer (?:une|un|la|le) (?:banque|magasin|bijouterie)'),
  // Gambling
  words('fq_gambling', 'paris sportifs?|pari sportif|parier (?:de l argent|des euros|mon argent|sur un match|sur les matchs|sur des matchs|en ligne|sur internet)|faire des paris|sites? de paris|applis? de paris|applications? de paris|jeux? d argent|machines? a sous|casinos? en ligne|poker en ligne|roulette en ligne|miser (?:de l argent|des euros|mon argent)|(?:jouer|gagner|aller) au casino|gagner au (?:loto|casino|poker|euromillions?|grattage|pmu|tierce)|tickets? a gratter|jeux? a gratter|loot ?box(?:es)?'),
  // Hacking, piracy, getting around parental controls
  words('fq_hacking', `${FQ_INTENT} (?:pirater|hacker|hack|craquer|cracker|espionner|infecter)(?: \\w+){0,4}`),
  words('fq_parental_control', `(?:contourner|desactiver|supprimer|enlever|eviter|tromper|bypass|casser|debloquer|deverrouiller|couper|arreter|echapper a|effacer|pirater|hacker)${FQ_DETS} (?:controle parental|controles parentaux|filtre parental|filtres parentaux|family link|temps d ecran|limites? d ecran|limites? de temps|code parental|restrictions? (?:de|d|du) (?:mes|mon|ma) (?:parents|pere|mere|papa|maman|tablette|telephone|ipad|ordinateur)|surveillance (?:de|d) (?:mes|mon|ma) (?:parents|pere|mere|papa|maman))`),
  words('fq_steal_password', `(?:voler|trouver|deviner|decouvrir|avoir|connaitre|recuperer|craquer|pirater|hacker|changer|contourner|obtenir|savoir|lire)(?: le| les| un| une)? (?:mot|mots|code|codes)(?: de passe| secret| secrets| pin| parental)? (?:de|d|du|des)(?: mes| mon| ma| ses| son| sa| la| le| l)?(?: (?:tablette|telephone|portable|ordinateur|ordi|ipad|iphone|console|switch|box|compte|coffre) (?:de|d|du|des)(?: mes| mon| ma| ses| son| sa| la| le| l)?)? (?:parents|pere|mere|papa|maman|frere|soeur|copain|copine|ami|amie|prof|professeur|maitresse|maitre|voisin|voisine|voisins|quelqu un|autres|wifi|wi fi|ecole|classe)`),
  words('fq_spy', '(?:espionner|lire les messages (?:de|d)|lire les sms (?:de|d)|fouiller (?:dans )?le telephone (?:de|d)|regarder le telephone (?:de|d)|pister|localiser) (?:quelqu un|une personne|(?:mes|mon|ma|ses|son|sa) (?:parents|pere|mere|papa|maman|frere|soeur|copain|copine|ami|amie|prof|voisin|voisine|voisins|cousin|cousine))'),
  words('fq_piracy', '(?:telecharger|regarder|avoir)(?: des| un| une| les| le| la)? (?:jeux?|films?|series?|musiques?|mangas?|applis?|applications?|logiciels?)(?: gratuitement| gratuits?| gratuites?)? (?:pirates?|illegalement|en streaming illegal|sans payer|crackes?)|streaming illegal|sites? de streaming (?:illegal|gratuit|pirate)|(?:creer|fabriquer|faire|coder|ecrire|programmer) (?:un|des) virus informatiques?|virus (?:informatique )?(?:pour|qui peut) (?:pirater|detruire|casser|espionner|infecter)'),
  // Graphic violence, gore, horror
  words('fq_gore', 'gore|snuff|scenes? de torture|(?:images?|photos?|videos?|films?) (?:de|d) (?:cadavres?|morts? en vrai|accidents? (?:graves?|horribles?|mortels?)|decapitations?|torture|blesses?|meurtres?|executions?)|(?:montre|montrer|decris|decrire|raconte|raconter|explique|expliquer)(?: moi)?(?: en details?| avec (?:des|tous les) details)? (?:comment|ce qui se passe quand) (?:on|quelqu un|une personne|un corps|un humain) (?:est|se fait|meurt|pourrit|se decompose|brule|souffre|saigne|torture|tue|egorge|decapite|decoupe|massacre)|(?:histoires?|films?|jeux?|videos?|recits?|contes?|blagues?)(?: \\w+){0,2} (?:d horreur|gore|sanglante?s?|trash|qui fai(?:t|sai(?:t|ent)|ent) (?:tres |vraiment |super |trop )?peur|effrayante?s?|terrifiante?s?|de meurtres?)|en details? (?:la |une |les )?(?:torture|tortures|blessures?|decapitations?|autopsies?)|(?:comment|pourquoi) (?:un|le|les) (?:corps|cadavres?) (?:pourri|pourrit|pourrissent|se decompose|se decomposent)|decomposition (?:d un|du|des) (?:corps|cadavres?|humains?)'),
  // Personal data: sharing or harvesting addresses, phone numbers, passwords, photos
  words('fq_personal_share', 'mon (?:adresse|adresse mail|adresse e mail|email|e mail|mail|numero|numero de telephone|numero de portable|telephone|portable|mot de passe|code secret|code pin|pseudo|identifiant|snap|snapchat|insta|instagram|tiktok|nom de famille) (?:c est|est|s ecrit)|mon nom de famille|(?:je te donne|je vous donne|voici|voila|je t envoie|tiens) (?:mon|ma|mes) (?:adresse|numero|telephone|portable|mot de passe|code|photo|photos|selfie|nom de famille|pseudo|identifiant|email|mail|snap|insta)|(?:donner|donne|envoyer|envoie|dire|partager|montrer) (?:mon|ma|mes) (?:adresse|numero de telephone|numero de portable|telephone|portable|mot de passe|code secret|nom de famille|photos?) (?:a|au|aux)|j habite (?:au |a la |a l |dans la |dans le )?(?:rue|avenue|boulevard|impasse|allee|chemin|place|route|residence|lotissement|cite)|\\d+ (?:bis |ter )?(?:rue|avenue|av|boulevard|bd|impasse|allee|chemin|place|route|quai|square|cours|residence|lotissement)'),
  words('fq_personal_harvest', `(?:trouver|avoir|connaitre|chercher|retrouver|obtenir|savoir) (?:(?:le numero de telephone|le numero de portable|le telephone|le portable|le snap|le snapchat|l insta|l instagram|le compte (?:insta|instagram|snap|snapchat|tiktok)|le mot de passe) (?:de|d|du)(?! pere noel)|l adresse (?:de|d|du) (?:quelqu un|une personne|(?:mon|ma|mes|son|sa|ses|ton|ta|tes) (?:${FQ_FAMILY})|la maitresse|la prof|du prof|du maitre|(?:un|une|ce|cette|cet) (?:youtubeur|youtubeuse|joueur|joueuse|inconnu|inconnue|star|chanteur|chanteuse|footballeur|footballeuse|influenceur|influenceuse|streamer|streameuse|acteur|actrice|camarade|eleve|garcon|fille|homme|femme)))`),
  words('fq_photo_share', '(?:envoyer|envoie|montrer|montre|partager|poster|publier|mettre) (?:une |des |ma |mes )?(?:photos?|selfies?|videos?) (?:de moi|de mon corps|de ma tete|de mon visage|de ma maison|de mon ecole)(?! a (?:ma |mon |mes )?(?:mamie|mami|papi|papy|grand mere|grand pere|grands parents|parents|maman|papa|famille|tata|tonton))|(?:photos?|selfies?|videos?)(?: de moi)? (?:a|pour) (?:un inconnu|une inconnue|des inconnus|quelqu un que je (?:ne )?connais pas|(?:un|une|mon|ma) (?:ami|amie|copain|copine) (?:d|de|sur) (?:internet|roblox|fortnite|minecraft|tiktok|snapchat|snap|discord|instagram|insta))'),
  wordsWith('fq_meet_online', FQ_ONLINE, '(?:rencontrer|donner rendez vous a|avoir rendez vous avec|aller chez|aller voir|voir en vrai|retrouver en vrai|rejoindre en vrai)'),
  // Dating / adult relationships
  words('fq_dating', '(?:sites?|applis?|applications?) de rencontres?|tinder|sortir avec (?:un|une) (?:adulte|grand|grande|homme|femme|monsieur|dame|prof|professeur|professeure|majeur|majeure)|(?:mon|ma) (?:amoureux|amoureuse|copain|copine|petit ami|petite amie|petit copain|petite copine) (?:a|qui a) (?:1[8-9]|[2-9]\\d) ans|embrasser avec la langue|rouler (?:une pelle|des pelles|un patin|des patins)|french kiss|draguer|pecho|choper (?:une|un) (?:fille|garcon|meuf|mec)|rendez vous (?:galant|amoureux)|flirter|en couple avec (?:un|une) (?:adulte|majeur|majeure|grand|grande)|sortir avec (?:un|une) (?:\\w+ ){0,2}(?:de|qui a) (?:1[6-9]|[2-9]\\d) ans|(?:tu es|tu seras|sois|deviens|devenir|etre)(?: maintenant| desormais| vraiment| pour toujours)? (?:mon|ma) (?:petit ami|petite amie|petit copain|petite copine|amoureux|amoureuse|cheri|cherie|mari)'),
  // Insults and hate
  words('fq_insults', 'connard|connards|connasse|connasses|salope|salopes|salaud|salauds|putain|enculee?s?|encule|enfoire|enfoiree|pd|pede|pedes|tapette|tapettes|gouine|gouines|negro|negros|negre|negres|bougnoules?|youpins?|bamboula|niakoue|bicot|nique ta (?:mere|race|soeur)|niquer ta (?:mere|race)|ntm|fdp|fils de pute|ta gueule|ferme ta gueule|ta mere la pute|va te faire (?:foutre|enculer)|trou du cul|trouduc|abruti|abrutie|sale (?:noir|noire|noirs|arabe|arabes|juif|juive|juifs|blanc|blanche|chinois|chinoise|musulman|musulmane|musulmans|gay|homo|gros|grosse|handicape|handicapee|gitan|gitane|rom|roms|chretien|chretiens)'),
  words('fq_insult_request', '(?:dis|donne|ecris|apprends|trouve|invente|liste|cite)(?: moi| nous)? (?:des |un |une |les |plein de |tous les |toutes les )?(?:gros mots?|insultes?|injures?|grossieretes?|mots? vulgaires?|jurons?)'),
  words('fq_hate', `(?:je deteste|je hais|j ai la haine (?:contre|des|envers)|il faut (?:tuer|eliminer|virer|chasser|exterminer|expulser)|mort aux|a mort les|dehors les|je veux (?:tuer|frapper|taper|virer|chasser)) (?:les |des |tous les |toutes les )?(?:${FQ_HATE_TARGETS})|(?:les|tous les|toutes les) (?:${FQ_HATE_TARGETS}) (?:sont|c est)(?: ils| elles)?(?: tous| toutes| vraiment| trop)? (?:des |de |que des )?(?:voleurs|voleuses|nuls|nulles|betes|idiots|idiotes|inferieurs|inferieures|sales|mechants|mechantes|criminels|terroristes|dangereux|dangereuses|moches|parasites|singes|animaux)`),
];

/**
 * §18.2.1 distress, self-harm, abuse, secrets with adults, strangers online: adult_redirect (questionAdultRedirect + parent
 * alert). Checked BEFORE the block lexicons: « comment se suicider ? » is a distress signal, not a forbidden topic.
 */
export const FREE_QUESTION_REDIRECT: readonly LexiconEntry[] = [
  words('fq_suicide', 'suicid\\w*|se tuer|me tuer|te tuer|mettre fin a (?:ses|mes|tes|leurs) jours|se donner la mort|se pendre|me pendre|scarifi\\w*|automutil\\w*|se mutiler|me mutiler|se mutilent|se faire du mal|me faire du mal|se couper les veines|me couper les veines|s ouvrir les veines|sauter (?:d un pont|du toit|par la fenetre|d un immeuble|sous un train)|(?:avaler|prendre) (?:tous |toutes |plein de |beaucoup de )?(?:les |des |mes )?(?:medicaments|cachets|pilules|comprimes) (?:pour|de|d) (?:mourir|dormir pour toujours|ne plus me reveiller|en finir)|overdoses?|mourir (?:sans douleur|sans souffrir|vite)|envie de disparaitre|ne plus me reveiller'),
  words('fq_eating', '(?:je veux|j ai envie d|j ai envie de|je vais|comment) (?:arreter de manger|ne plus manger|me faire maigrir|maigrir) (?:du tout|completement|pour maigrir|pour etre (?:mince|maigre)|pour ne plus grossir|tres vite|vite|beaucoup)|(?:je veux|je vais) (?:arreter de manger|ne plus manger)$|me faire vomir|se faire vomir|je ne mange plus (?:rien|du tout)'),
  words('fq_runaway', `${FQ_INTENT} (?:fuguer|faire une fugue|m enfuir|s enfuir|partir de (?:chez moi|la maison)|quitter (?:ma famille|la maison|mes parents)|m echapper de (?:chez moi|la maison))|je (?:vais|veux) fuguer`),
  words('fq_grooming_stranger', '(?:un inconnu|une inconnue|des inconnus|un monsieur|une dame|un homme|une femme|un adulte|une adulte|des adultes|un grand|une grande)(?: \\w+){0,8} (?:m a demande|me demande|m a propose|me propose|veut|voudrait|m a dit de|me dit de|m oblige a|m a oblige a|insiste pour)(?: \\w+){0,2} (?:de |d |que je |qu on )?(?:me voir|me rencontrer|le rencontrer|la rencontrer|les rencontrer|se voir|venir chez|aller chez|monter dans sa voiture|monte dans sa voiture|le suivre|la suivre|le suive|la suive|vienne chez (?:lui|elle)|le rejoindre|la rejoindre|mon adresse|mon numero|mon mot de passe|des photos|une photo|ma photo|me prendre en photo|me filmer|une video|garder (?:un|le|ce|notre) secret|ne rien dire|ne pas le dire|ne pas en parler|mentir|me deshabiller|enlever mes (?:habits|vetements)|le toucher|la toucher|toucher)'),
  wordsWith('fq_grooming_online', FQ_ONLINE, '(?:m a demande|me demande|m a propose|me propose|veut|voudrait|m a dit de|me dit de|insiste pour)(?: \\w+){0,2} (?:de |d |que je |qu on )?(?:me voir|me rencontrer|se voir|se voie|se voient|se rencontrer|venir chez|aller chez|mon adresse|mon numero|mon mot de passe|des photos|une photo|ma photo|me prendre en photo|me filmer|une video|garder (?:un|le|ce|notre) secret|ne rien dire|ne pas le dire|ne pas en parler|mentir|me deshabiller|allumer (?:ma|la) camera|la webcam)'),
  words('fq_secret_adult', '(?<!(?:maman|papa|mere|pere|parents|mamie|mami|papi|papy|tata|tonton) )(?:m a demande|me demande|m a dit|me dit|m oblige|m a oblige|veut|voudrait) (?:de |d |que je )?(?:garder (?:un|le|ce|notre) secret|ne rien dire a|ne pas le dire a|ne pas en parler a|mentir a (?:mes|mon|ma))|secret (?:avec|entre) (?:moi et )?(?:un|une) (?:adulte|grand|grande|monsieur|dame|homme|femme)|(?:un|une) (?:adulte|grand|grande|monsieur|dame|homme|femme)(?: \\w+){0,4} (?:m a dit|m a confie|m a raconte|me dit|me raconte|partage avec moi|a avec moi) (?:un|des|son|ses) secrets?'),
  words('fq_body_abuse', '(?:touche|touchent|toucher|a touche|caresse|caresser|regarde|regarder|filme|filmer) (?:mon|ma|mes) (?:zizi|sexe|zezette|fesses|parties intimes|parties|poitrine|seins|culotte|slip)|me regarde (?:dans la douche|quand je me lave|me deshabiller|me changer|dans mon bain|toute? nue?)|(?:me montre|m a montre|m envoie|m a envoye) (?:son|sa|ses|des) (?:zizi|sexe|parties intimes|photos? (?:toute? nue?s?|nue?s?)|videos? (?:porno\\w*|toute? nue?s?|nue?s?))|(?<!(?:maman|papa|mere|pere|parents|mamie|mami|papi|papy) )me fait des (?:bisous|calins) (?:sur la bouche|bizarres)'),
  words('fq_home_violence', '(?:papa|maman|mon pere|ma mere|mon beau pere|ma belle mere|mes parents|mon oncle|ma tante)(?: \\w+){0,2} (?:frappe|frappent|tape|tapent|bat|battent|se tapent|se frappent|se battent|crie sur|crient sur|menace|menacent) (?:maman|papa|ma mere|mon pere|mon frere|ma soeur|mes freres|mes soeurs|dessus|tout le temps|tous les jours|fort)|(?:papa|maman|mon pere|ma mere|mon beau pere|ma belle mere|mes parents)(?: \\w+){0,2} (?:boit|boivent) (?:trop |tout le temps |beaucoup |tous les soirs )?(?:d alcool|de l alcool|de biere|de vin|de whisky|de vodka)|(?:papa|maman|mon pere|ma mere|mon beau pere|ma belle mere) (?:est|sont) (?:tout le temps |souvent |toujours )?(?:bourre|bourree|saoul|saoule|soul|soule|ivre)'),
  words('fq_bullying', '(?:on|ils|elles|les autres|les grands|des eleves|des grands|tout le monde|quelqu un) (?:me|m) (?:rackette|rackettent|menace|menacent|harcele|harcelent|exclut|excluent|frappe|frappent|tape|tapent|pousse|poussent|crache dessus|crachent dessus)|on me vole (?:mon|ma|mes) (?:gouter|argent|affaires)|je me fais (?:racketter|taper|frapper|insulter|harceler|agresser)|je suis (?:harcele|harcelee|racket\\w*|victime)'),
  words('fq_distress', 'je me sens (?:tres |trop |tellement |toujours |tout le temps )?(?:seul|seule|triste|nul|nulle|inutile|mal dans ma peau)|je suis (?:tres |trop |tellement )?(?:malheureux|malheureuse|deprime|deprimee)|je n ai (?:plus )?(?:aucun ami|aucune amie|pas d amis|personne)|personne ne (?:veut|veux) (?:jouer avec moi|de moi|etre mon ami|etre mon amie)|j ai peur (?:de mourir|qu on me tue|qu il me frappe|qu elle me frappe|qu ils me frappent|de rentrer)|je (?:pleure|pleurais) (?:tout le temps|tous les soirs|tous les jours|chaque soir|chaque nuit)'),
];

/** Strict level only (§15.5 + §18.2.1): death and serious illness also go to an adult (with SENSITIVE_EDUCATIONAL). */
export const FREE_QUESTION_STRICT: readonly LexiconEntry[] = [
  words('fq_death', 'mort|morte|morts|mortes|mourir|meurt|meurent|mourra|mourront|mourait|mouraient|moururent|decede|decedee|decedes|deces|enterrement|enterrements|enterrer|funerailles|cercueil|cercueils|cimetiere|cimetieres|cadavre|cadavres'),
  words('fq_illness', 'cancer|cancers|leucemie|leucemies|sida|vih|tumeur|tumeurs|maladie grave|maladies graves|maladie mortelle|maladies mortelles|soins palliatifs'),
];

/** Contact data typed by the child (raw text): blocked as personal data (§18.2.1). */
export const FREE_QUESTION_CONTACT_IDS: readonly string[] = ['email', 'phone'];

/** URL / e-mail / phone numbers (raw text, §8.4). */
export const CONTACT_PATTERNS: readonly LexiconEntry[] = [
  { id: 'url', re: /\bhttps?:\/\/\S+|\bwww\.[^\s]+|\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|fr|net|org|io|be|ch|ca|info|eu|app|ai|xyz)\b/i },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: 'phone', re: /(?:\+|00)\s?\d{2,3}(?:[\s.-]?\d{1,4}){3,5}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/ },
];
