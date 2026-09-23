import CarnetKit
import SwiftUI

/// §18 « Pose ta question »: a question about anything, not only about a book.
///
/// Three things set it apart from the rest of the help. The answer is never kept on the iPad — the parent sees every
/// question asked, and a cached answer would skip that. « Je n’ai pas compris » asks again, more simply, rather than
/// leaving the child with an answer they could not follow. And the follow-up questions are buttons, because a child
/// who types slowly should not have to type again to keep going.
struct FreeQuestionView: View {
    let child: ChildProfile
    let speak: (String) -> Void
    /// Stops the voice when the child leaves this screen.
    let stopSpeaking: () -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var question = ""
    @State private var asked: String?
    @State private var answer: FreeQuestionData?
    @State private var message: (text: String, canRetry: Bool)?
    @State private var waitingMode: FreeQuestionRequest.Mode?
    @State private var previous: FreeQuestionRequest.Exchange?
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: FR.FreeQuestion.title, backTitle: FR.FreeQuestion.back) {
                task?.cancel()
                dismiss()
            }

            if !model.helpAvailable(.freeQuestion) {
                EmptyStateView(
                    icon: "bubble.left.and.exclamationmark.bubble.right",
                    title: FR.FreeQuestion.disabledTitle,
                    message: FR.FreeQuestion.disabledMessage
                )
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let waitingMode {
                            waiting(waitingMode)
                        } else if let answer, let asked {
                            answerView(answer, asked: asked)
                        } else if let message {
                            messageView(message.text, canRetry: message.canRetry)
                        } else {
                            form
                        }
                    }
                    .padding(Metrics.gutter)
                    .frame(maxWidth: 680)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .background(Palette.paper)
        .navigationBarBackButtonHidden()
        .onDisappear {
            task?.cancel()
            stopSpeaking()
        }
    }

    // MARK: - Asking

    private var isTooLong: Bool { question.utf16.count > AILimits.freeQuestionMaxChars }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.FreeQuestion.label).font(AppFont.ui(20, weight: .semibold)).foregroundStyle(Palette.ink)
            Text(FR.FreeQuestion.hint).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
            TextField(FR.FreeQuestion.placeholder, text: $question, axis: .vertical)
                .lineLimit(3...6)
                .font(AppFont.ui(21))
                .padding(14)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .submitLabel(.send)
            HStack {
                if isTooLong {
                    Text(FR.FreeQuestion.tooLong).font(AppFont.ui(15)).foregroundStyle(Palette.warning)
                }
                Spacer()
                Text(FR.Help.counter(question.utf16.count, AILimits.freeQuestionMaxChars))
                    .font(AppFont.ui(13)).foregroundStyle(Palette.muted).monospacedDigit()
            }
            BigButton(
                title: FR.FreeQuestion.submit, icon: "paperplane",
                isEnabled: !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isTooLong
            ) { ask(question, mode: .normal) }
        }
    }

    private func waiting(_ mode: FreeQuestionRequest.Mode) -> some View {
        VStack(spacing: 18) {
            ProgressView().controlSize(.large).tint(Palette.accent)
            Text(mode == .simpler ? FR.FreeQuestion.waitingSimpler : FR.FreeQuestion.waitingNormal)
                .font(AppFont.ui(19)).foregroundStyle(Palette.ink)
            BigButton(title: FR.FreeQuestion.stop, kind: .secondary) {
                task?.cancel()
                waitingMode = nil
            }
            .frame(maxWidth: 240)
        }
        .padding(.vertical, 50)
        .frame(maxWidth: .infinity)
    }

    private func answerView(_ answer: FreeQuestionData, asked: String) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(FR.FreeQuestion.yourQuestion).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                Text(asked).font(AppFont.ui(19, weight: .medium)).foregroundStyle(Palette.ink)
            }

            Text(FR.FreeQuestion.answerTitle).font(AppFont.title(24)).foregroundStyle(Palette.ink)
            Text(answer.answer)
                .font(AppFont.reading(ReaderTypography.of(child.reading), size: 22))
                .foregroundStyle(Palette.ink)
                .lineSpacing(8)
                .fixedSize(horizontal: false, vertical: true)

            if let example = answer.example, !example.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(FR.FreeQuestion.example).font(AppFont.ui(15, weight: .semibold)).foregroundStyle(Palette.muted)
                    Text(example).font(AppFont.ui(19)).italic().foregroundStyle(Palette.ink)
                }
            }

            HStack(spacing: 12) {
                BigButton(title: FR.Help.listen, icon: "speaker.wave.2", kind: .quiet) {
                    speak([answer.answer, answer.example].compactMap { $0 }.joined(separator: " "))
                }
                BigButton(title: FR.FreeQuestion.notUnderstood, icon: "questionmark.circle", kind: .secondary) {
                    ask(asked, mode: .simpler)
                }
            }

            if !answer.suggestions.isEmpty {
                Text(FR.FreeQuestion.suggestionsTitle).font(AppFont.ui(19, weight: .semibold)).foregroundStyle(Palette.ink)
                ForEach(answer.suggestions.prefix(3), id: \.self) { suggestion in
                    Button { ask(suggestion, mode: .normal) } label: {
                        Text(suggestion)
                            .font(AppFont.ui(18))
                            .foregroundStyle(Palette.accent)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(Palette.accentSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            BigButton(title: FR.FreeQuestion.newQuestion, icon: "plus.bubble", kind: .secondary) { reset() }
        }
    }

    private func messageView(_ text: String, canRetry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(text)
                .font(AppFont.ui(20))
                .foregroundStyle(Palette.ink)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.warm.opacity(0.3))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            BigButton(title: FR.Help.listen, icon: "speaker.wave.2", kind: .quiet) { speak(text) }
            if canRetry, let asked {
                BigButton(title: FR.FreeQuestion.retry, icon: "arrow.clockwise") { ask(asked, mode: .normal) }
            }
            BigButton(title: FR.FreeQuestion.newQuestion, kind: .secondary) { reset() }
        }
    }

    private func reset() {
        question = ""
        asked = nil
        answer = nil
        message = nil
        previous = nil
    }

    private func ask(_ text: String, mode: FreeQuestionRequest.Mode) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, let ai = model.ai else { return }

        // « Je n’ai pas compris » and a follow-up both carry the last exchange, so the model knows what « ça » is.
        let context = answer.map { FreeQuestionRequest.Exchange(question: asked ?? clean, answer: $0.answer) } ?? previous
        let request = FreeQuestionRequest(childId: child.id, question: clean, previous: context, mode: mode)
        let child = child

        task?.cancel()
        waitingMode = mode
        asked = clean
        message = nil

        task = Task { @MainActor in
            let result = await ai.request(request, for: child)
            guard !Task.isCancelled else { return }
            waitingMode = nil

            switch result {
            case let .ok(data, _):
                previous = context
                answer = data
            default:
                answer = nil
                let canRetry: Bool
                if case let .unavailable(reason, _, _) = result { canRetry = reason.isWorthRetrying } else { canRetry = false }
                message = (result.message ?? KidMessages.unavailable, canRetry)
            }
        }
    }
}
