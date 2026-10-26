import SwiftUI

/// The privacy policy, opened in the browser from the server that keeps the data.
///
/// The page lives on the server rather than in the app: it is the address given to App Store Connect, the one the
/// web app shows, and it can be corrected without a new build. Before an address is known there is no server and
/// nothing to link to, so the link is simply absent.
struct PrivacyPolicyLink: View {
    let serverURL: URL?
    var size: CGFloat = 16

    var body: some View {
        if let url = Self.url(on: serverURL) {
            Link(FR.Privacy.link, destination: url)
                .font(AppFont.ui(size))
                .foregroundStyle(Palette.accent)
        }
    }

    static func url(on serverURL: URL?) -> URL? {
        serverURL?.appending(path: "confidentialite")
    }
}
