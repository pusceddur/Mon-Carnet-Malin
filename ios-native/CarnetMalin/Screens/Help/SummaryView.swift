import CarnetKit
import SwiftUI

/// « Résumé »: a summary of the book, of part of it, or of the page the child is on.
///
/// The progress bar is not decoration. A summary of a whole book takes a minute or two, and a child staring at a
/// spinner for two minutes decides the app has frozen and gives up — the bar moving chunk by chunk is what keeps them
/// waiting for something worth waiting for.
struct SummaryView: View {
    let child: ChildProfile
    let document: DocumentMeta
    let pages: [PageContent]
    let currentPage: Int
    let speak: (String) -> Void
    /// Back to the book on the passage a summary sentence comes from.
    let goToSource: (SourceRef) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    enum Scope: Hashable { case page, book }

    @State private var scope: Scope = .page
    @State private var level: SummaryLevel = .normal
    @State private var progress: (done: Int, total: Int)?
    @State private var result: Outcome?
    @State private var task: Task<Void, Never>?

    enum Outcome {
        case summary(SummaryData, sourceWarning: Bool)
        case message(title: String, text: String, canRetry: Bool)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let progress {
                        working(progress)
                    } else if let result {
                        outcome(result)
                    } else {
                        setup
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.Summary.title)
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
        .onDisappear { task?.cancel() }
    }

    // MARK: - Choosing

    private var setup: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(FR.Summary.pagesLabel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Summary.pagesLabel, selection: $scope) {
                Text(FR.Summary.pagesCurrent).tag(Scope.page)
                Text(FR.Summary.pagesAll).tag(Scope.book)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Text(FR.Summary.levelLabel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Summary.levelLabel, selection: $level) {
                Text(FR.Summary.levelShort).tag(SummaryLevel.short)
                Text(FR.Summary.levelNormal).tag(SummaryLevel.normal)
                Text(FR.Summary.levelDetailed).tag(SummaryLevel.detailed)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            BigButton(title: FR.Summary.start, icon: "text.append") { start() }
                .padding(.top, 8)
        }
    }

    private func working(_ progress: (done: Int, total: Int)) -> some View {
        VStack(spacing: 16) {
            ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                .tint(Palette.accent)
            Text(FR.Summary.preparing).font(AppFont.ui(19)).foregroundStyle(Palette.ink)
            Text(FR.Summary.progress(progress.done, progress.total))
                .font(AppFont.ui(15)).foregroundStyle(Palette.muted).monospacedDigit()
            BigButton(title: FR.ExerciseSetup.stop, kind: .secondary) {
                task?.cancel()
                self.progress = nil
            }
            .frame(maxWidth: 260)
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }

    // MARK: - The result

    @ViewBuilder
    private func outcome(_ outcome: Outcome) -> some View {
        switch outcome {
        case let .summary(data, warning):
            VStack(alignment: .leading, spacing: 18) {
                Text(FR.Summary.resultTitle).font(AppFont.title(26)).foregroundStyle(Palette.ink)
                Text(data.summary)
                    .font(AppFont.reading(ReaderTypography.of(child.reading), size: 22))
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(8)
                    .fixedSize(horizontal: false, vertical: true)

                BigButton(title: FR.Summary.listen, icon: "speaker.wave.2", kind: .quiet) {
                    speak(([data.summary] + data.keyPoints).joined(separator: " "))
                }

                if !data.keyPoints.isEmpty {
                    Text(FR.Summary.keyPointsTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
                    ForEach(Array(data.keyPoints.enumerated()), id: \.offset) { _, point in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(Palette.accent)
                            Text(point).font(AppFont.ui(19)).foregroundStyle(Palette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !data.sourceRefs.isEmpty {
                    // Where each point comes from: a summary a child can check against the book is one they can
                    // learn from, not just one they are told.
                    Text(FR.Summary.sourcesTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
                    ForEach(Array(data.sourceRefs.prefix(5).enumerated()), id: \.offset) { _, ref in
                        Button {
                            goToSource(ref)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(FR.Summary.openSource(ref.pageIndex + 1), systemImage: "book")
                                    .font(AppFont.ui(16, weight: .medium))
                                    .foregroundStyle(Palette.accent)
                                Text("« \(ref.quote) »")
                                    .font(AppFont.ui(15)).italic().foregroundStyle(Palette.muted).lineLimit(3)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Palette.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }

                if warning {
                    Text(KidMessages.sourceWarning).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                }

                BigButton(title: FR.Summary.again, kind: .secondary) { result = nil }
            }

        case let .message(title, text, canRetry):
            VStack(alignment: .leading, spacing: 16) {
                Text(title).font(AppFont.title(24)).foregroundStyle(Palette.ink)
                Text(text).font(AppFont.ui(19)).foregroundStyle(Palette.ink)
                if canRetry {
                    BigButton(title: FR.Help.retry, icon: "arrow.clockwise") { start() }
                }
                BigButton(title: FR.Common.back, kind: .secondary) { result = nil }
            }
        }
    }

    // MARK: - Asking

    private func start() {
        guard let ai = model.ai else {
            result = .message(title: FR.Summary.unavailableTitle, text: KidMessages.unavailable, canRetry: false)
            return
        }
        let chosen = scope == .page ? pages.filter { $0.pageIndex == currentPage } : pages
        let (inputs, _) = AIPageInput.from(chosen)
        guard !inputs.isEmpty else {
            result = .message(title: FR.Summary.unavailableTitle, text: FR.Summary.emptyText, canRetry: false)
            return
        }

        progress = (0, 1)
        result = nil
        let child = child
        let document = document
        let level = level

        task?.cancel()
        task = Task { @MainActor in
            let summary = await ai.summarize(
                pages: inputs, level: level, child: child, documentId: document.id,
                documentHash: document.sourceHash.isEmpty ? nil : document.sourceHash,
                progress: { done, total in
                    Task { @MainActor in if self.progress != nil { self.progress = (done, total) } }
                }
            )
            guard !Task.isCancelled else { return }
            progress = nil

            switch summary {
            case let .ok(data, meta):
                result = .summary(data, sourceWarning: meta.sourceWarning || inputs.contains(where: \.ocrLowConfidence))
            case let .notInText(message, _):
                result = .message(title: FR.Summary.unavailableTitle, text: message, canRetry: false)
            case let .blocked(_, message, _):
                result = .message(title: FR.Summary.blockedTitle, text: message, canRetry: false)
            case let .unavailable(reason, message, _):
                result = .message(title: FR.Summary.unavailableTitle, text: message, canRetry: reason.isWorthRetrying)
            }
        }
    }
}
