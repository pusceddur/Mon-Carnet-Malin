import CarnetKit
import SwiftUI

/// Signing in: first the address of the family's own server, then the account.
///
/// Two steps because this app does not talk to a service — it talks to a server the family runs, at an address only
/// they know. There is nothing to sign in to before that address exists.
struct SignInView: View {
    @EnvironmentObject private var model: AppModel

    @State private var address = ""
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var message: String?
    @State private var creating: AccountForm.Mode?
    @State private var showingReset = false
    @FocusState private var focus: Field?

    private enum Field { case address, email, password }

    private var hasServer: Bool { model.services != nil }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "book.closed.fill")
                        .font(AppFont.ui(52))
                        .foregroundStyle(Palette.accent)
                    Text(FR.SignIn.title).font(AppFont.title(34)).foregroundStyle(Palette.ink)
                    Text(FR.SignIn.lead).font(AppFont.ui(18)).foregroundStyle(Palette.muted)
                }
                .padding(.top, 48)

                if hasServer { accountForm } else { serverForm }

                if let message {
                    Text(message)
                        .font(AppFont.ui(17))
                        .foregroundStyle(Palette.warning)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, 60)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(item: $creating) { mode in AccountCreationView(mode: mode) }
        .sheet(isPresented: $showingReset) { ForgotPasswordView(email: email) }
        .task {
            // The address the family used last, so it only has to be typed once on this iPad.
            if let services = model.services { address = services.serverURL.absoluteString }
        }
    }

    private var serverForm: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Text(FR.SignIn.serverTitle).font(AppFont.ui(20, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(FR.SignIn.serverHint).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
                TextField("https://…", text: $address)
                    .textFieldStyle(.plain)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(AppFont.ui(19))
                    .padding(14)
                    .background(Palette.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .focused($focus, equals: .address)
                    .submitLabel(.go)
                    .onSubmit(useServer)
                BigButton(title: FR.Common.proceed, icon: "arrow.right", isEnabled: !address.isEmpty) {
                    useServer()
                }
            }
        }
        .frame(maxWidth: 480)
    }

    private var accountForm: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                field(FR.SignIn.email, text: $email, field: .email, secure: false)
                field(FR.SignIn.password, text: $password, field: .password, secure: true)

                BigButton(
                    title: isWorking ? FR.SignIn.working : FR.SignIn.submit,
                    icon: "lock.open",
                    isEnabled: !isWorking && !email.isEmpty && !password.isEmpty
                ) {
                    Task { await signIn() }
                }

                if model.status?.passwordResetAvailable == true {
                    Button(FR.SignIn.forgotPassword) { showingReset = true }
                        .font(AppFont.ui(16))
                        .foregroundStyle(Palette.accent)
                }
                // A family invited to a server that is already running makes its account here, on the iPad.
                //
                // The very first account of a new server does not: it is made in a browser, at « /installation », by
                // whoever set the server up and holds its installation code. The web login page stopped offering
                // that step on 2026-09-17 and this screen does the same — whoever is installing a server is sitting
                // at a computer, and a family meeting this iPad is better told what is missing than handed a form
                // asking for a code they have never seen.
                if model.status?.setupRequired == true {
                    Text(FR.SignIn.setupRequired)
                        .font(AppFont.ui(16))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                } else if model.status?.registrationOpen == true {
                    Button(FR.SignIn.createAccount) { creating = .register }
                        .font(AppFont.ui(16, weight: .medium))
                        .foregroundStyle(Palette.accent)
                }

                Button(FR.SignIn.serverTitle) {
                    // Back a step: the address was wrong, or the family moved their server.
                    model.banner = nil
                    message = nil
                    Task { await forgetServer() }
                }
                .font(AppFont.ui(16))
                .foregroundStyle(Palette.muted)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: 480)
    }

    @ViewBuilder
    private func field(_ title: String, text: Binding<String>, field: Field, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
            Group {
                if secure {
                    SecureField("", text: text).textContentType(.password)
                } else {
                    TextField("", text: text)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .textFieldStyle(.plain)
            .font(AppFont.ui(19))
            .padding(14)
            .background(Palette.paper)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .focused($focus, equals: field)
            .submitLabel(secure ? .go : .next)
            .onSubmit {
                if secure { Task { await signIn() } } else { focus = .password }
            }
        }
    }

    private func useServer() {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        // A family told « https:// » by whoever set the server up will type it without; adding it is not a guess,
        // it is the only scheme this app will use.
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme), url.host != nil, url.scheme == "https" || url.scheme == "http" else {
            message = FR.SignIn.serverInvalid
            return
        }
        message = nil
        focus = .email
        Task { await model.connect(serverURL: url) }
    }

    private func forgetServer() async {
        guard let services = model.services else { return }
        try? await services.library.setValue(nil, forKey: AppKeys.serverURL)
        // The app has to be started again to pick up a different address; saying so is better than pretending.
        message = FR.SignIn.serverHint
        address = services.serverURL.absoluteString
    }

    private func signIn() async {
        guard !isWorking else { return }
        isWorking = true
        message = nil
        defer { isWorking = false }

        do {
            try await model.signIn(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            password = ""
        } catch let error as APIError {
            message = Self.message(for: error)
        } catch {
            message = FR.Common.genericError
        }
    }

    /// What to say about a refused sign-in.
    ///
    /// Never « e-mail inconnu » or « mot de passe incorrect » separately: which of the two was wrong is exactly what
    /// someone guessing at an account wants to be told, and it helps the family not at all.
    private static func message(for error: APIError) -> String {
        switch error {
        case .offline, .timedOut:
            return FR.SignIn.offline
        case let .api(status, code, message):
            if code == "setup_required" { return FR.SignIn.setupRequired }
            if status == 429 || code == "locked" { return FR.SignIn.locked }
            if status == 401 || status == 400 { return FR.SignIn.wrongDetails }
            return message.isEmpty ? FR.Common.genericError : message
        case .notAuthenticated:
            return FR.SignIn.wrongDetails
        case .invalidResponse:
            return FR.Common.genericError
        }
    }
}
