import CarnetKit
import SwiftUI

/// One reader's settings, or a new reader.
///
/// Everything here is named after what it does to the page, never after who it is for. There is no « profil
/// dyslexie », no « mode TDAH »: a child who reads « dyslexie » on their own settings screen learns that the app
/// thinks of them as a diagnosis. « Syllabes en couleurs » tells them what will change, and that is all they need.
///
/// Saved through the server's own routes, not the sync: the sync only carries what a child may change themselves,
/// and a parent's edit sent that way would simply be dropped.
struct ChildSettingsView: View {
    /// Nil for a new reader.
    let child: ChildProfile?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var draft: NewChild
    @State private var isSaving = false
    @State private var message: String?
    @State private var confirmingDelete = false
    @State private var showProblems = false
    /// §31: a reader being created sees three ways to read; an existing one sees them all.
    @State private var allProfiles: Bool

    init(child: ChildProfile?) {
        self.child = child
        _allProfiles = State(initialValue: child != nil)
        if let child {
            _draft = State(initialValue: NewChild(
                nickname: child.nickname, avatar: child.avatar, readingLevel: child.readingLevel,
                explanationDifficulty: child.explanationDifficulty, reading: child.reading, tts: child.tts,
                exercises: child.exercises
            ))
        } else {
            _draft = State(initialValue: NewChild())
        }
    }

    private let avatars = [
        "🦊", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐢", "🐧", "🐨", "🐶", "🐱", "🦉", "🐝", "🚀", "⭐",
    ]

    private var problems: Set<NewChild.Field> { showProblems ? draft.problems : [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                identity
                profiles
                reading
                exercises
                if let message {
                    Text(message).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
                }
                if child != nil { dangerZone }
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.paper)
        .navigationTitle(child == nil ? FR.Parent.addChild : draft.nickname)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? FR.Common.pleaseWait : FR.Common.save) {
                    Task { await save() }
                }
                .font(AppFont.ui(18, weight: .semibold))
                .disabled(isSaving)
            }
        }
        .confirmationDialog(
            FR.Parent.deleteChildConfirm, isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button(FR.Parent.deleteChild, role: .destructive) { Task { await delete() } }
            Button(FR.Common.cancel, role: .cancel) {}
        }
    }

    // MARK: - The form

    private var identity: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(FR.Parent.childName).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            // §32: a nickname, and nothing else. No first name, no age: the app has no use for either, and the
            // keyboard is not told to offer a real one.
            Text(FR.Parent.childNameHint)
                .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            TextField("", text: $draft.nickname)
                .textFieldStyle(.plain)
                .textContentType(.nickname)
                .font(AppFont.ui(20))
                .padding(14)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(problems.contains(.nickname) ? Palette.warning : .clear, lineWidth: 2)
                )

            Text(FR.Parent.childAvatar).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 56))], spacing: 10) {
                ForEach(avatars, id: \.self) { avatar in
                    Button { draft.avatar = avatar } label: {
                        Text(avatar)
                            .font(.system(size: 30))
                            .frame(width: 56, height: 56)
                            .background(draft.avatar == avatar ? Palette.accentSoft : Palette.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// §27: one tap sets everything; each value stays adjustable below, and the profile then shows as personal.
    ///
    /// §31: a reader being created is offered three of them, not five. The other two, and every setting one by one,
    /// are behind « Voir les autres profils » — the first choice should take a moment, not an evening.
    private var profiles: some View {
        let current = ReadingProfile.matching(draft.reading, draft.tts)?.id
        let shown = allProfiles ? ReadingProfile.all : ReadingProfile.all.filter { ReadingProfile.quickStart.contains($0.id) }
        return VStack(alignment: .leading, spacing: 10) {
            Text(FR.Profiles.title).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Text(allProfiles ? FR.Profiles.hint : FR.Profiles.quickHint)
                .font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            ForEach(shown) { profile in
                Button {
                    let (reading, tts) = profile.applied(to: draft.reading, draft.tts)
                    draft.reading = reading
                    draft.tts = tts
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Text(profile.emoji).font(.system(size: 28)).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(FR.Profiles.name(profile.id))
                                .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.ink)
                            Text(FR.Profiles.description(profile.id))
                                .font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                        if current == profile.id {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.accent)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(current == profile.id ? Palette.accentSoft : Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(current == profile.id ? .isSelected : [])
            }
            if !allProfiles {
                Button(FR.Profiles.showAll) { allProfiles = true }
                    .font(AppFont.ui(16, weight: .medium)).foregroundStyle(Palette.accent)
            }
            if current == nil {
                Text(FR.Profiles.custom).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            }
            // §31: said once, where the choice is made. These settings are not decoration.
            Text(FR.Profiles.specialist)
                .font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var reading: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(FR.Parent.readingLevel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Parent.readingLevel, selection: $draft.readingLevel) {
                Text(FR.Parent.readingLevelBeginner).tag(ReadingLevel.debutant)
                Text(FR.Parent.readingLevelIntermediate).tag(ReadingLevel.intermediaire)
                Text(FR.Parent.readingLevelAdvanced).tag(ReadingLevel.avance)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Text(FR.Parent.explanationDifficulty).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Parent.explanationDifficulty, selection: $draft.explanationDifficulty) {
                Text(FR.Parent.explanationVerySimple).tag(ExplanationDifficulty.tresSimple)
                Text(FR.Parent.explanationSimple).tag(ExplanationDifficulty.simple)
                Text(FR.Parent.explanationNormal).tag(ExplanationDifficulty.normal)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Divider()

            Text(FR.Aids.title).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            Text(FR.Aids.hint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            ExplainedToggle(title: FR.Aids.syllables, hint: FR.Aids.syllablesHint, isOn: $draft.reading.aids.syllables)
            ExplainedToggle(
                title: FR.Aids.silentLetters, hint: FR.Aids.silentLettersHint, isOn: $draft.reading.aids.silentLetters
            )
            ExplainedToggle(title: FR.Aids.sounds, hint: FR.Aids.soundsHint, isOn: $draft.reading.aids.sounds)
            ExplainedToggle(
                title: FR.Aids.changedLetters, hint: FR.Aids.changedLettersHint,
                isOn: $draft.reading.aids.changedLetters
            )
            ExplainedToggle(title: FR.Aids.liaisons, hint: FR.Aids.liaisonsHint, isOn: $draft.reading.aids.liaisons)
        }
    }

    private var exercises: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(FR.Exercises.title).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)

            Text(FR.Parent.exerciseCount).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Parent.exerciseCount, selection: $draft.exercises.defaultQuestionCount) {
                Text("3").tag(3)
                Text("5").tag(5)
                Text("10").tag(10)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Text(FR.Parent.exerciseTypes).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            ForEach(QuestionType.allCases, id: \.self) { type in
                Toggle(isOn: Binding(
                    get: { draft.exercises.enabledTypes.contains(type) },
                    set: { isOn in
                        var set = Set(draft.exercises.enabledTypes)
                        if isOn {
                            set.insert(type)
                        } else if set.count > 1 {
                            // Never all of them off: a child with no question types has no exercises at all, and
                            // nothing on their screen would say why.
                            set.remove(type)
                        }
                        draft.exercises.enabledTypes = QuestionType.allCases.filter(set.contains)
                    }
                )) {
                    Text(label(for: type)).font(AppFont.ui(17)).foregroundStyle(Palette.ink)
                }
                .tint(Palette.accent)
            }
        }
    }

    private func label(for type: QuestionType) -> String {
        switch type {
        case .multipleChoice: return FR.Parent.questionTypeMultipleChoice
        case .trueOrFalse: return FR.Parent.questionTypeTrueOrFalse
        case .freeAnswer: return FR.Parent.questionTypeFreeAnswer
        case .matching: return FR.Parent.questionTypeMatching
        case .ordering: return FR.Parent.questionTypeOrdering
        }
    }

    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider().padding(.vertical, 8)
            BigButton(title: FR.Parent.deleteChild, icon: "trash", kind: .secondary) { confirmingDelete = true }
                .padding(.bottom, 40)
        }
    }

    // MARK: - Saving

    private func save() async {
        guard let services = model.services, !isSaving else { return }
        showProblems = true
        guard draft.problems.isEmpty else {
            message = FR.format("Vérifiez : {fields}", ["fields": problemNames(draft.problems)])
            return
        }
        isSaving = true
        message = nil
        defer { isSaving = false }

        do {
            let saved: ChildProfile
            if var existing = child {
                existing.nickname = draft.nickname.trimmingCharacters(in: .whitespacesAndNewlines)
                existing.avatar = draft.avatar
                existing.readingLevel = draft.readingLevel
                existing.explanationDifficulty = draft.explanationDifficulty
                existing.reading = draft.reading
                existing.tts = draft.tts
                existing.exercises = draft.exercises
                saved = try await services.api.updateChild(existing)
            } else {
                saved = try await services.api.createChild(draft)
            }
            try? await services.library.storeFromServer(saved)
            await model.reloadChildren()
            model.update(saved)
            dismiss()
        } catch {
            message = Self.message(for: error)
        }
    }

    private func delete() async {
        guard let services = model.services, let child else { return }
        do {
            try await services.api.deleteChild(id: child.id)
            var gone = child
            gone.deletedAt = Millis(Date().timeIntervalSince1970 * 1000)
            gone.updatedAt = gone.deletedAt ?? gone.updatedAt
            try? await services.library.storeFromServer(gone)
            await model.reloadChildren()
            dismiss()
        } catch {
            message = Self.message(for: error)
        }
    }

    private func problemNames(_ problems: Set<NewChild.Field>) -> String {
        problems.map { field -> String in
            switch field {
            case .nickname: return FR.Parent.childName
            case .avatar: return FR.Parent.childAvatar
            case .questionTypes: return FR.Parent.exerciseTypes
            }
        }
        .sorted()
        .joined(separator: ", ")
    }

    /// These changes need the server: said plainly when it cannot be reached, or when the adult area has closed
    /// in the meantime.
    private static func message(for error: Error) -> String {
        if case let APIError.api(_, code, message) = error {
            if code == "parent_locked" { return "L’espace des adultes s’est refermé. Rouvrez-le pour enregistrer." }
            if !message.isEmpty { return message }
        }
        if case APIError.offline = error { return "Il faut Internet pour enregistrer ce changement." }
        return FR.Errors.message(for: error)
    }
}
