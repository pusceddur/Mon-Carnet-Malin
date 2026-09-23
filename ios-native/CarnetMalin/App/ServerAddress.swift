import Foundation

/// The server the app talks to, decided when the app is built, not by the family.
///
/// A parent opening the app for the first time has no way of knowing what to type in an address field, so the app
/// carries its own: `CarnetServerURL` in the Info.plist, filled from `CARNET_SERVER_URL` in `Support/Server.xcconfig`
/// (never versioned — a private address does not belong in a public repository).
///
/// Without that file the value is empty and the app asks for the address as it used to, which is how a developer
/// points a build at a server on their own machine.
enum ServerAddress {
    /// The address built into this build, or nil when none was given.
    static let builtIn: URL? = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CarnetServerURL") as? String ?? ""
        return parse(raw)
    }()

    /// True when the family never has to see the address at all.
    static var isFixed: Bool { builtIn != nil }

    /// Accepts « https://host », « host » (https is assumed) and, for a server on the same network, « http://host ».
    static func parse(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme), url.host != nil,
              url.scheme == "https" || url.scheme == "http"
        else { return nil }
        return url
    }
}
