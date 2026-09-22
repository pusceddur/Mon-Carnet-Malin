import CarnetKit
import SwiftUI

/// The list of exercises a child has waiting.
struct ExerciseListView: View {
    let child: ChildProfile
    let documentId: String?
    /// Opens the reader, for « Relire le passage ».
    var go: ((ChildRootView.Destination) -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var exercises: [Exercise] = []
    @State private var titles: [String: String] = [:]
    @State private var isLoading = true
    @State private var open: Exercise?
    @State private var setup: SetupContext?

    /// What the setup sheet needs, loaded before it opens.
    struct SetupContext: Identifiable {
        let document: DocumentMeta
        let pages: [PageContent]
        var id: String { document.id }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(
                title: FR.Exercises.title,
                backTitle: FR.Library.back,
                onBack: { dismiss() },
                trailing: documentId == nil ? nil : AnyView(
                    Button {
                        Task { await openSetup() }
                    } label: {
                        Label(FR.ExerciseSetup.create, systemImage: "sparkles")
                            .font(AppFont.ui(17, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                )
            )

            if isLoading {
                LoadingView(message: FR.Common.loading)
            } else if exercises.isEmpty {
                EmptyStateView(
                    icon: "brain.head.profile",
                    title: FR.Exercises.emptyTitle,
                    message: FR.Exercises.emptyMessage
                )
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: Metrics.cardSpacing) {
                        ForEach(exercises) { exercise in
                            Button { open = exercise } label: { row(exercise) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationBarBackButtonHidden()
        .task { await reload() }
        .sheet(item: $open) { exercise in
            ExerciseRunnerView(child: child, exercise: exercise, onReread: rereadAction(for: exercise))
        }
        .sheet(item: $setup) { context in
            ExerciseSetupView(
                child: child, document: context.document, pages: context.pages, currentPage: 0
            ) { exercise in
                Task {
                    await reload()
                    open = exercise
                }
            }
        }
    }

    private func rereadAction(for exercise: Exercise) -> ((SourceRef) -> Void)? {
        guard let go else { return nil }
        return { ref in
            go(.readerQuote(documentId: exercise.documentId, pageIndex: ref.pageIndex, quote: ref.quote))
        }
    }

    private func openSetup() async {
        guard let documentId, let library = model.services?.library,
              let document = try? await library.document(documentId)
        else { return }
        setup = SetupContext(document: document, pages: (try? await library.pages(ofDocument: documentId)) ?? [])
    }

    private func row(_ exercise: Exercise) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(titles[exercise.documentId] ?? FR.Library.untitled)
                    .font(AppFont.ui(20, weight: .bold))
                    .foregroundStyle(Palette.ink)
                HStack(spacing: 10) {
                    Label(
                        FR.format("{count} questions", ["count": String(exercise.questions.count)]),
                        systemImage: "list.bullet"
                    )
                    if let first = exercise.pageIndexes.min(), let last = exercise.pageIndexes.max() {
                        Label(
                            first == last
                                ? FR.Reader.pageLabel(first + 1)
                                : FR.format("Pages {a} à {b}", ["a": String(first + 1), "b": String(last + 1)]),
                            systemImage: "book"
                        )
                    }
                }
                .font(AppFont.ui(15))
                .foregroundStyle(Palette.muted)
            }
        }
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        defer { isLoading = false }
        exercises = (try? await library.exercises(childId: child.id, documentId: documentId)) ?? []
        for exercise in exercises where titles[exercise.documentId] == nil {
            titles[exercise.documentId] = (try? await library.document(exercise.documentId))?.title
        }
    }
}

/// One exercise, one question at a time.
///
/// One at a time on purpose. A page of ten questions is a page of ten things to read before answering any of them,
/// and for a child who reads slowly that is where the exercise is lost — not in the questions themselves.
struct ExerciseRunnerView: View {
    let child: ChildProfile
    let exercise: Exercise
    /// Goes back to the book, on the passage. Nil where there is no reader to go to.
    var onReread: ((SourceRef) -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var index = 0
    @State private var response: AnswerResponse?
    @State private var correction: Correction?
    @State private var results: [String: Verdict] = [:]
    @State private var isFinished = false
    @State private var isChecking = false
    /// Set when a written answer could not be corrected; the expected answer is shown instead.
    @State private var selfCheckMessage: String?
    /// How the current answer was given, and the last stroke of a drawn one.
    @State private var inputMethod: InputMethod = .touch
    @State private var inkAnnotationId: String?
    /// The passage to read again after an answer that was not right yet.
    @State private var rereadRef: SourceRef?

    private var question: Question? {
        exercise.questions.indices.contains(index) ? exercise.questions[index] : nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if isFinished {
                        finishedView
                    } else if let question {
                        Text(FR.Exercises.questionOf(current: index + 1, total: exercise.questions.count))
                            .font(AppFont.ui(15, weight: .medium))
                            .foregroundStyle(Palette.muted)

                        Text(question.prompt)
                            .font(AppFont.ui(24, weight: .semibold))
                            .foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)

                        answerView(for: question)

                        if isChecking {
                            HStack(spacing: 10) {
                                ProgressView().tint(Palette.accent)
                                Text(FR.ExerciseSetup.checking).font(AppFont.ui(17)).foregroundStyle(Palette.muted)
                            }
                        } else if let correction {
                            correctionView(correction)
                            selfCheck(for: question)
                            rereadButton
                        }

                        actions(for: question)
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.Exercises.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FR.Common.close) { dismiss() }
                }
            }
        }
    }

    // MARK: - Answering

    @ViewBuilder
    private func answerView(for question: Question) -> some View {
        switch question.kind {
        case let .multipleChoice(choices, _, _):
            VStack(spacing: 10) {
                ForEach(Array(choices.enumerated()), id: \.offset) { offset, choice in
                    choiceButton(choice, isChosen: isChosen(offset)) {
                        response = .multipleChoice(choiceIndex: offset)
                    }
                }
            }

        case .trueOrFalse:
            HStack(spacing: 12) {
                choiceButton(FR.Exercises.trueAnswer, isChosen: response == .trueOrFalse(value: true)) {
                    response = .trueOrFalse(value: true)
                }
                choiceButton(FR.Exercises.falseAnswer, isChosen: response == .trueOrFalse(value: false)) {
                    response = .trueOrFalse(value: false)
                }
            }

        case let .ordering(items):
            OrderingAnswerView(items: items) { response = .ordering(items: $0) }

        case let .matching(pairs):
            MatchingAnswerView(pairs: pairs) { response = .matching(pairs: $0) }

        case .freeAnswer:
            FreeAnswerInput(child: child, exercise: exercise, question: question) { text, method, inkId in
                // A drawing with no text is still an answer: it is kept, and the child compares for themselves.
                response = text.isEmpty && inkId == nil ? nil : .freeAnswer(text: text)
                inputMethod = method
                inkAnnotationId = inkId
            }
            .id(question.id)
        }
    }

    private func isChosen(_ offset: Int) -> Bool {
        if case let .multipleChoice(chosen) = response { return chosen == offset }
        return false
    }

    private func choiceButton(_ title: String, isChosen: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: isChosen ? "largecircle.fill.circle" : "circle")
                    .font(AppFont.ui(22))
                    .foregroundStyle(isChosen ? Palette.accent : Palette.muted)
                Text(title)
                    .font(AppFont.ui(20))
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: Metrics.touchTarget)
            .background(isChosen ? Palette.accentSoft : Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isChosen ? Palette.accent : Palette.line, lineWidth: isChosen ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(correction != nil)
    }

    // MARK: - Being told

    @ViewBuilder
    private func correctionView(_ correction: Correction) -> some View {
        // Nobody read the answer: no verdict is pretended, the child is asked to compare for themselves.
        let isSelfCheck = selfCheckMessage != nil
        VStack(alignment: .leading, spacing: 8) {
            Label(
                isSelfCheck ? FR.ExerciseSetup.feedbackSelfCheck : title(for: correction.verdict),
                systemImage: isSelfCheck ? "magnifyingglass" : icon(for: correction.verdict)
            )
            .font(AppFont.ui(20, weight: .bold))
            .foregroundStyle(isSelfCheck ? Palette.accent : colour(for: correction.verdict))
            if !isSelfCheck {
                Text(correction.feedback)
                    .font(AppFont.ui(18))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colour(for: correction.verdict).opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func title(for verdict: Verdict) -> String {
        switch verdict {
        case .correct: return "Bravo !"
        case .partial: return "Presque !"
        case .incorrect: return "Pas encore"
        }
    }

    private func icon(for verdict: Verdict) -> String {
        switch verdict {
        case .correct: return "checkmark.circle.fill"
        case .partial: return "circle.lefthalf.filled"
        case .incorrect: return "arrow.counterclockwise.circle"
        }
    }

    private func colour(for verdict: Verdict) -> Color {
        switch verdict {
        case .correct: return Palette.success
        case .partial: return Palette.accent
        // Not red. A wrong answer here is a step, not an error to be flagged, and this app is used by children who
        // have seen enough red already.
        case .incorrect: return Palette.muted
        }
    }

    @ViewBuilder
    private func actions(for question: Question) -> some View {
        if correction == nil {
            BigButton(title: FR.Exercises.check, icon: "checkmark", isEnabled: response != nil && !isChecking) {
                Task { await check(question) }
            }
        } else {
            BigButton(
                title: index + 1 < exercise.questions.count ? FR.Exercises.nextQuestion : FR.Exercises.finish,
                icon: "arrow.right"
            ) {
                if index + 1 < exercise.questions.count {
                    index += 1
                    response = nil
                    correction = nil
                    selfCheckMessage = nil
                    inputMethod = .touch
                    inkAnnotationId = nil
                    rereadRef = nil
                } else {
                    isFinished = true
                }
            }
        }
    }

    private func check(_ question: Question) async {
        guard let response, let library = model.services?.library else { return }
        isChecking = true
        defer { isChecking = false }

        var verdict: Verdict?
        var feedback: String?
        var correctedBy: Exercise.Origin?
        var rereadRef: SourceRef? = question.source

        if let judged = ExerciseCorrection.correct(question, response) {
            // Judged here whenever it can be: a child on a train gets an answer straight away instead of « pas de
            // connexion ».
            verdict = judged.verdict
            feedback = judged.feedback
            correctedBy = .local
            rereadRef = judged.verdict == .correct ? nil : question.source
            correction = judged
        } else if case let .freeAnswer(text) = response {
            // A written answer needs someone to read it. When the help can, it does; when it cannot, the child sees
            // the expected answer and compares for themselves — which is a real exercise too, not a failure.
            let document = try? await library.document(exercise.documentId)
            let pages = (try? await library.pages(ofDocument: exercise.documentId)) ?? []
            let wanted = Set(exercise.pageIndexes)
            let outcome: ExerciseGeneration.FreeCorrection
            if let document, model.helpAvailable(.correctAnswer) {
                outcome = await ExerciseGeneration.correctFreeAnswer(
                    question: question, text: text,
                    pages: pages.filter { wanted.isEmpty || wanted.contains($0.pageIndex) },
                    document: document, child: child, ai: model.ai
                )
            } else {
                outcome = .selfCheck(message: nil)
            }

            switch outcome {
            case let .corrected(judged, ref):
                verdict = judged.verdict
                feedback = judged.feedback
                correctedBy = .ai
                rereadRef = ref
                correction = judged
            case let .selfCheck(message):
                selfCheckMessage = message ?? ""
                correction = Correction(verdict: .partial, feedback: FR.ExerciseSetup.feedbackSelfCheck)
            case let .adultRedirect(message):
                feedback = message
                rereadRef = nil
                correction = Correction(verdict: .partial, feedback: message)
            }
        } else {
            correction = Correction(verdict: .partial, feedback: FR.ExerciseSetup.feedbackSelfCheck)
        }
        if let verdict { results[question.id] = verdict }
        // A written answer the child compares themselves is worth checking against the book too.
        self.rereadRef = (verdict == .correct) ? nil : rereadRef

        let now = Millis(Date().timeIntervalSince1970 * 1000)
        try? await library.save(Answer(
            id: UUID().uuidString,
            exerciseId: exercise.id,
            questionId: question.id,
            childId: child.id,
            response: response,
            inputMethod: question.isClosed ? .touch : inputMethod,
            inkAnnotationId: question.isClosed ? nil : inkAnnotationId,
            verdict: verdict,
            feedback: feedback,
            correctedBy: correctedBy,
            rereadRef: rereadRef,
            createdAt: now,
            updatedAt: now
        ))
    }

    /// « 📖 Relire le passage »: the book opens on the page, with the passage marked for a moment.
    @ViewBuilder
    private var rereadButton: some View {
        if let rereadRef, let onReread, !rereadRef.quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Button {
                dismiss()
                onReread(rereadRef)
            } label: {
                Label(FR.Exercises.reread, systemImage: "book")
                    .font(AppFont.ui(18, weight: .medium))
                    .frame(maxWidth: .infinity, minHeight: Metrics.touchTarget)
            }
            .buttonStyle(.bordered)
            .tint(Palette.accent)
        }
    }

    /// For a written answer nobody could read: what was expected, and the ideas that mattered.
    @ViewBuilder
    private func selfCheck(for question: Question) -> some View {
        if selfCheckMessage != nil, case let .freeAnswer(expected, keyPoints) = question.kind {
            VStack(alignment: .leading, spacing: 8) {
                if let message = selfCheckMessage, !message.isEmpty {
                    Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                }
                Text(FR.ExerciseSetup.expected).font(AppFont.ui(16, weight: .semibold)).foregroundStyle(Palette.muted)
                Text(expected).font(AppFont.ui(19)).foregroundStyle(Palette.ink)
                if !keyPoints.isEmpty {
                    Text(FR.ExerciseSetup.keyPoints).font(AppFont.ui(16, weight: .semibold)).foregroundStyle(Palette.muted)
                    ForEach(keyPoints, id: \.self) { point in
                        Text("• \(point)").font(AppFont.ui(18)).foregroundStyle(Palette.ink)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var finishedView: some View {
        VStack(spacing: 18) {
            Image(systemName: "star.fill").font(AppFont.ui(56)).foregroundStyle(Palette.warm)
            Text(FR.Exercises.wellDoneTitle).font(AppFont.title(30)).foregroundStyle(Palette.ink)
            // What went right, counted; what went wrong, not tallied back at them.
            Text(FR.Exercises.score(
                correct: results.values.filter { $0 == .correct }.count,
                total: exercise.questions.count
            ))
            .font(AppFont.ui(22))
            .foregroundStyle(Palette.muted)
            BigButton(title: FR.Common.done, icon: "checkmark") { dismiss() }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}

/// « Remets ces phrases dans l’ordre ».
struct OrderingAnswerView: View {
    let items: [String]
    let onChange: ([String]) -> Void
    @State private var order: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Exercises.orderHint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)

            ForEach(Array(order.enumerated()), id: \.offset) { position, item in
                HStack(spacing: 10) {
                    Text("\(position + 1)")
                        .font(AppFont.ui(17, weight: .bold))
                        .frame(width: 32, height: 32)
                        .background(Palette.accentSoft)
                        .clipShape(Circle())
                    Text(item)
                        .font(AppFont.ui(18))
                        .foregroundStyle(Palette.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // Arrows rather than drag-and-drop: a child who cannot hold a long drag steady can still order
                    // the sentences, and the arrows say plainly what they do.
                    Button { move(position, by: -1) } label: {
                        Image(systemName: "arrow.up").frame(width: 40, height: 40)
                    }
                    .disabled(position == 0)
                    Button { move(position, by: 1) } label: {
                        Image(systemName: "arrow.down").frame(width: 40, height: 40)
                    }
                    .disabled(position == order.count - 1)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accent)
                .padding(12)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
            }
        }
        .onAppear {
            // Shuffled, but never handed back in the right order by accident.
            var shuffled = items.shuffled()
            if shuffled == items, items.count > 1 { shuffled.reverse() }
            order = shuffled
            onChange(order)
        }
    }

    private func move(_ position: Int, by delta: Int) {
        let target = position + delta
        guard order.indices.contains(position), order.indices.contains(target) else { return }
        order.swapAt(position, target)
        onChange(order)
    }
}

/// « Relie chaque mot à ce qui va avec ».
struct MatchingAnswerView: View {
    let pairs: [Question.Pair]
    let onChange: ([Question.Pair]) -> Void

    @State private var rights: [String] = []
    @State private var chosen: [String: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Exercises.matchHint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)

            ForEach(pairs, id: \.left) { pair in
                HStack(spacing: 12) {
                    Text(pair.left)
                        .font(AppFont.ui(19, weight: .medium))
                        .foregroundStyle(Palette.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Picker("", selection: Binding(
                        get: { chosen[pair.left] ?? "" },
                        set: {
                            chosen[pair.left] = $0
                            report()
                        }
                    )) {
                        Text("—").tag("")
                        ForEach(rights, id: \.self) { right in
                            Text(right).tag(right)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(Palette.accent)
                    .labelsHidden()
                }
                .padding(12)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
            }
        }
        .onAppear {
            rights = pairs.map(\.right).shuffled()
            report()
        }
    }

    private func report() {
        onChange(pairs.compactMap { pair in
            guard let right = chosen[pair.left], !right.isEmpty else { return nil }
            return Question.Pair(left: pair.left, right: right)
        })
    }
}
