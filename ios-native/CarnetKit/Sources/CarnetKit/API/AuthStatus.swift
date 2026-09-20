import Foundation

/// What `GET /api/auth/status` answers, and what login, setup and sign-up answer too.
/// `sessionToken` only arrives when the client asked for it with `X-Aide-Client: native`; it is the app's way in,
/// since the app is not same-origin with the server and never receives the session cookie.
public struct AuthStatus: Codable, Equatable, Sendable {
    public let setupRequired: Bool
    public let authenticated: Bool
    public let parent: ParentUser?
    /// End of the unlocked adult area, or nil when it is locked.
    public let parentUnlockedUntil: Millis?
    public let pinSet: Bool
    /// PIN attempts are locked until this time.
    public let pinLockedUntil: Millis?
    /// Accounts can be created with an invitation code.
    public let registrationOpen: Bool
    /// False = the adult area opens without the code (the PIN still exists).
    public let pinRequired: Bool
    /// « Mot de passe oublié » works (e-mails configured on the server).
    public let passwordResetAvailable: Bool
    /// The home computer reads the page images.
    public let aiReading: Bool
    /// Sent once, when a session opens, and only to this app.
    public let sessionToken: String?

    /// True when the adult area is open at `now`.
    public func isParentUnlocked(now: Millis) -> Bool {
        guard let parentUnlockedUntil else { return false }
        return parentUnlockedUntil > now
    }
}

public struct OkResponse: Codable, Sendable {
    public let ok: Bool
}

/// The error body every route answers with: a stable code and a message already written for a child.
public struct APIErrorBody: Codable, Sendable {
    public struct Payload: Codable, Sendable {
        public let code: String
        public let message: String
    }

    public let error: Payload
}
