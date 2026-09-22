import Foundation

/// A device signed into the family's account (« Appareils connectés », §20).
public struct DeviceSession: Decodable, Equatable, Sendable, Identifiable {
    public enum Kind: String, Decodable, Sendable {
        case ipad, iphone, mac, windows, android, linux, other

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .other
        }
    }

    /// A public id — never the session token, nor its hash.
    public let id: String
    public let current: Bool
    public let name: String?
    public let device: Kind
    public let browser: String
    public let ip: String?
    public let createdAt: Millis
    public let lastSeenAt: Millis
}

/// The account's own security: its devices, its password, its code.
extension APIClient {
    private func authSend<Body: Encodable>(_ method: String, _ path: String, _ body: Body?) async throws -> Data {
        let data = try body.map { try JSONEncoder().encode($0) }
        return try await performRaw(
            method: method, path: path, body: data, contentType: data == nil ? nil : "application/json", timeout: 30
        )
    }

    /// `GET /api/auth/sessions`: every device signed in, this one included.
    public func deviceSessions() async throws -> [DeviceSession] {
        struct Answer: Decodable { let sessions: [DeviceSession] }
        let data = try await authSend("GET", "/api/auth/sessions", Optional<String>.none)
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data) else { throw APIError.invalidResponse }
        return answer.sessions
    }

    /// `DELETE /api/auth/sessions/:id`: signs one device out, wherever it is.
    ///
    /// This is what makes a lost iPad harmless: its token stops working on the server, whatever the device itself
    /// still holds.
    public func signOutDevice(id: String) async throws {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        _ = try await authSend("DELETE", "/api/auth/sessions/\(safe)", Optional<String>.none)
    }

    /// `POST /api/auth/sessions/revoke-others`: every device but this one.
    public func signOutOtherDevices() async throws {
        _ = try await authSend("POST", "/api/auth/sessions/revoke-others", Optional<String>.none)
    }

    /// `PUT /api/auth/device`: the name this device shows under in « Appareils connectés ».
    public func setDeviceName(_ name: String) async throws {
        struct Body: Encodable { let name: String }
        let clean = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard !clean.isEmpty else { return }
        _ = try await authSend("PUT", "/api/auth/device", Body(name: clean))
    }

    /// `PUT /api/auth/password`. The current password is asked again: an unlocked iPad left on a table must not be
    /// enough to take over the account.
    public func changePassword(current: String, new: String) async throws {
        struct Body: Encodable { let currentPassword: String; let newPassword: String }
        _ = try await authSend("PUT", "/api/auth/password", Body(currentPassword: current, newPassword: new))
    }

    /// `PUT /api/auth/pin`: the adult code, confirmed with the account password.
    public func changePin(password: String, newPin: String) async throws {
        struct Body: Encodable { let password: String; let newPin: String }
        _ = try await authSend("PUT", "/api/auth/pin", Body(password: password, newPin: newPin))
    }
}
