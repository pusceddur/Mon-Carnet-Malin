import CarnetKit
import SwiftUI

/// The code that stands between the child and the adult settings.
///
/// It is not a security boundary and does not pretend to be one — the server decides what an account may do. It is a
/// door: enough that a nine-year-old does not wander into the import screen or the account page while looking for
/// their book, and not so much that a parent cannot open it one-handed.
struct ParentGateView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var digits = ""
    @State private var message: String?
    @State private var isChecking = false
    @State private var isUnlocked = false

    var body: some View {
        Group {
            if isUnlocked {
                ParentHomeView()
            } else {
                gate
            }
        }
        .task {
            // Already open from a moment ago, or this server does not ask for a code at all.
            let status = model.status
            let now = Millis(Date().timeIntervalSince1970 * 1000)
            if status?.pinRequired == false || status?.isParentUnlocked(now: now) == true {
                isUnlocked = true
            }
        }
    }

    private var gate: some View {
        VStack(spacing: 26) {
            Spacer(minLength: 20)

            VStack(spacing: 8) {
                Image(systemName: "lock.fill").font(AppFont.ui(40)).foregroundStyle(Palette.accent)
                Text(FR.Parent.gateTitle).font(AppFont.title(28)).foregroundStyle(Palette.ink)
                Text(FR.Parent.gateLead).font(AppFont.ui(17)).foregroundStyle(Palette.muted)
            }

            PinPad(digits: $digits, length: 4) { code in
                Task { await unlock(code) }
            }
            .disabled(isChecking)

            if let message {
                Text(message)
                    .font(AppFont.ui(16))
                    .foregroundStyle(Palette.warning)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }

            // The code is changed from a browser, with the account password. Saying where is more use than a
            // « code oublié » button that could not do anything from here.
            DisclosureGroup(FR.Parent.gateForgot) {
                Text(FR.Parent.gateForgotHint)
                    .font(AppFont.ui(15))
                    .foregroundStyle(Palette.muted)
                    .padding(.top, 6)
            }
            .font(AppFont.ui(16))
            .tint(Palette.accent)
            .frame(maxWidth: 360)

            Spacer()
        }
        .padding(Metrics.gutter)
        .frame(maxWidth: .infinity)
        .navigationTitle(FR.Parent.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func unlock(_ code: String) async {
        guard let services = model.services, !isChecking else { return }
        isChecking = true
        message = nil
        defer {
            isChecking = false
            digits = ""
        }

        do {
            let status = try await services.api.unlockParentArea(pin: code)
            let now = Millis(Date().timeIntervalSince1970 * 1000)
            if status.isParentUnlocked(now: now) || !status.pinRequired {
                isUnlocked = true
            } else {
                message = FR.Parent.gateWrong
            }
        } catch let error as APIError {
            switch error {
            case let .api(_, _, serverMessage) where !serverMessage.isEmpty:
                // The server counts the attempts and knows how long the wait is; its own message is the true one.
                message = serverMessage
            case .offline, .timedOut:
                message = FR.Errors.offline
            default:
                message = FR.Parent.gateWrong
            }
        } catch {
            message = FR.Common.genericError
        }
    }
}
