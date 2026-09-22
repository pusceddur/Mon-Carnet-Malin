import XCTest
@testable import CarnetKit

/// The questions the app writes on its own, from the book alone.
final class SeededRandomTests: XCTestCase {
    /// Pinned against the numbers the web app's generator produces for the same seeds. If these ever drift, the same
    /// book would give different exercises on the iPad and in the browser, and a child moving between the two would
    /// lose their place.
    func testTheSequenceMatchesTheWebApp() {
        let random = SeededRandom(seed: 1)
        let expected = [0.627073940588, 0.002735721180, 0.527447039960, 0.981050967472, 0.968377898214]
        for value in expected {
            XCTAssertEqual(random.next(), value, accuracy: 1e-12)
        }

        let other = SeededRandom(seed: 7)
        for value in [0.011704753153, 0.061958257575, 0.976907632779] {
            XCTAssertEqual(other.next(), value, accuracy: 1e-12)
        }
    }

    func testEveryNumberStaysInRange() {
        let random = SeededRandom(seed: 99)
        for _ in 0..<2000 {
            let value = random.next()
            XCTAssertGreaterThanOrEqual(value, 0)
            XCTAssertLessThan(value, 1)
        }
    }

    func testShufflingKeepsEveryItemExactlyOnce() {
        let items = (0..<50).map(String.init)
        let shuffled = SeededRandom(seed: 3).shuffled(items)
        XCTAssertEqual(shuffled.sorted(), items.sorted())
        XCTAssertNotEqual(shuffled, items, "a shuffle that changes nothing is not one")
    }

    func testAShortListSurvivesTheShuffle() {
        XCTAssertEqual(SeededRandom(seed: 1).shuffled([String]()), [])
        XCTAssertEqual(SeededRandom(seed: 1).shuffled(["seul"]), ["seul"])
    }
}

final class LocalQuestionTests: XCTestCase {
    private let forest = PageText(pageIndex: 0, text: """
        Le renard traverse la clairière pendant la nuit tranquille.
        Un hibou observe la forêt depuis sa branche préférée.
        La rivière descend vers le village endormi sans aucun bruit.
        Chaque matin le berger conduit son troupeau vers la colline.
        Une chouette appelle doucement derrière le vieux moulin.
        Le sentier monte jusqu'à la cabane du garde forestier.
        Les enfants ramassent des champignons près du ruisseau glacé.
        Un écureuil cache ses noisettes sous les feuilles mortes.
        La lumière du matin réveille doucement les oiseaux.
        Le vent souffle sur la plaine et agite les herbes hautes.
        """)

    private func generate(_ count: Int, _ types: [QuestionType], seed: UInt32 = 1) -> [Question] {
        LocalQuestions.generate(pages: [forest], count: count, types: types, seed: seed)
    }

    // MARK: - The shape of what comes out

    func testTheSameSeedAlwaysGivesTheSameExercise() {
        let first = generate(6, [.multipleChoice, .trueOrFalse, .ordering])
        let second = generate(6, [.multipleChoice, .trueOrFalse, .ordering])
        XCTAssertFalse(first.isEmpty)
        XCTAssertEqual(first, second)
    }

    func testAnotherSeedGivesAnotherExercise() {
        // A child who asks for new questions on the same chapter must not be handed the same ones back.
        let first = generate(6, [.multipleChoice, .trueOrFalse, .ordering], seed: 1)
        let others = [42, 7, 1234, 99].map { generate(6, [.multipleChoice, .trueOrFalse, .ordering], seed: UInt32($0)) }
        XCTAssertTrue(others.contains { $0 != first }, "every seed produced the very same exercise")
    }

    func testQuestionsAreNumberedInReadingOrder() {
        let questions = generate(5, [.multipleChoice, .trueOrFalse])
        XCTAssertFalse(questions.isEmpty)
        XCTAssertEqual(questions.map(\.id), questions.indices.map { "local-\($0 + 1)" })

        // They follow the book: each question quotes a passage at or after the one before it.
        let starts = questions.compactMap { forest.text.range(of: $0.source.quote)?.lowerBound }
        XCTAssertEqual(starts.count, questions.count)
        XCTAssertEqual(starts, starts.sorted())
    }

    func testEveryQuoteIsReallyInThePage() {
        for question in generate(12, [.multipleChoice, .trueOrFalse, .ordering]) {
            XCTAssertEqual(question.source.pageIndex, 0)
            XCTAssertTrue(
                forest.text.contains(question.source.quote),
                "« \(question.source.quote) » was not taken from the book"
            )
        }
    }

    func testNoMoreQuestionsThanAsked() {
        XCTAssertLessThanOrEqual(generate(3, [.multipleChoice, .trueOrFalse, .ordering]).count, 3)
        XCTAssertTrue(generate(0, [.multipleChoice]).isEmpty)
        XCTAssertTrue(generate(-5, [.multipleChoice]).isEmpty)
        XCTAssertLessThanOrEqual(generate(500, [.multipleChoice, .trueOrFalse, .ordering]).count, 20)
    }

    func testNoSentenceIsUsedTwice() {
        let questions = generate(20, [.multipleChoice, .trueOrFalse, .ordering])
        let quotes = questions.map(\.source.quote)
        XCTAssertEqual(Set(quotes).count, quotes.count, "the same passage must not come back as two questions")
    }

    func testTheKindsTakeTurns() {
        let types = generate(4, [.multipleChoice, .trueOrFalse]).map(\.type)
        XCTAssertTrue(types.contains(.multipleChoice))
        XCTAssertTrue(types.contains(.trueOrFalse), "a child must not get four of the same thing in a row")
    }

    func testOnlyTheKindsAskedFor() {
        for question in generate(10, [.trueOrFalse]) {
            XCTAssertEqual(question.type, .trueOrFalse)
        }
    }

    func testTheKindsTheAppCannotWriteAloneProduceNothing() {
        // A free answer needs someone to read it, and pairs invented without understanding the text
        // would be pairs of nothing. Better to give none than to give bad ones.
        XCTAssertTrue(generate(5, [.freeAnswer, .matching]).isEmpty)
        XCTAssertTrue(generate(5, []).isEmpty)
    }

    func testNothingIsInventedFromNothing() {
        XCTAssertTrue(LocalQuestions.generate(pages: [], count: 5, types: [.multipleChoice]).isEmpty)
        let blank = PageText(pageIndex: 0, text: "   \n\n  ")
        XCTAssertTrue(LocalQuestions.generate(pages: [blank], count: 5, types: [.multipleChoice]).isEmpty)
    }

    // MARK: - « Quel mot manque ? »

    func testTheBlankStandsWhereARealWordWas() throws {
        let questions = generate(6, [.multipleChoice])
        XCTAssertFalse(questions.isEmpty)

        for question in questions {
            guard case let .multipleChoice(choices, correctIndex, explanation) = question.kind else {
                return XCTFail("asked for one kind, got \(question.type)")
            }
            XCTAssertTrue(question.prompt.contains(ExerciseTexts.blank), "the child must see where the word is missing")
            XCTAssertGreaterThanOrEqual(choices.count, 3, "two choices is a coin toss dressed up as a question")
            XCTAssertEqual(Set(choices).count, choices.count, "the same word twice makes the answer obvious")
            XCTAssertTrue(choices.indices.contains(correctIndex))

            // The right choice is the word that was taken out, and the explanation shows the sentence whole.
            let answer = choices[correctIndex]
            XCTAssertTrue(question.source.quote.contains(answer))
            XCTAssertTrue(explanation.contains(answer))

            // And the wrong choices come from the same book, not from thin air. A choice a child can rule out
            // because it does not belong to the story is not a choice.
            let inSentence = Set(Tokenizer.tokenizeWords(question.source.quote).map(\.word))
            for choice in choices where choice != answer {
                XCTAssertTrue(forest.text.contains(choice), "« \(choice) » is not a word of this book")
                XCTAssertFalse(inSentence.contains(choice), "a word already in the sentence is no choice")
            }
        }
    }

    // MARK: - « Vrai ou faux ? »

    func testTheAnswerIsAlwaysTrueBecauseTheSentenceIsQuoted() throws {
        let questions = generate(6, [.trueOrFalse])
        XCTAssertFalse(questions.isEmpty)

        for question in questions {
            guard case let .trueOrFalse(answer, _) = question.kind else {
                return XCTFail("asked for one kind, got \(question.type)")
            }
            // The app never writes a false sentence: making one up would mean understanding the text well enough to
            // contradict it, and a plausible falsehood put in front of a child still learning to read is worse than
            // no question at all.
            XCTAssertTrue(answer)
            XCTAssertTrue(forest.text.contains(question.source.quote))
        }
    }

    func testASentenceThatSpeaksOfSomeoneIsLeftAlone() {
        // « Je suis parti » is neither true nor false on its own: it depends who « je » is.
        let diary = PageText(pageIndex: 0, text: """
            Je marche longtemps dans la forêt sombre et humide.
            Nous arrivons enfin devant la cabane du garde forestier.
            Tu regardes les oiseaux qui traversent le ciel gris.
            """)
        XCTAssertTrue(LocalQuestions.generate(pages: [diary], count: 5, types: [.trueOrFalse]).isEmpty)
    }

    func testDialogueAndQuestionsAreLeftAlone() {
        let dialogue = PageText(pageIndex: 0, text: """
            « Le renard traverse la clairière pendant la nuit tranquille. »
            Qui donc observe la forêt depuis la branche la plus haute ?
            """)
        XCTAssertTrue(LocalQuestions.generate(pages: [dialogue], count: 5, types: [.trueOrFalse]).isEmpty)
    }

    // MARK: - « Remets dans l’ordre »

    func testTheSentencesToOrderReallyFollowOneAnother() throws {
        let questions = generate(4, [.ordering])
        XCTAssertFalse(questions.isEmpty)

        for question in questions {
            guard case let .ordering(items) = question.kind else {
                return XCTFail("asked for one kind, got \(question.type)")
            }
            XCTAssertGreaterThanOrEqual(items.count, 3, "two sentences to order is not a puzzle")
            XCTAssertLessThanOrEqual(items.count, 5, "more than five at once is a wall of text")
            XCTAssertEqual(Set(items).count, items.count)

            // Joined in the given order they are the quoted passage, which is what makes the exercise solvable.
            var searchFrom = forest.text.startIndex
            for item in items {
                let found = try XCTUnwrap(
                    forest.text.range(of: item, range: searchFrom..<forest.text.endIndex),
                    "« \(item) » is not where it should be"
                )
                searchFrom = found.upperBound
            }
            for item in items {
                XCTAssertTrue(question.source.quote.contains(item))
            }
        }
    }

    func testSentencesFromTwoPagesAreNeverMixed() {
        let pages = [
            PageText(pageIndex: 0, text: "Le renard traverse la clairière pendant la nuit tranquille."),
            PageText(pageIndex: 1, text: """
                Un hibou observe la forêt depuis sa branche préférée.
                La rivière descend vers le village endormi sans aucun bruit.
                Chaque matin le berger conduit son troupeau vers la colline.
                Une chouette appelle doucement derrière le vieux moulin.
                """),
        ]
        for question in LocalQuestions.generate(pages: pages, count: 4, types: [.ordering]) {
            guard case let .ordering(items) = question.kind else { continue }
            let page = pages.first { $0.pageIndex == question.source.pageIndex }
            for item in items {
                XCTAssertTrue(page?.text.contains(item) ?? false, "a passage must come from one page")
            }
        }
    }

    // MARK: - The pieces underneath

    func testWhichWordsMayBeHidden() {
        XCTAssertTrue(LocalQuestions.isEligibleWord("renard"))
        XCTAssertTrue(LocalQuestions.isEligibleWord("arc-en-ciel"))
        XCTAssertFalse(LocalQuestions.isEligibleWord("Paris"), "a name is remembered, not read")
        XCTAssertFalse(LocalQuestions.isEligibleWord("1985"))
        XCTAssertFalse(LocalQuestions.isEligibleWord("le"), "too short to be read rather than guessed")
        XCTAssertFalse(LocalQuestions.isEligibleWord("dans"), "a grammar word teaches nothing here")
        XCTAssertFalse(LocalQuestions.isEligibleWord("quatre"), "a number is worked out, not recognised")
    }

    func testWordsAreGroupedByLength() {
        XCTAssertEqual(LocalQuestions.lengthBucket("chat"), 0)
        XCTAssertEqual(LocalQuestions.lengthBucket("renard"), 1)
        XCTAssertEqual(LocalQuestions.lengthBucket("clairière"), 2)
        XCTAssertEqual(LocalQuestions.lengthBucket("arc-en-ciel"), 2, "the hyphens are not letters")
    }

    func testTheWordBeforeTellsRoughlyWhatFollows() {
        XCTAssertEqual(LocalQuestions.wordClass(after: "les"), .afterDeterminer)
        XCTAssertEqual(LocalQuestions.wordClass(after: "L’"), .afterDeterminer)
        XCTAssertEqual(LocalQuestions.wordClass(after: "il"), .afterPronoun)
        XCTAssertEqual(LocalQuestions.wordClass(after: "renard"), .other)
        XCTAssertEqual(LocalQuestions.wordClass(after: nil), .other)
    }

    func testAHeadingIsNotASentence() {
        XCTAssertTrue(LocalQuestions.endsLikeSentence("Le chat dort."))
        XCTAssertTrue(LocalQuestions.endsLikeSentence("Où vas-tu ?"))
        XCTAssertTrue(LocalQuestions.endsLikeSentence("« Bonjour ! »"))
        XCTAssertTrue(LocalQuestions.endsLikeSentence("Et puis…"))
        XCTAssertFalse(LocalQuestions.endsLikeSentence("Chapitre premier"), "a heading would make the puzzle unsolvable")
        XCTAssertFalse(LocalQuestions.endsLikeSentence(""))
    }
}
