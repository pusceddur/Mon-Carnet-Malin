import CarnetKit
import SwiftUI

/// « Options »: what the help may do, how far it may go, and what may leave the iPad.
///
/// Edited as a draft and saved in one go, so a parent can flip several switches and change their mind without each
/// one reaching the child's iPad half-way through.
struct OptionsView: View {
    @EnvironmentObject private var model: AppModel

    @State private var draft: ParentSettings = .standard
    @State private var loaded: ParentSettings?
    @State private var isSaving = false
    @State private var message: String?

    private var hasChanges: Bool { loaded != nil && draft != loaded }

    var body: some View {
        Form {
            Section {
                Text(FR.Options.intro).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                toggle(FR.Options.enabled, FR.Options.enabledHint, $draft.ai.enabled)
            } header: { header(FR.Options.sectionAI) }

            WorkerStatusSection()

            if draft.ai.enabled {
                Section {
                    toggle(FR.Options.explainWord, FR.Options.explainWordHint, $draft.ai.features.explainWord)
                    toggle(FR.Options.explainText, nil, $draft.ai.features.explainText)
                    toggle(FR.Options.simplify, nil, $draft.ai.features.simplify)
                    toggle(FR.Options.summarize, nil, $draft.ai.features.summarize)
                    toggle(FR.Options.questions, nil, $draft.ai.features.questions)
                    toggle(FR.Options.correctAnswers, FR.Options.correctAnswersHint, $draft.ai.features.correctAnswers)
                    toggle(FR.Options.questionOnText, FR.Options.questionOnTextHint, $draft.ai.features.questionOnText)
                    toggle(FR.Options.freeQuestion, FR.Options.freeQuestionHint, $draft.ai.features.freeQuestion)
                    if draft.ai.features.freeQuestion {
                        // What protects a child asking about anything at all, said plainly to the parent who allows it.
                        VStack(alignment: .leading, spacing: 6) {
                            Text(FR.Options.freeQuestionProtectionsTitle).font(AppFont.ui(15, weight: .semibold))
                            ForEach(FR.Options.freeQuestionProtections, id: \.self) { line in
                                Text("• \(line)").font(AppFont.ui(14))
                            }
                        }
                        .foregroundStyle(Palette.muted)
                    }
                    toggle(FR.Options.correctWriting, FR.Options.correctWritingHint, $draft.ai.features.correctWriting)
                } header: { header(FR.Options.sectionFeatures) }

                Section {
                    Stepper(value: $draft.ai.dailyRequestLimitPerChild, in: 0...500, step: 10) {
                        labelled(FR.Options.dailyLimit, FR.Options.requests(draft.ai.dailyRequestLimitPerChild))
                    }
                    Stepper(value: $draft.ai.monthlyBudgetEur, in: 0...200, step: 1) {
                        labelled(FR.Options.monthlyBudget, FR.Activity.euros(draft.ai.monthlyBudgetEur))
                    }
                    Text(FR.Options.monthlyBudgetHint).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    toggle(FR.Options.allowComplex, FR.Options.allowComplexHint, $draft.ai.allowComplexModel)
                    toggle(FR.Options.deepQuestions, FR.Options.deepQuestionsHint, $draft.ai.deepQuestions)
                    toggle(FR.Options.handwriting, FR.Options.handwritingHint, $draft.ai.handwritingRecognition)
                } header: { header(FR.Options.sectionLimits) }

                Section {
                    Picker(FR.Options.safetyLevel, selection: $draft.safety.level) {
                        Text(FR.Options.safetyStandard).tag(ParentSettings.SafetyLevel.standard)
                        Text(FR.Options.safetyStrict).tag(ParentSettings.SafetyLevel.strict)
                    }
                    .pickerStyle(.segmented)
                    Text(FR.Options.safetyHint).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                } header: { header(FR.Options.sectionSafety) }
            }

            Section {
                toggle(FR.Options.freeSelection, FR.Options.freeSelectionHint, $draft.reader.freeSelection)
            } header: { header(FR.Options.sectionReader) }

            Section {
                toggle(FR.Options.aiTranscription, FR.Options.aiTranscriptionHint, $draft.ocr.aiTranscription)
                if draft.ocr.aiTranscription && !(draft.privacy.uploadPageImages && draft.privacy.syncDocumentText) {
                    // The two settings it depends on, named, rather than a silent switch that does nothing.
                    Text(FR.Options.aiTranscriptionNeeds).font(AppFont.ui(14)).foregroundStyle(Palette.warning)
                }
            } header: { header(FR.Options.sectionOCR) }

            Section {
                toggle(FR.Options.syncAnnotations, FR.Options.syncAnnotationsHint, $draft.privacy.syncAnnotations)
                toggle(FR.Options.syncDocumentText, FR.Options.syncDocumentTextHint, $draft.privacy.syncDocumentText)
                toggle(FR.Options.uploadPageImages, FR.Options.uploadPageImagesHint, $draft.privacy.uploadPageImages)
                toggle(FR.Options.uploadOriginals, FR.Options.uploadOriginalsHint, $draft.privacy.uploadOriginals)
            } header: { header(FR.Options.sectionPrivacy) }

            if let message {
                Section { Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.accent) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(FR.Options.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? FR.Common.pleaseWait : FR.Common.save) { Task { await save() } }
                    .font(AppFont.ui(18, weight: .semibold))
                    .disabled(!hasChanges || isSaving)
            }
        }
        .task { await load() }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(AppFont.ui(15, weight: .semibold))
    }

    private func toggle(_ title: String, _ hint: String?, _ value: Binding<Bool>) -> some View {
        ExplainedToggle(title: title, hint: hint, isOn: value)
    }

    private func labelled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(AppFont.ui(17))
            Spacer()
            Text(value).font(AppFont.ui(16)).foregroundStyle(Palette.muted).monospacedDigit()
        }
    }

    private func load() async {
        await model.refreshSettings()
        draft = model.settings
        loaded = model.settings
    }

    private func save() async {
        guard let api = model.services?.api else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await api.saveSettings(draft)
            model.update(saved)
            await model.refreshSettings()
            draft = saved
            loaded = saved
            message = FR.Options.saved
        } catch {
            if case let APIError.api(_, code, _) = error, code == "parent_locked" {
                message = FR.Documents.parentLocked
            } else if case APIError.offline = error {
                message = FR.Documents.needsConnection
            } else {
                message = FR.Errors.message(for: error)
            }
        }
    }
}
