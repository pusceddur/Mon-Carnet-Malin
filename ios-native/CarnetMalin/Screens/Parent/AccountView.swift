import CarnetKit
import SwiftUI

/// « Le compte »: the devices signed in, the password, the adult code.
struct AccountView: View {
    @EnvironmentObject private var model: AppModel

    @State private var devices: [DeviceSession] = []
    @State private var message: String?
    @State private var confirmingOthers = false

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var pinPassword = ""
    @State private var newPin = ""

    /// §20 the change being confirmed: the new value, or nil when nothing is being changed.
    @State private var askingPin: Bool?
    @State private var pinRequiredPassword = ""
    @State private var isChangingPinRequired = false

    private var pinRequired: Bool { model.status?.pinRequired != false }

    var body: some View {
        Form {
            Section {
                ForEach(devices) { device in
                    HStack(spacing: 12) {
                        Image(systemName: icon(device.device)).foregroundStyle(Palette.accent).frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.name ?? device.browser).font(AppFont.ui(17, weight: .medium))
                            Text(lastSeen(device)).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        if device.current {
                            Text("Cet appareil").font(AppFont.ui(13, weight: .semibold)).foregroundStyle(Palette.success)
                        } else {
                            Button("Déconnecter", role: .destructive) { Task { await signOut(device) } }
                                .font(AppFont.ui(15))
                        }
                    }
                }
                if devices.contains(where: { !$0.current }) {
                    Button("Déconnecter tous les autres appareils", role: .destructive) { confirmingOthers = true }
                }
            } header: {
                Text(FR.Parent.devices)
            } footer: {
                // What this is for, said once: a lost or sold iPad stops opening the family's books.
                Text("Un appareil perdu ou prêté ? Déconnectez-le ici : il ne pourra plus ouvrir vos livres.")
            }

            Section {
                Toggle(isOn: Binding(
                    get: { askingPin ?? pinRequired },
                    set: { next in
                        pinRequiredPassword = ""
                        askingPin = next == pinRequired ? nil : next
                    }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(FR.PinRequired.label).font(AppFont.ui(17))
                        Text(pinRequired ? FR.PinRequired.hintOn : FR.PinRequired.hintOff)
                            .font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                }
                .tint(Palette.accent)
                .disabled(isChangingPinRequired)
                if let askingPin {
                    Text(askingPin ? FR.PinRequired.askOn : FR.PinRequired.askOff)
                        .font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                    SecureField(FR.PinRequired.password, text: $pinRequiredPassword).textContentType(.password)
                    HStack {
                        Button(FR.PinRequired.confirm) { Task { await changePinRequired(askingPin) } }
                            .disabled(pinRequiredPassword.isEmpty || isChangingPinRequired)
                        Spacer()
                        Button(FR.Common.cancel) { self.askingPin = nil }
                            .foregroundStyle(Palette.muted)
                    }
                    .buttonStyle(.borderless)
                }
            } header: {
                Text(FR.PinRequired.title)
            }

            Section("Mot de passe") {
                SecureField("Mot de passe actuel", text: $currentPassword).textContentType(.password)
                SecureField("Nouveau mot de passe (10 caractères au moins)", text: $newPassword)
                    .textContentType(.newPassword)
                Button("Changer le mot de passe") { Task { await changePassword() } }
                    .disabled(currentPassword.isEmpty || newPassword.count < 10)
            }

            Section("Code de l’espace des adultes") {
                SecureField("Mot de passe du compte", text: $pinPassword).textContentType(.password)
                SecureField("Nouveau code (4 à 8 chiffres)", text: $newPin)
                    .keyboardType(.numberPad)
                    .onChange(of: newPin) { _, value in newPin = String(value.filter(\.isNumber).prefix(8)) }
                Button("Changer le code") { Task { await changePin() } }
                    .disabled(pinPassword.isEmpty || newPin.count < 4)
            }

            if let message {
                Section { Text(message).foregroundStyle(Palette.accent) }
            }
        }
        .font(AppFont.ui(17))
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(FR.Parent.account)
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .confirmationDialog(
            "Déconnecter tous les autres appareils ?", isPresented: $confirmingOthers, titleVisibility: .visible
        ) {
            Button("Déconnecter", role: .destructive) { Task { await signOutOthers() } }
            Button(FR.Common.cancel, role: .cancel) {}
        }
    }

    private func icon(_ kind: DeviceSession.Kind) -> String {
        switch kind {
        case .ipad: return "ipad"
        case .iphone: return "iphone"
        case .mac: return "laptopcomputer"
        case .windows, .linux: return "desktopcomputer"
        case .android: return "candybarphone"
        case .other: return "questionmark.circle"
        }
    }

    private func lastSeen(_ device: DeviceSession) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        let when = formatter.localizedString(
            for: Date(timeIntervalSince1970: Double(device.lastSeenAt) / 1000), relativeTo: Date()
        )
        return FR.format("Vu {when}", ["when": when])
    }

    private func reload() async {
        guard let api = model.services?.api else { return }
        do {
            devices = try await api.deviceSessions().sorted { ($0.current ? 1 : 0, $0.lastSeenAt) > ($1.current ? 1 : 0, $1.lastSeenAt) }
        } catch {
            message = Self.explain(error)
        }
    }

    private func signOut(_ device: DeviceSession) async {
        guard let api = model.services?.api else { return }
        do {
            try await api.signOutDevice(id: device.id)
            await reload()
        } catch {
            message = Self.explain(error)
        }
    }

    private func signOutOthers() async {
        guard let api = model.services?.api else { return }
        do {
            try await api.signOutOtherDevices()
            await reload()
        } catch {
            message = Self.explain(error)
        }
    }

    private func changePassword() async {
        guard let api = model.services?.api else { return }
        do {
            try await api.changePassword(current: currentPassword, new: newPassword)
            currentPassword = ""
            newPassword = ""
            message = "Mot de passe changé."
        } catch {
            message = Self.explain(error)
        }
    }

    private func changePin() async {
        guard let api = model.services?.api else { return }
        do {
            try await api.changePin(password: pinPassword, newPin: newPin)
            pinPassword = ""
            newPin = ""
            message = "Code changé."
        } catch {
            message = Self.explain(error)
        }
    }

    private func changePinRequired(_ required: Bool) async {
        guard let api = model.services?.api else { return }
        isChangingPinRequired = true
        defer { isChangingPinRequired = false }
        do {
            let status = try await api.setPinRequired(required, password: pinRequiredPassword)
            model.update(status: status)
            askingPin = nil
            pinRequiredPassword = ""
            message = required ? FR.PinRequired.doneOn : FR.PinRequired.doneOff
        } catch {
            message = Self.explain(error)
        }
    }

    private static func explain(_ error: Error) -> String {
        if case let APIError.api(_, code, message) = error {
            if code == "parent_locked" { return FR.Documents.parentLocked }
            if !message.isEmpty { return message }
        }
        return FR.Errors.message(for: error)
    }
}
