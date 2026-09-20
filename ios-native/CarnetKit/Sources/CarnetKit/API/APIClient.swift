import Foundation

/// Where the session token lives between launches. The Keychain implementation belongs to the app; the package only
/// needs something that can hold a string, which also makes the client testable without touching the device.
public protocol TokenStore: AnyObject, Sendable {
    func read() -> String?
    func write(_ token: String?)
}

/// A store that forgets everything when the app closes. Used by the tests, and as a fallback when the Keychain refuses.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(token: String? = nil) {
        self.token = token
    }

    public func read() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    public func write(_ token: String?) {
        lock.lock()
        defer { lock.unlock() }
        self.token = token
    }
}

/// What went wrong with a request. `api` carries the code the server chose, which is what the interface should look at:
/// the message is already written for a child, but the code is what decides the screen.
public enum APIError: Error, Equatable, Sendable {
    /// The server refused, with its own code and message.
    case api(status: Int, code: String, message: String)
    /// The session is gone: the app has to ask for the password again.
    case notAuthenticated
    /// No network, or the server could not be reached.
    case offline
    case timedOut
    /// The answer was not what this version of the app knows how to read.
    case invalidResponse

    public var isAuthenticationFailure: Bool {
        switch self {
        case .notAuthenticated: return true
        case let .api(status, _, _): return status == 401
        default: return false
        }
    }
}

/// Client of the API the web app already talks to. Nothing here is specific to the interface: it is the whole contract
/// between the native app and the server.
///
/// Authentication is a bearer token, never a cookie: the app asks for one when a session opens (`X-Aide-Client: native`)
/// and sends it back on every request. That is also why no CSRF header would help and none is needed, though the server
/// still asks for `X-Requested-With` on anything that changes state.
public actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokens: TokenStore
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(baseURL: URL, tokens: TokenStore, session: URLSession = .shared) {
        // A trailing slash would turn every path into a double one, which the server answers with a redirect.
        var address = baseURL.absoluteString
        while address.hasSuffix("/") { address.removeLast() }
        self.baseURL = URL(string: address) ?? baseURL
        self.tokens = tokens
        self.session = session
    }

    /// Absolute URL of an API path. `appendingPathComponent` would escape the slashes of a multi-part path.
    private func url(for path: String) throws -> URL {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw APIError.invalidResponse }
        return url
    }

    /// True when a session token is held; it does not prove the session is still open on the server.
    public var hasSession: Bool {
        tokens.read() != nil
    }

    public func forgetSession() {
        tokens.write(nil)
    }

    // MARK: - Auth

    public func status() async throws -> AuthStatus {
        let status: AuthStatus = try await send(.get, "/api/auth/status")
        if !status.authenticated { tokens.write(nil) }
        return status
    }

    /// Opens a session and keeps its token. The server only hands the token over because of the native marker header.
    @discardableResult
    public func logIn(email: String, password: String) async throws -> AuthStatus {
        let status: AuthStatus = try await send(.post, "/api/auth/login", body: ["email": email, "password": password])
        if let token = status.sessionToken, !token.isEmpty { tokens.write(token) }
        return status
    }

    /// Opens the adult area for a while with the code of the settings.
    @discardableResult
    public func unlockParentArea(pin: String) async throws -> AuthStatus {
        try await send(.post, "/api/auth/unlock", body: ["pin": pin])
    }

    public func lockParentArea() async throws -> AuthStatus {
        try await send(.post, "/api/auth/lock")
    }

    /// Ends the session on the server and forgets the token, whatever the server answers.
    public func logOut() async throws {
        defer { tokens.write(nil) }
        let _: OkResponse = try await send(.post, "/api/auth/logout")
    }

    // MARK: - Children

    public func children() async throws -> [ChildProfile] {
        try await send(.get, "/api/children")
    }

    // MARK: - Transport

    private enum Method: String {
        case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
    }

    private func send<T: Decodable>(_ method: Method, _ path: String, body: [String: String]? = nil) async throws -> T {
        let data = try await perform(method, path, body: body)
        // A route that answers nothing (204) cannot be decoded into anything but Void, which this client never asks for.
        guard !data.isEmpty else { throw APIError.invalidResponse }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    private func perform(_ method: Method, _ path: String, body: [String: String]?) async throws -> Data {
        var request = URLRequest(url: try url(for: path))
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // The server asks for this on anything that changes state; sending it always is simpler and harmless.
        request.setValue("aide", forHTTPHeaderField: "X-Requested-With")
        // Tells the server this client keeps its own session token.
        request.setValue("native", forHTTPHeaderField: "X-Aide-Client")
        if let token = tokens.read() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .timedOut: throw APIError.timedOut
            case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost:
                throw APIError.offline
            default: throw APIError.offline
            }
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            // The session died on the server side: the token is worthless, so it goes.
            if http.statusCode == 401 { tokens.write(nil) }
            if let body = try? decoder.decode(APIErrorBody.self, from: data) {
                throw APIError.api(status: http.statusCode, code: body.error.code, message: body.error.message)
            }
            throw http.statusCode == 401 ? APIError.notAuthenticated : APIError.invalidResponse
        }
        return data
    }
}
