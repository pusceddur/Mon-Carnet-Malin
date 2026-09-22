import CarnetKit
import SwiftUI

/// « Fais-moi des questions »: the child picks how many and what kinds, the help writes them.
struct ExerciseSetupView: View {
    let child: ChildProfile
    let document: DocumentMeta
    let pages: [PageContent]
    let currentPage: Int
    /// Called with the exercise once it is saved, so it can be played straight away.
    let onCreated: (Exercise) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    enum Scope: Hashable { case page, book }

    @State private var scope: Scope = .page
    @State private var count = 5
    @State private var types: Set<QuestionType> = []
    @State private var isWorking = false
    @State private var step = 0
    @State private var message: (title: String, text: String, canRetry: Bool)?
    @State private var task: Task<Void, Never>?

    private var chosenPages: [PageContent] {
        (scope == .page ? pages.filter { $0.pageIndex == currentPage } : pages).filter(\.isReadable)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if isWorking {
                        waiting
                    } else if let message {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(message.title).font(AppFont.title(24)).foregroundStyle(Palette.ink)
                            Text(message.text).font(AppFont.ui(19)).foregroundStyle(Palette.ink)
                            if message.canRetry {
                                BigButton(title: FR.ExerciseSetup.retry, icon: "arrow.clockwise") { start() }
                            }
                            BigButton(title: FR.Common.back, kind: .secondary) { self.message = nil }
                        }
                    } else {
                        form
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.ExerciseSetup.title)
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
            count = [3, 5, 10].contains(child.exercises.defaultQuestionCount) ? child.exercises.defaultQuestionCount : 5
            types = Set(ExerciseGeneration.allowedTypes(child.exercises.enabledTypes))
        }
        .onDisappear { task?.cancel() }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            Picker(FR.Summary.pagesLabel, selection: $scope) {
                Text(FR.Summary.pagesCurrent).tag(Scope.page)
                Text(FR.Summary.pagesAll).tag(Scope.book)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if chosenPages.isEmpty {
                Text(FR.ExerciseSetup.noneReady).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
            }

            Text(FR.ExerciseSetup.countLabel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.ExerciseSetup.countLabel, selection: $count) {
                Text("3").tag(3)
                Text("5").tag(5)
                Text("10").tag(10)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Text(FR.ExerciseSetup.typesLabel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Text(FR.ExerciseSetup.typesHint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            // Only the kinds the parent allowed for this child; the child chooses among those.
            ForEach(ExerciseGeneration.allowedTypes(child.exercises.enabledTypes), id: \.self) { type in
                Button {
                    if types.contains(type) {
                        if types.count > 1 { types.remove(type) }
                    } else {
                        types.insert(type)
                    }
                } label: {
                    HStack {
                        Image(systemName: types.contains(type) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(types.contains(type) ? Palette.accent : Palette.muted)
                        Text(label(for: type)).font(AppFont.ui(18)).foregroundStyle(Palette.ink)
                        Spacer()
                    }
                    .padding(14)
                    .background(types.contains(type) ? Palette.accentSoft : Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }

            BigButton(
                title: FR.ExerciseSetup.start, icon: "sparkles",
                isEnabled: !chosenPages.isEmpty && !types.isEmpty && model.helpAvailable(.generateQuestions)
            ) { start() }
            .padding(.top, 6)

            if !model.helpAvailable(.generateQuestions) {
                Text(FR.ExerciseSetup.unavailableTitle).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
        }
    }

    /// Steps that change while the questions are written. It takes a while, and a sentence that moves says the app is
    /// working where a still one says it is stuck.
    private var waiting: some View {
        VStack(spacing: 18) {
            ProgressView().controlSize(.large).tint(Palette.accent)
            Text(FR.ExerciseSetup.waitingTitle).font(AppFont.ui(21, weight: .semibold)).foregroundStyle(Palette.ink)
            Text(FR.ExerciseSetup.waitingSteps[min(step, FR.ExerciseSetup.waitingSteps.count - 1)])
                .font(AppFont.ui(17)).foregroundStyle(Palette.muted)
                .animation(.easeInOut, value: step)
            BigButton(title: FR.ExerciseSetup.stop, kind: .secondary) {
                task?.cancel()
                isWorking = false
            }
            .frame(maxWidth: 240)
        }
        .padding(.vertical, 50)
        .frame(maxWidth: .infinity)
        .task(id: isWorking) {
            step = 0
            while isWorking, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                step += 1
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

    private func start() {
        guard let ai = model.ai, let library = model.services?.library else { return }
        let pages = chosenPages
        let chosenTypes = QuestionType.allCases.filter(types.contains)
        let child = child
        let document = document
        let count = count

        isWorking = true
        message = nil
        task?.cancel()
        task = Task { @MainActor in
            let outcome = await ExerciseGeneration.create(
                pages: pages, document: document, child: child, count: count, types: chosenTypes, ai: ai,
                now: Millis(Date().timeIntervalSince1970 * 1000)
            )
            guard !Task.isCancelled else { return }
            isWorking = false

            switch outcome {
            case let .created(exercise):
                try? await library.save(exercise)
                onCreated(exercise)
                dismiss()
            case let .blocked(text):
                message = (FR.ExerciseSetup.blockedTitle, text, false)
            case let .unavailable(text, canRetry):
                message = (FR.ExerciseSetup.unavailableTitle, text, canRetry)
            case .empty:
                message = (FR.ExerciseSetup.emptyTitle, FR.ExerciseSetup.emptyText, false)
            }
        }
    }
}
