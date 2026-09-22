import CarnetKit
import SwiftUI

/// Signing out, and deciding what stays on the iPad (§20, §28).
///
/// A sheet rather than the usual confirmation dialog, because there is a choice to make inside it and a dialog holds
/// buttons only. The choice is not a detail: leaving the books on a device is the difference between a family's own
/// iPad and one that goes back to a classroom cupboard this afternoon.
///
/// Erasing is the default, and the adult who wants otherwise turns it off — the safe answer should be the one nobody
/// has to think about.
struct SignOutSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// Called once the family is signed out, so the adult area can close behind them.
    let onSignedOut: () -> Void

    @State private var forget = true
    @State private var pending = 0
    @State private var isWorking = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(FR.SignIn.signOutMessage)
                        .font(AppFont.ui(18))
                        .foregroundStyle(Palette.ink)

                    if pending > 0 {
                        Card {
                            Label {
                                Text(FR.SignIn.pendingWarning(pending))
                                    .font(AppFont.ui(16))
                                    .foregroundStyle(Palette.ink)
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Palette.warning)
                            }
                        }
                    }

                    Card {
                        ExplainedToggle(title: FR.SignIn.forgetLabel, hint: FR.SignIn.forgetHint, isOn: $forget)
                    }

                    BigButton(
                        title: isWorking ? FR.SignIn.signOutWorking : FR.SignIn.signOut,
                        icon: "rectangle.portrait.and.arrow.right",
                        kind: .danger,
                        isEnabled: !isWorking
                    ) {
                        Task { await run() }
                    }

                    BigButton(title: FR.Common.cancel, kind: .secondary, isEnabled: !isWorking) { dismiss() }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.SignIn.signOutTitle)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            // What has not reached the server yet. Worth saying before erasing it, and the sign-out sends it first.
            if let known = model.syncStatus?.pending {
                pending = known
            } else if let library = model.services?.library {
                pending = (try? await library.pendingChanges()) ?? 0
            }
        }
        .interactiveDismissDisabled(isWorking)
    }

    private func run() async {
        isWorking = true
        await model.signOut(forgettingThisDevice: forget)
        isWorking = false
        dismiss()
        onSignedOut()
    }
}
