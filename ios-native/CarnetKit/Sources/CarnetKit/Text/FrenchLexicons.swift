import Foundation

/// §26 « Couleurs de lecture »: the exception lists of French spelling, ported from `shared/src/text/frenchCoding.ts`.
///
/// French rules cover most of a text; the rest is learnt by heart, and that is what these lists are. They stay in a file
/// of their own so the engine beside them reads as rules rather than as data.
enum FrenchLexicons {
    private static func words(_ list: String) -> Set<String> {
        Set(list.split(whereSeparator: { $0.isWhitespace }).map(String.init))
    }

    // MARK: - Final letters that are heard although the rule would silence them

    static let soundedS = words("""
        as bus autobus ours tennis cactus virus bonus campus iris oasis atlas maïs lys jadis hélas mars sens gratis express albatros
        rhinocéros cassis sinus prospectus terminus papyrus chorus blocus lotus eucalyptus humus rébus thermos bis tournevis vis myosotis
        hibiscus pancréas plexus fœtus index
        """)
    static let soundedX = words("index lynx silex larynx box fax thorax sphinx phénix relax latex pyrex onyx borax max lux")
    static let soundedZ = words("gaz quiz jazz fez oz blitz hertz")
    static let soundedT = words("""
        cet net brut chut zut dot mat rut scout internet kit set hit granit transit déficit mazout azimut bit tilt fat
        ticket basket
        """)
    static let soundedD = words("sud david bled raid stand lad yod caïd end")
    static let soundedP = words("cap cep stop top hop handicap clip slip ketchup hip cop flop pop rap scalp jeep gap croup")
    static let soundedG = words("gag grog zigzag iceberg bug blog gang erg whig gong ping pong bang boomerang")
    /// Words in -er whose r is heard (mer, hiver…); plural stems are included, since « vers » is checked as « ver ».
    static let soundedER = words("""
        mer fer ver fier hier cher amer hiver enfer super cancer laser hamster revolver poster cuiller éther bunker
        leader cracker poker starter scooter cutter reporter joker boxer roller hier tier enver traver univer rever diver perver
        """)

    // MARK: - Final letters that are silent although the rule would sound them

    static let silentC = words("blanc banc franc tabac estomac porc flanc caoutchouc jonc tronc accroc croc escroc broc clerc marc ajonc raccroc")
    static let silentL = words("gentil outil fusil sourcil nombril persil soûl saoul fournil coutil")
    static let silentF = words("clef cerf nerf")
    static let silentB = words("plomb aplomb")

    // MARK: - Groups that break their usual rule

    /// Final -um heard as « omme »: album, maximum.
    static let umNotNasal = words("""
        album maximum minimum forum aquarium podium rhum géranium sérum opium médium calcium sodium magnésium stadium
        auditorium référendum consortium optimum muséum
        """)
    /// Final -en heard as « ène »: examen, pollen.
    static let enNotNasal = words("examen pollen abdomen spécimen gluten dolmen lichen hymen cyclamen amen")
    /// ll heard as l after i (ville), not as « ye » (fille).
    static let illAsL = words("""
        ville villes mille milles tranquille tranquilles village villages villa villas million millions milliard milliards
        millier milliers lille distiller osciller pupille pupilles bacille bacilles cyrille
        """)
    /// ch heard as k.
    static let chAsK = words("""
        chorale chorales chœur chœurs écho échos orchestre orchestres technique techniques chaos orchidée orchidées
        archéologie archéologue christophe christine chrétien chrétienne chrome chronique chronomètre psychologie psychologue
        yacht
        """)
    /// h aspiré: no liaison before these words (les | héros).
    static let hAspire = words("""
        hache haie haine haïr halte hamac hamburger hameau hamster hanche handicap hangar hanter harceler hardi hareng
        haricot harpe hasard hâte hausse haut haute hauteur hérisson héron héros hêtre hibou hiboux hiérarchie hisser hocher hockey homard
        honte honteux hoquet hors hotte houx hublot huer huit huitième hurler hutte hall halle hanneton hachis hachoir haillon harnais harpon
        havre héraut hobby houle housse huche hongrois hollandais hurlement hérisser heurter
        """)

    // MARK: - Words around a liaison

    static let clitics = words("ne n se s le la l les lui leur y en me m te t nous vous")
    static let subjects = words("ils elles")
    static let pluralDeterminers = words("""
        les des mes tes ses ces nos vos leurs aux plusieurs quelques certains certaines deux trois quatre cinq six sept huit neuf dix tous toutes
        """)
    static let liaisonAlways = words("""
        les des mes tes ses ces nos vos leurs aux un aucun mon ton son quels quelles quelques plusieurs certains certaines deux trois six dix vingt cent cet
        """)
    static let liaisonWords = words("nous vous ils elles on en dans chez sans sous très plus quand dont tout")
    static let liaisonAdjectives = words("""
        petit petits petites grand grands grandes gros bon bons bonnes beaux belles premier premiers premières dernier
        derniers dernières mauvais vieux jolis jolies autres nouveaux nouvelles anciens anciennes longs faux vrais
        """)
    static let noLiaisonNext = words("et ou où à au aux avec alors après avant ainsi aussi oui onze onzième ici")
    static let notAfterAdjective = words("est a ai as avait était ont avaient étaient en il elle ils elles on y")

    // MARK: - Words the rules cannot read

    /// Irregular words written in the notation of `FrenchCoding.format`: `|` syllable, `{}` silent, `[]` one sound,
    /// `<>` a letter that does not make its usual sound.
    static let lexiconNotation: [String] = [
        "e{st}", "se{p}t", "se{p}|tiè|m{e}", "c[om]{p}|te{r}", "c[om]{p}|t{e}", "c[om]{p}|t[oi]r", "d[om]{p}|te{r}", "ba{p}|tê|m{e}",
        "scul{p}|te{r}", "scul{p}|tu|r{e}", "f<e>m|m{e}", "m<on>|si[eu]{r}", "o{i}|[gn][on]", "{a}[oû]t", "y[eu]{x}", "[œil]", "fi{l}s",
        "p[ou]{ls}", "{h}uit", "si<x>", "di<x>", "se|<c>[on]{d}", "se|<c>[on]|d{e}", "e<x>a|men", "[au]|j[ou]rd", "al|bum", "[ou]i",
        "[œu]{fs}", "b[œu]{fs}", "p[oê]|l{e}", "p[ay]{s}", "pa|y<s>a|<g>{e}", "[<ch>]o|ra|l{e}", "é|[<ch>]o", "or|[<ch>]es|tr{e}",
        "te[<ch>]|ni|[qu]{e}", "[<ch>][œu]r", "[<ch>]a|os", "or|[<ch>]i|dé{e}", "vil|l{e}", "mil|l{e}", "tr[an]|[qu]il|l{e}",
        "vil|la|<g>{e}", "mil|li[on]", "mil|liar{d}", "mil|lie{r}", "vil|la", "e{t}", "a|vec", "[ch]e{f}|d[œu]|vr{e}",
    ]
}
