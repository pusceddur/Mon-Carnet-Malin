import XCTest
@testable import CarnetKit

/// Cases from `shared/test/text/lemma.test.ts`. A child taps a word in the middle of a sentence and expects the
/// dictionary to answer: these are the forms that must lead back to the entry the dictionary actually holds.
final class LemmaTests: XCTestCase {
    private func assertLeadsTo(_ pairs: [(String, String)], file: StaticString = #filePath, line: UInt = #line) {
        for (word, lemma) in pairs {
            let candidates = Lemma.candidates(for: word)
            XCTAssertTrue(
                candidates.contains(lemma),
                "« \(word) » should offer « \(lemma) », got \(candidates.prefix(8))",
                file: file, line: line
            )
        }
    }

    func testStartsWithTheWordItselfInLowerCase() {
        XCTAssertEqual(Lemma.candidates(for: "Chevaux").first, "chevaux")
        XCTAssertEqual(Lemma.candidates(for: "volcan").first, "volcan")
        XCTAssertEqual(Lemma.candidates(for: "  Forêt, ").first, "forêt,")
        XCTAssertTrue(Lemma.candidates(for: "  Forêt, ").contains("forêt"))
    }

    func testIrregularNounsAndAdjectives() {
        assertLeadsTo([
            ("yeux", "œil"), ("cieux", "ciel"), ("travaux", "travail"), ("messieurs", "monsieur"),
            ("belle", "beau"), ("vieille", "vieux"), ("nouvelle", "nouveau"), ("douce", "doux"),
            ("blanche", "blanc"), ("longue", "long"),
        ])
    }

    func testIrregularVerbForms() {
        assertLeadsTo([
            ("était", "être"), ("sommes", "être"), ("furent", "être"), ("ont", "avoir"), ("eurent", "avoir"),
            ("font", "faire"), ("fit", "faire"), ("vont", "aller"), ("ira", "aller"), ("peuvent", "pouvoir"),
            ("veut", "vouloir"), ("sait", "savoir"), ("voient", "voir"), ("vit", "voir"), ("vit", "vivre"),
            ("viennent", "venir"), ("devint", "devenir"), ("souviens", "souvenir"), ("tient", "tenir"),
            ("obtenu", "obtenir"), ("prennent", "prendre"), ("appris", "apprendre"), ("compris", "comprendre"),
            ("mis", "mettre"), ("promet", "promettre"), ("doit", "devoir"), ("faut", "falloir"), ("né", "naître"),
            ("meurt", "mourir"), ("vécut", "vivre"), ("court", "courir"), ("connaît", "connaître"),
            ("connait", "connaître"), ("disparut", "disparaître"), ("croient", "croire"), ("boivent", "boire"),
            ("écrivent", "écrire"), ("décrit", "décrire"), ("lisent", "lire"), ("ouvert", "ouvrir"),
            ("découvre", "découvrir"), ("offert", "offrir"), ("reçoit", "recevoir"), ("aperçut", "apercevoir"),
            ("part", "partir"), ("sort", "sortir"), ("dort", "dormir"), ("sent", "sentir"), ("suit", "suivre"),
            ("plaît", "plaire"), ("pleut", "pleuvoir"), ("peint", "peindre"), ("éteint", "éteindre"),
            ("craint", "craindre"), ("rejoint", "rejoindre"), ("construit", "construire"),
            ("conduisent", "conduire"), ("bat", "battre"), ("rit", "rire"), ("assis", "asseoir"),
            ("cueille", "cueillir"), ("fuient", "fuir"), ("enfuit", "enfuir"), ("envoie", "envoyer"),
            ("conquit", "conquérir"), ("vainquit", "vaincre"), ("dissout", "dissoudre"), ("résolu", "résoudre"),
            ("dit", "dire"),
        ])
    }

    func testPluralsAndFeminineForms() {
        assertLeadsTo([
            ("chats", "chat"), ("chevaux", "cheval"), ("animaux", "animal"), ("tuyaux", "tuyau"),
            ("bateaux", "bateau"), ("jeux", "jeu"), ("genoux", "genou"), ("grandes", "grand"), ("amie", "ami"),
            ("sportive", "sportif"), ("danseuse", "danseur"), ("heureuses", "heureux"), ("actrice", "acteur"),
            ("ancienne", "ancien"), ("bonne", "bon"), ("naturelle", "naturel"), ("muette", "muet"),
            ("première", "premier"), ("publique", "public"), ("publiques", "public"), ("complète", "complet"),
            ("gentille", "gentil"), ("grosse", "gros"),
        ])
    }

    func testFirstGroupVerbs() {
        assertLeadsTo([
            ("mange", "manger"), ("manges", "manger"), ("mangeons", "manger"), ("mangez", "manger"),
            ("mangent", "manger"), ("mangeait", "manger"), ("mangeaient", "manger"), ("mangea", "manger"),
            ("mangèrent", "manger"), ("mangera", "manger"), ("mangeraient", "manger"), ("mangé", "manger"),
            ("mangée", "manger"), ("mangeant", "manger"), ("commençons", "commencer"), ("commençait", "commencer"),
            ("lève", "lever"), ("achète", "acheter"), ("appellent", "appeler"), ("jette", "jeter"),
            ("cède", "céder"), ("préfère", "préférer"), ("nettoie", "nettoyer"), ("essuie", "essuyer"),
            ("paie", "payer"), ("hésita", "hésiter"), ("murmurèrent", "murmurer"), ("grimpaient", "grimper"),
        ])
    }

    func testSecondAndThirdGroupVerbs() {
        assertLeadsTo([
            ("finit", "finir"), ("finissent", "finir"), ("finissait", "finir"), ("finira", "finir"),
            ("finirent", "finir"), ("fini", "finir"), ("finie", "finir"), ("choisissons", "choisir"),
            ("attend", "attendre"), ("attendent", "attendre"), ("attendait", "attendre"), ("attendra", "attendre"),
            ("attendu", "attendre"), ("répondirent", "répondre"), ("vendue", "vendre"),
        ])
    }

    func testStripsElisions() {
        assertLeadsTo([
            ("l’arbre", "arbre"), ("d'eau", "eau"), ("s’enfuit", "enfuir"), ("qu’elles", "elle"), ("jusqu’au", "au"),
        ])
        // « aujourd’hui » is one word: its apostrophe must not be read as an elision.
        XCTAssertEqual(Lemma.candidates(for: "aujourd’hui").first, "aujourd’hui")
    }

    func testTurnsAdverbsInMentBackIntoAdjectives() {
        assertLeadsTo([
            ("doucement", "douce"), ("heureusement", "heureux"), ("prudemment", "prudent"), ("vraiment", "vrai"),
        ])
    }

    func testAddsNoGuessesToAuxiliaryForms() {
        // « est » is the verb « être » and nothing else: suffix rules here would only produce noise.
        let tiers = Lemma.tiers(for: "est")
        XCTAssertEqual(tiers.irregular, ["être"])
        XCTAssertEqual(tiers.heuristic, [])
    }
}
