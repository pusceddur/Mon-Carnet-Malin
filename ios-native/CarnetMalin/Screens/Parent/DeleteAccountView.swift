import CarnetKit
import SwiftUI

/// §30 « Supprimer le compte »: the family leaves the server for good.
///
/// Apple asks an app that lets people create an account to let them delete it from the app itself (guideline
/// 5.1.1(v)); the GDPR asks for it wherever the account lives (art. 17). Neither of them asks for a screen that
/// hides what it does, so this one says it plainly, in order: what disappears, that it cannot be undone, and only
/// then the password.
///
/// Immediate and final. No grace period to explain, nothing left disabled in a corner, and a child's work kept no
/// longer than the moment their parent decided it should go.
struct DeleteAccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var confirming = false
    @State private var isWorking = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(FR.DeleteAccount.intro)
                    .font(AppFont.ui(18)).foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(FR.DeleteAccount.whatGoesTitle, systemImage: "trash")
                            .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.ink)
                        ForEach(FR.DeleteAccount.whatGoes, id: \.self) { line in
                            HStack(alignment: .top, spacing: 8) {
                                Text("•").foregroundStyle(Palette.muted)
                                Text(line).fixedSize(horizontal: false, vertical: true)
                            }
                            .font(AppFont.ui(16)).foregroundStyle(Palette.muted)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(FR.DeleteAccount.subscriptionTitle, systemImage: "creditcard")
                            .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(FR.DeleteAccount.subscription)
                            .font(AppFont.ui(16)).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(FR.DeleteAccount.password)
                        .font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
                    SecureField(FR.SignIn.password, text: $password)
                        .textContentType(.password)
                        .font(AppFont.ui(19))
                        .padding(14)
                        .background(Palette.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                if let message {
                    Text(message)
                        .font(AppFont.ui(17)).foregroundStyle(Palette.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }

                BigButton(
                    title: isWorking ? FR.DeleteAccount.working : FR.DeleteAccount.button,
                    icon: "trash",
                    kind: .danger,
                    isEnabled: !password.isEmpty && !isWorking
                ) {
                    confirming = true
                }
                BigButton(title: FR.Common.cancel, kind: .secondary, isEnabled: !isWorking) { dismiss() }
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.paper)
        .navigationTitle(FR.DeleteAccount.title)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(FR.DeleteAccount.confirmTitle, isPresented: $confirming, titleVisibility: .visible) {
            Button(FR.DeleteAccount.confirm, role: .destructive) { Task { await run() } }
            Button(FR.Common.cancel, role: .cancel) {}
        } message: {
            Text(FR.DeleteAccount.confirmMessage)
        }
        .interactiveDismissDisabled(isWorking)
    }

    private func run() async {
        isWorking = true
        message = nil
        do {
            try await model.deleteAccount(password: password)
            // The model is already back on the sign-in screen; this one goes with the rest of the adult area.
            dismiss()
        } catch {
            message = FR.Errors.message(for: error)
        }
        password = ""
        isWorking = false
    }
}
