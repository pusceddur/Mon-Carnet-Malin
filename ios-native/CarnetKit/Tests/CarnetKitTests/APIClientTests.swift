import XCTest
@testable import CarnetKit

/// Holds what the stub should answer and what it was asked. A lock instead of `nonisolated(unsafe)` so the tests build
/// with any Swift from 5.9 on, including the toolchain on a machine that is not a Mac.
final class StubState: @unchecked Sendable {
    static let shared = StubState()

    private let lock = NSLock()
    private var status = 200
    private var body = Data()
    private var request: URLRequest?

    func answer(_ json: String, status: Int = 200) {
        lock.lock()
        defer { lock.unlock() }
        self.status = status
        self.body = Data(json.utf8)
        self.request = nil
    }

    func take() -> (status: Int, body: Data) {
        lock.lock()
        defer { lock.unlock() }
        return (status, body)
    }

    func record(_ request: URLRequest) {
        lock.lock()
        defer { lock.unlock() }
        self.request = request
    }

    var lastRequest: URLRequest? {
        lock.lock()
        defer { lock.unlock() }
        return request
    }
}

/// Answers a canned response instead of going to the network, and keeps the request so the test can look at it.
final class StubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubState.shared.record(request)
        let answer = StubState.shared.take()
        let response = HTTPURLResponse(
            url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// The exact shape the server sends, so a rename on either side fails here instead of on the device.
enum Payloads {
    static func authStatus(token: String? = nil) -> String {
        let session = token.map { "\"sessionToken\":\"\($0)\"," } ?? ""
        return """
        {"setupRequired":false,"authenticated":true,
         "parent":{"id":"p1","email":"parent@example.fr","displayName":"Maman","createdAt":1750000000000,"isOwner":true},
         "parentUnlockedUntil":null,"pinSet":true,"pinLockedUntil":null,"registrationOpen":false,
         "pinRequired":true,"passwordResetAvailable":false,\(session)"aiReading":true}
        """
    }

    static let signedOut = """
    {"setupRequired":false,"authenticated":false,"parent":null,"parentUnlockedUntil":null,"pinSet":false,
     "pinLockedUntil":null,"registrationOpen":true,"pinRequired":true,"passwordResetAvailable":false,"aiReading":false}
    """

    static let children = """
    [{"id":"c1","parentId":"p1","nickname":"Léa","avatar":"🦊",
      "readingLevel":"intermediaire","explanationDifficulty":"tres_simple",
      "reading":{"font":"lexend","fontSizePx":24,"lineHeight":1.8,"letterSpacingEm":0.04,"wordSpacingEm":0.16,
                 "columnWidthEm":30,"theme":"creme","layoutMode":"page","sentenceHighlight":true,"readingGuide":false,
                 "aids":{"syllables":true,"silentLetters":false,"sounds":false,"changedLetters":false,"liaisons":false}},
      "tts":{"rate":0.85,"pitch":1,"sentencePauseMs":250,"paragraphPauseMs":700},
      "exercises":{"defaultQuestionCount":5,"enabledTypes":["qcm","vrai_faux","reponse_libre","association","ordre"]},
      "createdAt":1750000000000,"updatedAt":1750000001000,"deletedAt":null}]
    """
}

final class APIClientTests: XCTestCase {
    private var client: APIClient!
    private var tokens: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        tokens = InMemoryTokenStore()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        client = APIClient(
            // The trailing slash must not produce a double one in the path.
            baseURL: URL(string: "https://example.test/")!,
            tokens: tokens,
            session: URLSession(configuration: configuration)
        )
        StubState.shared.answer("{}")
    }

    func testLogInKeepsTheTokenAndSendsTheNativeHeaders() async throws {
        StubState.shared.answer(Payloads.authStatus(token: "tok-123"))

        let status = try await client.logIn(email: "parent@example.fr", password: "secret-passphrase")

        XCTAssertTrue(status.authenticated)
        XCTAssertEqual(status.parent?.displayName, "Maman")
        XCTAssertEqual(tokens.read(), "tok-123")

        let request = try XCTUnwrap(StubState.shared.lastRequest)
        XCTAssertEqual(request.url?.absoluteString, "https://example.test/api/auth/login")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Aide-Client"), "native")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Requested-With"), "aide")
    }

    func testTheTokenIsSentOnEveryLaterRequest() async throws {
        tokens.write("tok-123")
        StubState.shared.answer(Payloads.children)

        let children = try await client.children()

        XCTAssertEqual(children.count, 1)
        XCTAssertEqual(children[0].nickname, "Léa")
        XCTAssertEqual(children[0].explanationDifficulty, .tresSimple)
        XCTAssertTrue(children[0].reading.aids.syllables)
        XCTAssertFalse(children[0].isDeleted)
        XCTAssertEqual(children[0].exercises.enabledTypes.count, 5)

        let request = try XCTUnwrap(StubState.shared.lastRequest)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok-123")
    }

    func testARefusedSessionThrowsTheServerCodeAndForgetsTheToken() async throws {
        tokens.write("stale")
        StubState.shared.answer(#"{"error":{"code":"not_authenticated","message":"Tu dois te connecter."}}"#, status: 401)

        do {
            _ = try await client.children()
            XCTFail("a refused session must throw")
        } catch let error as APIError {
            XCTAssertEqual(error, .api(status: 401, code: "not_authenticated", message: "Tu dois te connecter."))
            XCTAssertTrue(error.isAuthenticationFailure)
        }
        XCTAssertNil(tokens.read(), "a token the server refuses is worth nothing")
    }

    func testAStatusThatSaysSignedOutDropsTheToken() async throws {
        tokens.write("tok-123")
        StubState.shared.answer(Payloads.signedOut)

        let status = try await client.status()

        XCTAssertFalse(status.authenticated)
        XCTAssertNil(status.parent)
        XCTAssertNil(tokens.read())
    }

    func testSigningOutForgetsTheTokenEvenWhenTheServerRefuses() async throws {
        tokens.write("tok-123")
        StubState.shared.answer(#"{"error":{"code":"parent_locked","message":"Les réglages sont verrouillés."}}"#, status: 403)

        do {
            try await client.logOut()
            XCTFail("the server refused, so this must throw")
        } catch {
            // The interface decides what to show; the token is gone either way.
        }
        XCTAssertNil(tokens.read())
    }

    func testTheUnlockedAdultAreaIsReadFromItsDeadline() throws {
        let json = Payloads.authStatus().replacingOccurrences(of: "\"parentUnlockedUntil\":null", with: "\"parentUnlockedUntil\":1750000600000")
        let status = try JSONDecoder().decode(AuthStatus.self, from: Data(json.utf8))

        XCTAssertTrue(status.isParentUnlocked(now: 1_750_000_500_000))
        XCTAssertFalse(status.isParentUnlocked(now: 1_750_000_700_000))
    }
}
