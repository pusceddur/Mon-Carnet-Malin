import CarnetKit
import SwiftUI
import UIKit

/// Creating the family's account on the iPad, with the invitation code given by whoever runs the server. Addressed
/// to the adult.
///
/// It can also make the first account of a brand-new server (`.setup`, with the server's installation code), and the
/// form knows how; nothing in the app opens it that way any more. That step is done in a browser at
/// « /installation », as it is on the web since 2026-09-17: the person installing a server is at a computer, and the
/// code is theirs and not the family's. The mode stays because the route and the checks are a faithful port, and
/// because a server installed from an iPad is a thing that may come back.
struct AccountCreationView: View {
    let mode: AccountForm.Mode

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var form: AccountForm
    /// Problems are shown once the adult tried to send, not while they are still typing.
    @State private var tried = false
    @State private var isWorking = false
    @State private var message: String?

    init(mode: AccountForm.Mode) {
        self.mode = mode
        _form = State(initialValue: AccountForm(mode: mode))
    }

    private var problems: [AccountForm.Field: String] { tried ? form.problems : [:] }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(mode == .setup ? FR.Account.setupIntro : FR.Account.registerIntro)
                        .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                }

                Section {
                    field(
                        mode == .setup ? FR.Account.setupCode : FR.Account.inviteCode, $form.code, .code,
                        hint: mode == .setup ? FR.Account.setupCodeHint : FR.Account.inviteCodeHint,
                        capitalization: .characters
                    )
                }

                Section {
                    field(FR.Account.name, $form.displayName, .displayName, content: .givenName)
                    field(FR.Account.email, $form.email, .email, content: .emailAddress, keyboard: .emailAddress)
                }

                Section {
                    secure(FR.Account.password, $form.password, .password, hint: FR.Account.passwordHint)
                    secure(FR.Account.passwordConfirm, $form.passwordConfirm, .passwordConfirm)
                }

                Section {
                    secure(FR.Account.pin, $form.pin, .pin, hint: FR.Account.pinHint, digits: true)
                    secure(FR.Account.pinConfirm, $form.pinConfirm, .pinConfirm, digits: true)
                    if let warning = form.pinWarning {
                        Text(warning).font(AppFont.ui(13)).foregroundStyle(Palette.warning)
                    }
                }

                if let message {
                    Section { Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.warning) }
                }

                Section {
                    BigButton(
                        title: isWorking ? FR.Account.working : FR.Account.submit, icon: "person.badge.plus",
                        isEnabled: !isWorking
                    ) { Task { await submit() } }
                }
                .listRowBackground(Color.clear)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.paper)
            .navigationTitle(mode == .setup ? FR.Account.setupTitle : FR.Account.registerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FR.Common.cancel) { dismiss() }.disabled(isWorking)
                }
            }
        }
    }

    private func field(
        _ title: String, _ text: Binding<String>, _ key: AccountForm.Field, hint: String? = nil,
        content: UITextContentType? = nil, keyboard: UIKeyboardType = .default,
        capitalization: TextInputAutocapitalization = .never
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(title, text: text)
                .textContentType(content)
                .keyboardType(keyboard)
                .textInputAutocapitalization(key == .displayName ? .words : capitalization)
                .autocorrectionDisabled()
                .font(AppFont.ui(18))
            footnote(hint: hint, problem: problems[key])
        }
    }

    private func secure(
        _ title: String, _ text: Binding<String>, _ key: AccountForm.Field, hint: String? = nil, digits: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SecureField(title, text: text)
                // No content type for the code: it is not a password to generate, nor a code from a text message.
                .textContentType(digits ? nil : .newPassword)
                .keyboardType(digits ? .numberPad : .default)
                .font(AppFont.ui(18))
                .onChange(of: text.wrappedValue) { _, value in
                    guard digits else { return }
                    let clean = String(value.filter(\.isNumber).prefix(AccountForm.pinMaxDigits))
                    if clean != value { text.wrappedValue = clean }
                }
            footnote(hint: hint, problem: problems[key])
        }
    }

    @ViewBuilder
    private func footnote(hint: String?, problem: String?) -> some View {
        if let problem {
            Text(problem).font(AppFont.ui(13)).foregroundStyle(Palette.warning)
        } else if let hint {
            Text(hint).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
        }
    }

    private func submit() async {
        guard !isWorking else { return }
        tried = true
        message = nil
        guard form.problems.isEmpty else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await model.createAccount(form)
            dismiss()
        } catch APIError.offline, APIError.timedOut {
            message = FR.Account.offline
        } catch let APIError.api(status, code, text) {
            if code == "invalid_invitation" && mode == .register && model.status?.registrationOpen == false {
                message = FR.Account.closed
            } else if status == 429 {
                message = FR.SignIn.locked
            } else {
                message = text.isEmpty ? FR.Common.genericError : text
            }
        } catch {
            message = FR.Common.genericError
        }
    }
}

/// « Mot de passe oublié »: asks for the e-mail link. The rest happens in the browser, on the family's server, where
/// the code of the settings is asked too — an e-mail alone must not be enough to take the account.
struct ForgotPasswordView: View {
    let email: String

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var address = ""
    @State private var sent = false
    @State private var isWorking = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(FR.Account.resetIntro).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                    TextField(FR.Account.resetEmail, text: $address)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(AppFont.ui(18))
                        .disabled(sent)
                }
                if sent {
                    Section { Text(FR.Account.resetSent).font(AppFont.ui(15)).foregroundStyle(Palette.success) }
                } else {
                    if let message {
                        Section { Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.warning) }
                    }
                    Section {
                        BigButton(
                            title: FR.Account.resetSubmit, icon: "envelope",
                            isEnabled: !isWorking && AccountForm.isEmail(address)
                        ) { Task { await submit() } }
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.paper)
            .navigationTitle(FR.Account.resetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? FR.Common.close : FR.Common.cancel) { dismiss() }
                }
            }
        }
        .onAppear { if address.isEmpty { address = email } }
    }

    private func submit() async {
        guard let api = model.services?.api, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            try await api.requestPasswordReset(email: address)
            sent = true
        } catch APIError.offline, APIError.timedOut {
            message = FR.SignIn.offline
        } catch let APIError.api(status, code, _) {
            message = code == "mail_unavailable" ? FR.Account.resetUnavailable
                : status == 429 ? FR.SignIn.locked : FR.Common.genericError
        } catch {
            message = FR.Common.genericError
        }
    }
}
