import XCTest
@testable import CarnetKit

/// A server that answers what it is told to, and counts what it was asked.
final class StubAITransport: AITransport, @unchecked Sendable {
    private let lock = NSLock()
    private var posts: [(operation: AIOperation, body: [String: Any])] = []
    private var polls = 0
    private var postReplies: [Result<String, Error>]
    private var pollReplies: [Result<String, Error>]

    init(posts: [Result<String, Error>], polls: [Result<String, Error>] = []) {
        self.postReplies = posts
        self.pollReplies = polls
    }

    var postCount: Int { lock.withLock { posts.count } }
    var pollCount: Int { lock.withLock { polls } }
    func body(_ index: Int) -> [String: Any] { lock.withLock { posts[index].body } }

    func postAI(_ operation: AIOperation, body: Data, timeout: TimeInterval) async throws -> Data {
        let object = (try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
        let reply: Result<String, Error> = lock.withLock {
            posts.append((operation, object))
            return postReplies.isEmpty ? .failure(APIError.offline) : postReplies.removeFirst()
        }
        return Data(try reply.get().utf8)
    }

    func pollAIJob(_ jobId: String, waitMs: Int, timeout: TimeInterval) async throws -> Data {
        let reply: Result<String, Error> = lock.withLock {
            polls += 1
            return pollReplies.isEmpty ? .failure(APIError.offline) : pollReplies.removeFirst()
        }
        return Data(try reply.get().utf8)
    }
}

private let meta = #"{"cached":false,"route":"light","promptVersion":"p","sourceWarning":false,"requestId":"r"}"#

private func ok(_ data: String) -> Result<String, Error> {
    .success(#"{"status":"ok","data":\#(data),"meta":\#(meta)}"#)
}

final class AIServiceTests: XCTestCase {
    private var cacheDirectory: URL!

    override func setUp() {
        super.setUp()
        cacheDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: cacheDirectory)
        super.tearDown()
    }

    private func child(
        readingLevel: ReadingLevel = .intermediaire,
        explanationDifficulty: ExplanationDifficulty = .simple
    ) -> ChildProfile {
        ChildProfile(
            id: "c1", parentId: "p1", nickname: "Léa", avatar: "🦊",
            readingLevel: readingLevel, explanationDifficulty: explanationDifficulty,
            reading: .standard, tts: .standard, exercises: .standard, createdAt: 0, updatedAt: 0
        )
    }

    private func explainWord(_ word: String = "clairière") -> ExplainWordRequest {
        ExplainWordRequest(
            childId: "c1", documentId: "d1", documentHash: nil, word: word,
            sentence: "Le renard traverse la clairière.", paragraph: "Le renard traverse la clairière.",
            pageIndex: 0, ocrLowConfidence: false
        )
    }

    private func service(_ transport: StubAITransport, parent: String = "p1", cached: Bool = true) -> AIService {
        AIService(
            transport: transport, cache: cached ? AICache(directory: cacheDirectory) : nil,
            parentId: parent, minimumPollMs: 1
        )
    }

    // MARK: - The wire

    func testARequestCarriesItsEmptyFieldsAsNull() throws {
        // The server validates with `.nullable()`: a key left out is a refused request.
        let data = try JSONEncoder().encode(explainWord())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object.keys.contains("documentHash"))
        XCTAssertTrue(object["documentHash"] is NSNull)
        XCTAssertEqual(object["word"] as? String, "clairière")
    }

    func testAFreeQuestionIsNeverAboutABook() throws {
        let data = try JSONEncoder().encode(
            FreeQuestionRequest(childId: "c1", question: "Pourquoi le ciel est bleu ?", previous: nil, mode: .normal)
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object["documentId"] is NSNull)
        XCTAssertTrue(object["documentHash"] is NSNull)
        XCTAssertTrue(object["previous"] is NSNull)
        XCTAssertEqual(object["mode"] as? String, "normal")
    }

    func testTheTwoSummaryStagesSayWhichTheyAre() throws {
        let chunk = TextChunk(chunkIndex: 0, pageIndexes: [0], text: "Le chat.", contentHash: "h")
        let first = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SummarizeChunkRequest(
            childId: "c1", documentId: nil, documentHash: nil, level: .short, planHash: "p", chunk: chunk,
            ocrLowConfidence: false
        ))) as? [String: Any]
        let stage = first?["stage"] as? [String: Any]
        XCTAssertEqual(stage?["kind"] as? String, "chunk")
        XCTAssertEqual(first?["level"] as? String, "bref")

        let final = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SummarizeFinalRequest(
            childId: "c1", documentId: nil, documentHash: nil, level: .detailed, planHash: "p", chunkCount: 3,
            ocrLowConfidence: false
        ))) as? [String: Any]
        XCTAssertEqual((final?["stage"] as? [String: Any])?["kind"] as? String, "final")
        XCTAssertEqual((final?["stage"] as? [String: Any])?["chunkCount"] as? Int, 3)
    }

    func testTooMuchTextIsCutBeforeItIsSentNotRefusedAfter() {
        let long = String(repeating: "a", count: 500)
        XCTAssertEqual(explainWord(long).word.utf16.count, AILimits.wordMaxChars)
        let question = QuestionOnTextRequest(
            childId: "c1", documentId: nil, documentHash: nil, question: String(repeating: "b", count: 900), pages: []
        )
        XCTAssertEqual(question.question.utf16.count, AILimits.questionOnTextMaxChars)
    }

    func testQuestionCountsAreOnesTheServerAccepts() {
        let request = GenerateQuestionsRequest(
            childId: "c1", documentId: nil, documentHash: nil, count: 7, types: [.multipleChoice], pages: []
        )
        XCTAssertTrue([3, 5, 10].contains(request.count))
    }

    // MARK: - Answers

    func testAnAnswerIsReadAndThenServedFromTheDevice() async {
        let transport = StubAITransport(posts: [
            ok(#"{"explanation":"Un endroit sans arbres dans une forêt.","example":null,"sourceQuotes":[]}"#),
        ])
        let ai = service(transport)

        let first = await ai.request(explainWord(), for: child())
        XCTAssertEqual(first.value?.explanation, "Un endroit sans arbres dans une forêt.")
        XCTAssertEqual(first.meta?.cached, false)

        // Second time, on the train: no network needed.
        let second = await ai.request(explainWord(), for: child())
        XCTAssertEqual(second.value?.explanation, "Un endroit sans arbres dans une forêt.")
        XCTAssertEqual(second.meta?.cached, true)
        XCTAssertEqual(transport.postCount, 1)
    }

    func testAnotherFamilyNeverGetsThisFamilysAnswer() async {
        let transport = StubAITransport(posts: [
            ok(#"{"explanation":"Réponse de la famille 1.","example":null,"sourceQuotes":[]}"#),
            ok(#"{"explanation":"Réponse de la famille 2.","example":null,"sourceQuotes":[]}"#),
        ])
        _ = await service(transport, parent: "p1").request(explainWord(), for: child())
        let other = await service(transport, parent: "p2").request(explainWord(), for: child())
        XCTAssertEqual(other.value?.explanation, "Réponse de la famille 2.")
        XCTAssertEqual(transport.postCount, 2)
    }

    /// §32: the cache is keyed by how the reader reads, not by how old they are — there is no age any more.
    func testAnAnswerForOneReadingLevelIsNotHandedToAnother() async {
        let transport = StubAITransport(posts: [
            ok(#"{"explanation":"Pour un lecteur avancé.","example":null,"sourceQuotes":[]}"#),
            ok(#"{"explanation":"Pour un lecteur débutant.","example":null,"sourceQuotes":[]}"#),
        ])
        let ai = service(transport)
        _ = await ai.request(explainWord(), for: child(readingLevel: .avance, explanationDifficulty: .normal))
        let beginner = await ai.request(
            explainWord(), for: child(readingLevel: .debutant, explanationDifficulty: .tresSimple)
        )
        XCTAssertEqual(beginner.value?.explanation, "Pour un lecteur débutant.")
    }

    func testAFreeQuestionIsAskedEveryTime() async {
        // Never kept on the device: the parent sees every question asked, and a local copy would skip that.
        let transport = StubAITransport(posts: [
            ok(#"{"answer":"Parce que…","example":null,"suggestions":[]}"#),
            ok(#"{"answer":"Parce que…","example":null,"suggestions":[]}"#),
        ])
        let ai = service(transport)
        let question = FreeQuestionRequest(childId: "c1", question: "Pourquoi ?", previous: nil, mode: .normal)
        _ = await ai.request(question, for: child())
        _ = await ai.request(question, for: child())
        XCTAssertEqual(transport.postCount, 2)
    }

    func testARefusalIsNotKeptForTomorrow() async {
        let transport = StubAITransport(posts: [
            .success(#"{"status":"unavailable","reason":"busy","message":"","meta":null}"#),
            ok(#"{"explanation":"Maintenant ça marche.","example":null,"sourceQuotes":[]}"#),
        ])
        let ai = service(transport)
        let first = await ai.request(explainWord(), for: child())
        XCTAssertTrue(first.isUnavailable)
        let second = await ai.request(explainWord(), for: child())
        XCTAssertEqual(second.value?.explanation, "Maintenant ça marche.")
    }

    func testAnEmptyMessageIsReplacedByTheOneTheChildShouldRead() async {
        let transport = StubAITransport(posts: [
            .success(#"{"status":"unavailable","reason":"quota","message":"  ","meta":null}"#),
        ])
        let result = await service(transport).request(explainWord(), for: child())
        XCTAssertEqual(result.message, KidMessages.quota)
    }

    func testAPassageAboutDifficultThingsSendsTheChildToAnAdult() async {
        let transport = StubAITransport(posts: [
            .success(#"{"status":"blocked","reason":"adult_redirect","message":"","meta":\#(meta)}"#),
        ])
        let result = await service(transport).request(explainWord(), for: child())
        XCTAssertEqual(result.message, KidMessages.adultRedirect)
    }

    func testNoNetworkIsSaidAsNoNetwork() async {
        let transport = StubAITransport(posts: [.failure(APIError.offline)])
        let result = await service(transport).request(explainWord(), for: child())
        guard case let .unavailable(reason, message, _) = result else { return XCTFail("unavailable") }
        XCTAssertEqual(reason, .offline)
        XCTAssertEqual(message, KidMessages.offline)
        XCTAssertTrue(reason.isWorthRetrying)
    }

    func testAnAnswerThatCannotBeReadIsNotShown() async {
        let transport = StubAITransport(posts: [.success(#"{"status":"ok","data":{"wrong":true},"meta":\#(meta)}"#)])
        let result = await service(transport).request(explainWord(), for: child())
        guard case let .unavailable(reason, _, _) = result else { return XCTFail("unavailable") }
        XCTAssertEqual(reason, .providerError)
    }

    func testALongJobIsWaitedFor() async {
        let transport = StubAITransport(
            posts: [.success(#"{"status":"pending","jobId":"j1","pollAfterMs":1}"#)],
            polls: [
                .success(#"{"status":"pending","pollAfterMs":1}"#),
                ok(#"{"questions":[]}"#),
            ]
        )
        let result = await service(transport).request(
            GenerateQuestionsRequest(
                childId: "c1", documentId: "d1", documentHash: nil, count: 5, types: [.multipleChoice], pages: []
            ),
            for: child()
        )
        XCTAssertNotNil(result.value)
        XCTAssertEqual(transport.pollCount, 2)
    }

    func testAPassingNetworkHiccupDuringAJobIsRiddenOut() async {
        let transport = StubAITransport(
            posts: [.success(#"{"status":"pending","jobId":"j1","pollAfterMs":1}"#)],
            polls: [
                .failure(APIError.api(status: 502, code: "bad_gateway", message: "")),
                ok(#"{"questions":[]}"#),
            ]
        )
        let result = await service(transport).request(
            GenerateQuestionsRequest(
                childId: "c1", documentId: "d1", documentHash: nil, count: 5, types: [.multipleChoice], pages: []
            ),
            for: child()
        )
        XCTAssertNotNil(result.value)
    }

    func testOneUnreadableQuestionDoesNotCostTheOthers() throws {
        let json = #"""
        {"questions":[
          {"id":"q1","prompt":"Vrai ?","source":{"pageIndex":0,"quote":"x"},"type":"vrai_faux","answer":true,"explanation":"e"},
          {"id":"q2","prompt":"?","source":{"pageIndex":0,"quote":"x"},"type":"dessin","canvas":1}
        ]}
        """#
        let data = try JSONDecoder().decode(QuestionsData.self, from: Data(json.utf8))
        XCTAssertEqual(data.questions.map(\.id), ["q1"])
    }

    // MARK: - The progressive summary

    private func pages(_ texts: [String]) -> [AIPageInput] {
        texts.enumerated().map {
            AIPageInput(pageIndex: $0.offset, text: $0.element, contentHash: "h\($0.offset)", ocrLowConfidence: false)
        }
    }

    func testASummaryIsBuiltChunkByChunkThenWhole() async {
        let transport = StubAITransport(posts: [
            ok(#"{"chunkIndex":0,"summary":"Un chat dort.","keyQuotes":[]}"#),
            ok(#"{"summary":"Un chat dort et un chien joue.","keyPoints":["Le chat dort."],"sourceRefs":[]}"#),
        ])
        let steps = ProgressLog()
        let result = await service(transport).summarize(
            pages: pages(["Le chat dort sur le mur.", "Le chien joue."]),
            level: .normal, child: child(), documentId: "d1", documentHash: nil,
            progress: { done, total in steps.add(done, total) }
        )
        XCTAssertEqual(result.value?.summary, "Un chat dort et un chien joue.")
        XCTAssertEqual(steps.last?.done, steps.last?.total, "the bar ends full")
        XCTAssertEqual(steps.first?.done, 0, "and starts empty rather than jumping")
    }

    func testChunksTheServerLostAreSentAgain() async {
        let transport = StubAITransport(posts: [
            ok(#"{"chunkIndex":0,"summary":"a","keyQuotes":[]}"#),
            .success(#"{"status":"unavailable","reason":"missing_chunks","message":"","meta":null,"missingChunkIndexes":[0]}"#),
            ok(#"{"chunkIndex":0,"summary":"a","keyQuotes":[]}"#),
            ok(#"{"summary":"Résumé.","keyPoints":[],"sourceRefs":[]}"#),
        ])
        let result = await service(transport, cached: false).summarize(
            pages: pages(["Le chat dort."]), level: .short, child: child(), documentId: "d1", documentHash: nil
        )
        XCTAssertEqual(result.value?.summary, "Résumé.")
        XCTAssertEqual(transport.postCount, 4)
    }

    func testAnEmptyBookIsNotSentAtAll() async {
        let transport = StubAITransport(posts: [])
        let result = await service(transport).summarize(
            pages: pages(["   ", ""]), level: .short, child: child(), documentId: "d1", documentHash: nil
        )
        guard case .notInText = result else { return XCTFail("nothing to summarise") }
        XCTAssertEqual(transport.postCount, 0)
    }

    func testAChunkTheHelpCannotAnswerStopsTheSummary() async {
        let transport = StubAITransport(posts: [.failure(APIError.offline)])
        let result = await service(transport).summarize(
            pages: pages(["Le chat dort."]), level: .short, child: child(), documentId: "d1", documentHash: nil
        )
        guard case let .unavailable(reason, _, _) = result else { return XCTFail("unavailable") }
        XCTAssertEqual(reason, .offline)
        XCTAssertEqual(transport.postCount, 1, "no final step for a summary that has no chunks")
    }
}

final class ProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var steps: [(done: Int, total: Int)] = []

    func add(_ done: Int, _ total: Int) { lock.withLock { steps.append((done, total)) } }
    var first: (done: Int, total: Int)? { lock.withLock { steps.first } }
    var last: (done: Int, total: Int)? { lock.withLock { steps.last } }
}

final class SummaryPlanTests: XCTestCase {
    private func para(_ count: Int) -> String {
        (0..<count).map { "Le renard numéro \($0) traverse la clairière pendant la nuit." }.joined(separator: " ")
    }

    /// Pinned against what the web app's `planChunks` produces for the same pages. The server keeps chunk summaries
    /// under these hashes; if the two apps cut a book differently, each pays for the other's summary again.
    func testThePlanIsTheWebAppsToTheByte() {
        let pages = [
            AIPageInput(pageIndex: 0, text: "Le chat dort sur le mur.", contentHash: "x", ocrLowConfidence: false),
            AIPageInput(pageIndex: 1, text: "   ", contentHash: "x", ocrLowConfidence: false),
            AIPageInput(pageIndex: 2, text: "Le chien joue dans le jardin.", contentHash: "x", ocrLowConfidence: false),
            AIPageInput(pageIndex: 3, text: para(30) + "\n\n" + para(30), contentHash: "x", ocrLowConfidence: false),
        ]
        let chunks = SummaryPlan.chunks(for: pages, maxChars: 1200)

        XCTAssertEqual(chunks.map(\.chunkIndex), [0, 1, 2, 3])
        XCTAssertEqual(chunks.map(\.pageIndexes), [[0, 2], [3], [3], [3]])
        XCTAssertEqual(chunks.map { $0.text.utf16.count }, [55, 1169, 1170, 1179])
        XCTAssertEqual(chunks.map(\.contentHash), [
            "c54d118113b04514eac54bc188d61c4a6e4e7730c2f1c20e35d3cd6a3dc0eb4e",
            "3d46052f358461fab8c899d13cb23fed161f3ab0b8e19dbcd9fb42cbf02c9c86",
            "9524afe3ec83799531f784a69e1b05b9db5e4a0ed04bef0ecb471e095a07c3b9",
            "ab8a021655082baca2ba1aef1995058c019dddf68c0778cb4b047965e4ffda74",
        ])
        XCTAssertEqual(
            SummaryPlan.hash(of: chunks), "d8b028d0100732adbbee63b1cc53690e6aba58e5bb7dbfa6748ad48abda38e87"
        )
    }

    func testShortPagesShareAChunkAndABlankLineSeparatesThem() {
        let chunks = SummaryPlan.chunks(for: [
            AIPageInput(pageIndex: 0, text: " Un. ", contentHash: "x", ocrLowConfidence: false),
            AIPageInput(pageIndex: 1, text: "Deux.", contentHash: "x", ocrLowConfidence: false),
        ])
        XCTAssertEqual(chunks.count, 1)
        XCTAssertEqual(chunks[0].text, "Un.\n\nDeux.")
    }

    func testNoChunkIsEverLongerThanTheLimit() {
        let page = AIPageInput(pageIndex: 0, text: para(200), contentHash: "x", ocrLowConfidence: false)
        for chunk in SummaryPlan.chunks(for: [page], maxChars: 800) {
            XCTAssertLessThanOrEqual(chunk.text.utf16.count, 800)
        }
    }

    func testNothingToSummariseMakesNoChunks() {
        XCTAssertTrue(SummaryPlan.chunks(for: []).isEmpty)
        XCTAssertTrue(SummaryPlan.chunks(for: [
            AIPageInput(pageIndex: 0, text: "\n\n", contentHash: "x", ocrLowConfidence: false),
        ]).isEmpty)
    }
}

final class AIPageInputTests: XCTestCase {
    private func page(_ index: Int, _ text: String, status: PageStatus = .ready) -> PageContent {
        let blocks = [TextBlock(kind: .paragraph, text: text)]
        return PageContent(
            documentId: "d1", pageIndex: index, status: status, blocks: blocks,
            contentHash: Hashing.contentHash(of: blocks), updatedAt: 0
        )
    }

    func testPagesGoInOrderAndUnreadableOnesStayBehind() {
        let (inputs, truncated) = AIPageInput.from([page(2, "Deux."), page(0, "Zéro."), page(1, "", status: .pending)])
        XCTAssertEqual(inputs.map(\.pageIndex), [0, 2])
        XCTAssertFalse(truncated)
    }

    func testAPageAMachineReadIsFlagged() {
        let (inputs, _) = AIPageInput.from([page(0, "Le chat.", status: .lowConfidence)])
        XCTAssertEqual(inputs.first?.ocrLowConfidence, true)
    }

    func testTheFirstPageIsSentEvenWhenItAloneIsTooLong() {
        let (inputs, truncated) = AIPageInput.from(
            [page(0, String(repeating: "a", count: 50)), page(1, "Suite.")], maxTotalChars: 20
        )
        XCTAssertEqual(inputs.count, 1)
        XCTAssertEqual(inputs[0].text.utf16.count, 20)
        XCTAssertTrue(truncated)
    }
}

final class NullCodableTests: XCTestCase {
    func testAnEmptyFieldIsWrittenAsNullNotLeftOut() throws {
        // The sync refuses a row whose nullable field is missing; before this, every page the iPad wrote without a
        // confidence would have been silently refused.
        let page = PageContent(documentId: "d1", pageIndex: 0, status: .pending, updatedAt: 0)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(page)) as? [String: Any]
        )
        for key in ["textSource", "confidence", "contentHash", "width", "height"] {
            XCTAssertTrue(object[key] is NSNull, "« \(key) » must be present as null")
        }
    }

    func testARowWrittenWithoutTheKeyStillOpens() throws {
        let json = #"{"documentId":"d1","pageIndex":0,"status":"ready","blocks":[],"warnings":[],"updatedAt":1}"#
        let page = try JSONDecoder().decode(PageContent.self, from: Data(json.utf8))
        XCTAssertNil(page.confidence)
    }

    func testTheSpokenFormStaysOptional() throws {
        // `spoken` is `optional()` on the server, not `nullable()`: it must be left out, not written as null.
        let object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: JSONEncoder().encode(TextBlock(kind: .paragraph, text: "x"))
        ) as? [String: Any])
        XCTAssertFalse(object.keys.contains("spoken"))
    }

    func testEveryKindOfRowTheIPadWritesCarriesItsNulls() throws {
        let answer = Answer(
            id: "a1", exerciseId: "e1", questionId: "q1", childId: "c1",
            response: .trueOrFalse(value: true), inputMethod: .touch, createdAt: 0, updatedAt: 0
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(answer)) as? [String: Any])
        for key in ["inkAnnotationId", "verdict", "feedback", "correctedBy", "rereadRef"] {
            XCTAssertTrue(object[key] is NSNull, "« \(key) »")
        }

        let child = ChildProfile(
            id: "c1", parentId: "p1", nickname: "Léa", avatar: "🦊", readingLevel: .intermediaire,
            explanationDifficulty: .simple, reading: .standard, tts: .standard, exercises: .standard,
            createdAt: 0, updatedAt: 0
        )
        let childObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(child)) as? [String: Any]
        )
        XCTAssertTrue(childObject["deletedAt"] is NSNull)
    }
}
