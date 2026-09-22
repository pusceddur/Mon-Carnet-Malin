import Foundation

/// Creating the family's account: the first installation of a server (`setup`, with the code set on the server) or
/// joining one with an invitation code (`register`). Ported from `client/src/features/auth/authForms.ts`.
///
/// Checked here before anything is sent, with the server's own limits, so a parent sees what to fix next to the field
/// instead of a refusal after the round trip.
public struct AccountForm: Equatable, Sendable {
    public enum Mode: Sendable {
        /// First account of a new server: `POST /api/auth/setup`, with the code defined on the server.
        case setup
        /// `POST /api/auth/register`, with the code given by whoever runs the server.
        case register
    }

    public enum Field: String, CaseIterable, Sendable {
        case code, displayName, email, password, passwordConfirm, pin, pinConfirm
    }

    public static let passwordMinChars = 10
    public static let passwordMaxChars = 200
    public static let pinMinDigits = 4
    public static let pinDefaultDigits = 6
    public static let pinMaxDigits = 8
    public static let inviteCodeMinChars = 8
    public static let inviteCodeMaxChars = 64
    public static let displayNameMaxChars = 80

    public var mode: Mode
    /// The setup code or the invitation code, depending on `mode`.
    public var code = ""
    public var displayName = ""
    public var email = ""
    public var password = ""
    public var passwordConfirm = ""
    public var pin = ""
    public var pinConfirm = ""

    public init(mode: Mode) {
        self.mode = mode
    }

    /// What to fix, next to each field. Empty when the form can be sent.
    public var problems: [Field: String] {
        var found: [Field: String] = [:]

        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        switch mode {
        case .setup:
            if code.isEmpty { found[.code] = Messages.required }
        case .register:
            if code.isEmpty {
                found[.code] = Messages.required
            } else if !Self.isInviteCode(code) {
                found[.code] = Messages.inviteCodeFormat
            }
        }

        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            found[.displayName] = Messages.required
        } else if name.utf16.count > Self.displayNameMaxChars {
            found[.displayName] = Messages.tooLong(Self.displayNameMaxChars)
        }

        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty {
            found[.email] = Messages.required
        } else if !Self.isEmail(address) {
            found[.email] = Messages.email
        }

        if let problem = Self.passwordProblem(password) {
            found[.password] = problem
        } else if passwordConfirm != password {
            found[.passwordConfirm] = Messages.passwordMismatch
        }

        if !Self.isPin(pin) {
            found[.pin] = Messages.pinFormat
        } else if pinConfirm != pin {
            found[.pinConfirm] = Messages.pinMismatch
        }
        return found
    }

    /// A valid code shorter than the recommended length: said, not refused.
    public var pinWarning: String? {
        Self.isPin(pin) && pin.count < Self.pinDefaultDigits ? Messages.pinShort : nil
    }

    /// The body the server expects: trimmed, the address in lower case.
    public var body: [String: String] {
        var body = [
            "displayName": displayName.trimmingCharacters(in: .whitespacesAndNewlines),
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            "password": password,
            "pin": pin,
        ]
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        switch mode {
        case .setup: body["setupToken"] = code
        case .register: body["inviteCode"] = code
        }
        return body
    }

    public static func isEmail(_ value: String) -> Bool {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf16.count <= 254, !value.contains(where: \.isWhitespace) else { return false }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
    }

    public static func isPin(_ value: String) -> Bool {
        (pinMinDigits...pinMaxDigits).contains(value.count) && value.allSatisfy { ("0"..."9").contains($0) }
    }

    public static func isInviteCode(_ value: String) -> Bool {
        (inviteCodeMinChars...inviteCodeMaxChars).contains(value.count)
            && value.unicodeScalars.allSatisfy { scalar in
                scalar == "-" || ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
                    || ("0"..."9").contains(scalar)
            }
    }

    public static func passwordProblem(_ value: String) -> String? {
        // UTF-16 units, like the server's `min()` and `max()`.
        let length = value.utf16.count
        if length < passwordMinChars { return Messages.passwordLength }
        if length > passwordMaxChars { return Messages.tooLong(passwordMaxChars) }
        return nil
    }

    public enum Messages {
        public static let required = "Ce champ est obligatoire."
        public static let email = "Adresse e-mail non valide."
        public static let passwordLength = "Au moins \(AccountForm.passwordMinChars) caractères."
        public static let passwordMismatch = "Les mots de passe ne sont pas identiques."
        public static let pinFormat = "Entre \(AccountForm.pinMinDigits) et \(AccountForm.pinMaxDigits) chiffres."
        public static let pinMismatch = "Les codes ne sont pas identiques."
        public static let pinShort = "Un code à \(AccountForm.pinDefaultDigits) chiffres est plus sûr."
        public static let inviteCodeFormat =
            "De \(AccountForm.inviteCodeMinChars) à \(AccountForm.inviteCodeMaxChars) lettres, chiffres ou tirets."
        public static func tooLong(_ max: Int) -> String { "\(max) caractères maximum." }
    }
}
