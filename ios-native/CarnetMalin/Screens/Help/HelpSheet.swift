import CarnetKit
import SwiftUI

/// What the child picked out of the page, and where it sits.
struct HelpContext: Equatable {
    let document: DocumentMeta
    let pageIndex: Int
    /// The word or passage chosen.
    let text: String
    let isSingleWord: Bool
    /// The sentence around it, which is what gives a word its meaning.
    let sentence: String
    let paragraph: String
    let ocrLowConfidence: Bool

    var documentHash: String? { document.sourceHash.isEmpty ? nil : document.sourceHash }
}

/// The four kinds of help a child can ask for from the page.
enum HelpKind: String, Identifiable {
    case definition, explain, simplify, question

    var id: String { rawValue }

    var operation: AIOperation {
        switch self {
        case .definition: return .explainWord
        case .explain: return .explainText
        case .simplify: return .simplifyText
        case .question: return .questionOnText
        }
    }

    var title: String {
        switch self {
        case .definition: return FR.Help.definitionTitle
        case .explain: return FR.Help.explainTitle
        case .simplify: return FR.Help.simplifyTitle
        case .question: return FR.Help.questionTitle
        }
    }

    var icon: String {
        switch self {
        case .definition: return "book"
        case .explain: return "lightbulb"
        case .simplify: return "sparkles"
        case .question: return "questionmark.bubble"
        }
    }

    var loading: String {
        switch self {
        case .definition: return FR.Help.definitionLoading
        case .explain: return FR.Help.explainLoading
        case .simplify: return FR.Help.simplifyLoading
        case .question: return FR.Help.questionLoading
        }
    }
}

/// What came back, in the shape the sheet shows it.
enum HelpOutcome: Equatable {
    case explanation(text: String, example: String?, sourceWarning: Bool)
    case simplified(text: String, sourceWarning: Bool)
    case answer(text: String, refs: [SourceRef], sourceWarning: Bool)
    case message(text: String, tone: Tone, canRetry: Bool)

    enum Tone { case info, warning, adult }

    /// The sentence to read out loud with « Écouter ».
    var spokenText: String {
        switch self {
        case let .explanation(text, example, _):
            return [text, example.map { "\(FR.Help.example) : \($0)" }].compactMap { $0 }.joined(separator: " ")
        case let .simplified(text, _), let .answer(text, _, _), let .message(text, _, _):
            return text
        }
    }

    /// Anything the help could not answer becomes a message the child can read.
    static func message<T>(for result: AIResult<T>) -> HelpOutcome {
        switch result {
        case .ok:
            return .message(text: FR.Common.genericError, tone: .warning, canRetry: true)
        case let .notInText(message, _):
            return .message(text: message, tone: .info, canRetry: false)
        case let .blocked(reason, message, _):
            return .message(text: message, tone: reason == .adultRedirect ? .adult : .info, canRetry: false)
        case let .unavailable(reason, message, _):
            return .message(text: message, tone: .warning, canRetry: reason.isWorthRetrying)
        }
    }
}

/// The sheet that opens when a child asks for help with what they selected.
///
/// It says what the child chose at the top, so the answer is visibly about their words; it offers to read the answer
/// aloud, because a child who needed help with a word may well need help reading its explanation; and it never
/// shows which engine answered — the child is talking to the app, not to a model.
struct HelpSheet: View {
    let kind: HelpKind
    let context: HelpContext
    let child: ChildProfile
    /// The pages the question is asked about.
    var pages: [PageContent] = []
    let speak: (String) -> Void
    /// Back to the book on the passage the answer comes from.
    let goToSource: (SourceRef) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var outcome: HelpOutcome?
    @State private var isWorking = false
    @State private var question = ""
    @State private var askedKind: HelpKind?
    @State private var task: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if kind != .question {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(FR.Help.selectedText).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                            Text(context.text)
                                .font(AppFont.ui(22, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Palette.warm.opacity(0.3))
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    } else if outcome == nil && !isWorking {
                        questionForm
                    }

                    if isWorking {
                        HStack(spacing: 12) {
                            ProgressView().tint(Palette.accent)
                            Text((askedKind ?? kind).loading).font(AppFont.ui(18)).foregroundStyle(Palette.muted)
                        }
                        .padding(.vertical, 20)
                    } else if let outcome {
                        outcomeView(outcome)
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle((askedKind ?? kind).title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FR.Common.close) {
                        task?.cancel()
                        dismiss()
                    }
                }
            }
        }
        .task {
            if kind != .question { run(kind) }
        }
        .onDisappear { task?.cancel() }
    }

    // MARK: - The question form

    private var questionForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Help.questionIntro).font(AppFont.ui(17)).foregroundStyle(Palette.ink)
            Text(FR.Help.questionLabel).font(AppFont.ui(16, weight: .medium)).foregroundStyle(Palette.muted)
            TextField(FR.Help.questionPlaceholder, text: $question, axis: .vertical)
                .lineLimit(2...5)
                .font(AppFont.ui(19))
                .padding(12)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onChange(of: question) { _, value in
                    if value.utf16.count > AILimits.questionOnTextMaxChars {
                        question = String(value.prefix(AILimits.questionOnTextMaxChars))
                    }
                }
            HStack {
                Spacer()
                Text(FR.Help.counter(question.count, AILimits.questionOnTextMaxChars))
                    .font(AppFont.ui(13)).foregroundStyle(Palette.muted).monospacedDigit()
            }
            BigButton(
                title: FR.Help.questionSubmit, icon: "paperplane",
                isEnabled: !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ) { run(.question) }
        }
    }

    // MARK: - The answer

    @ViewBuilder
    private func outcomeView(_ outcome: HelpOutcome) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            switch outcome {
            case let .explanation(text, example, warning):
                answerText(text)
                if let example, !example.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(FR.Help.example).font(AppFont.ui(15, weight: .semibold)).foregroundStyle(Palette.muted)
                        Text(example).font(AppFont.ui(19)).italic().foregroundStyle(Palette.ink)
                    }
                }
                if warning { sourceWarning }
                if kind == .definition {
                    // A definition that did not click can become an explanation in the child's own sentence.
                    BigButton(title: FR.Help.askExplain, icon: "lightbulb", kind: .quiet) { run(.explain) }
                }

            case let .simplified(text, warning):
                answerText(text)
                if warning { sourceWarning }

            case let .answer(text, refs, warning):
                answerText(text)
                if warning { sourceWarning }
                ForEach(Array(refs.prefix(3).enumerated()), id: \.offset) { _, ref in
                    Button {
                        goToSource(ref)
                        dismiss()
                    } label: {
                        Label(FR.Help.seeInText(ref.pageIndex + 1), systemImage: "mappin.and.ellipse")
                            .font(AppFont.ui(16, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.accent)
                }
                BigButton(title: FR.Help.questionAnother, kind: .secondary) {
                    self.outcome = nil
                    question = ""
                }

            case let .message(text, tone, canRetry):
                Label(text, systemImage: icon(for: tone))
                    .font(AppFont.ui(19))
                    .foregroundStyle(Palette.ink)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(background(for: tone))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                if canRetry {
                    BigButton(title: FR.Help.retry, icon: "arrow.clockwise", kind: .secondary) {
                        run(askedKind ?? kind)
                    }
                }
            }

            BigButton(title: FR.Help.listen, icon: "speaker.wave.2", kind: .quiet) {
                speak(outcome.spokenText)
            }
            .accessibilityLabel(FR.Help.listenLabel)
        }
    }

    private func answerText(_ text: String) -> some View {
        Text(text)
            .font(AppFont.reading(ReaderTypography.of(child.reading), size: 22))
            .foregroundStyle(Palette.ink)
            .lineSpacing(8)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Said once, plainly: part of what the answer rests on was read by a machine.
    private var sourceWarning: some View {
        Text(KidMessages.sourceWarning)
            .font(AppFont.ui(15))
            .foregroundStyle(Palette.muted)
    }

    private func icon(for tone: HelpOutcome.Tone) -> String {
        switch tone {
        case .info: return "info.circle"
        case .warning: return "wifi.exclamationmark"
        case .adult: return "heart"
        }
    }

    private func background(for tone: HelpOutcome.Tone) -> Color {
        switch tone {
        case .info: return Palette.accentSoft
        case .warning: return Palette.warm.opacity(0.3)
        // Warm, not alarming: this is where a child is sent to talk to someone, not told off.
        case .adult: return Color(red: 1, green: 0.93, blue: 0.93)
        }
    }

    // MARK: - Asking

    private func run(_ which: HelpKind) {
        guard let ai = model.ai else {
            outcome = .message(text: KidMessages.unavailable, tone: .warning, canRetry: false)
            return
        }
        task?.cancel()
        askedKind = which
        isWorking = true
        outcome = nil

        let child = child
        let context = context
        let question = question
        let pages = pages

        task = Task { @MainActor in
            let result = await Self.ask(which, ai: ai, child: child, context: context, question: question, pages: pages)
            guard !Task.isCancelled else { return }
            outcome = result
            isWorking = false
        }
    }

    /// Builds the request for one kind of help and turns the answer into what the sheet shows.
    /// Ported from `client/src/features/reader/helpActions.ts`.
    static func ask(
        _ kind: HelpKind, ai: AIService, child: ChildProfile, context: HelpContext, question: String,
        pages: [PageContent]
    ) async -> HelpOutcome {
        let documentId = context.document.id
        let documentHash = context.documentHash

        switch kind {
        case .definition:
            let result = await ai.request(ExplainWordRequest(
                childId: child.id, documentId: documentId, documentHash: documentHash, word: context.text,
                sentence: context.sentence, paragraph: context.paragraph, pageIndex: context.pageIndex,
                ocrLowConfidence: context.ocrLowConfidence
            ), for: child)
            guard case let .ok(data, meta) = result else { return .message(for: result) }
            return .explanation(
                text: data.explanation, example: data.example,
                sourceWarning: meta.sourceWarning || context.ocrLowConfidence
            )

        case .explain:
            let result = await ai.request(ExplainTextRequest(
                childId: child.id, documentId: documentId, documentHash: documentHash, text: context.text,
                paragraph: context.paragraph, pageIndex: context.pageIndex, ocrLowConfidence: context.ocrLowConfidence
            ), for: child)
            guard case let .ok(data, meta) = result else { return .message(for: result) }
            return .explanation(
                text: data.explanation, example: data.example,
                sourceWarning: meta.sourceWarning || context.ocrLowConfidence
            )

        case .simplify:
            // A single word is simplified inside its sentence: on its own there is nothing to simplify.
            let result = await ai.request(SimplifyTextRequest(
                childId: child.id, documentId: documentId, documentHash: documentHash,
                text: context.isSingleWord ? context.sentence : context.text, pageIndex: context.pageIndex,
                ocrLowConfidence: context.ocrLowConfidence
            ), for: child)
            guard case let .ok(data, meta) = result else { return .message(for: result) }
            return .simplified(text: data.simplifiedText, sourceWarning: meta.sourceWarning || context.ocrLowConfidence)

        case .question:
            let clean = question.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty else { return .message(text: FR.Help.questionEmpty, tone: .info, canRetry: false) }
            let (inputs, _) = AIPageInput.from(pages)
            guard !inputs.isEmpty else { return .message(text: FR.Help.questionNoText, tone: .info, canRetry: false) }
            let result = await ai.request(QuestionOnTextRequest(
                childId: child.id, documentId: documentId, documentHash: documentHash, question: clean, pages: inputs
            ), for: child)
            guard case let .ok(data, meta) = result else { return .message(for: result) }
            return .answer(
                text: data.answer, refs: data.sourceRefs,
                sourceWarning: meta.sourceWarning || inputs.contains(where: \.ocrLowConfidence)
            )
        }
    }
}
