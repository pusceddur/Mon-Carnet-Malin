import CarnetKit
import SwiftUI

/// « Activité »: what the children read and asked, over the last week or month.
///
/// Counts of effort — minutes, pages, words looked up — and never of mistakes. A page that told a parent « 14 erreurs
/// cette semaine » would turn reading at home into something to be judged on, which is the one thing this app is
/// trying not to be.
struct ActivityView: View {
    @EnvironmentObject private var model: AppModel

    enum Period: Hashable { case week, month }

    @State private var childId: String?
    @State private var period: Period = .week
    @State private var summary: ActivitySummary?
    @State private var questions: [FreeQuestionLogEntry] = []
    @State private var writing: WritingCorrectionHistory?
    @State private var writingFailed = false
    @State private var seenAlerts: Set<String> = []
    @State private var failed = false
    @State private var isLoading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                filters

                if isLoading && summary == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                } else if failed {
                    Text(FR.Activity.loadFailed).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
                } else if let summary {
                    stats(summary)
                    alerts(summary)
                    help(summary)
                    budget(summary)
                    if childId != nil { questionsSection }
                    if let writingChildId { writingSection(childName(writingChildId)) }
                }
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.paper)
        .navigationTitle(FR.Activity.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(childId ?? "all")-\(period)") { await load() }
        .refreshable { await load() }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker(FR.Activity.child, selection: $childId) {
                Text(FR.Activity.allChildren).tag(String?.none)
                ForEach(model.children) { child in
                    Text("\(child.avatar) \(child.firstName)").tag(Optional(child.id))
                }
            }
            .pickerStyle(.menu)
            .tint(Palette.accent)

            Picker(FR.Activity.period, selection: $period) {
                Text(FR.Activity.periodWeek).tag(Period.week)
                Text(FR.Activity.periodMonth).tag(Period.month)
            }
            .pickerStyle(.segmented)
        }
    }

    // MARK: - Reading

    private func stats(_ summary: ActivitySummary) -> some View {
        let sessions = summary.sessions.filter { childId == nil || $0.childId == childId }
        let minutes = sessions.reduce(0) { $0 + $1.minutes }
        let pages = sessions.reduce(0) { $0 + Set($1.pagesViewed).count }
        let words = sessions.reduce(0) { $0 + $1.wordsLookedUp }
        let listening = sessions.reduce(0) { $0 + $1.ttsSeconds } / 60

        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            tile(FR.Activity.readingTime, FR.Activity.duration(minutes: minutes), "clock")
            tile(FR.Activity.pages, String(pages), "book.pages")
            tile(FR.Activity.words, String(words), "character.book.closed")
            tile(FR.Activity.listening, FR.Activity.duration(minutes: listening), "speaker.wave.2")
            tile(FR.Activity.sessions, String(sessions.count), "calendar")
        }
    }

    private func tile(_ title: String, _ value: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).foregroundStyle(Palette.accent)
            Text(value).font(AppFont.ui(24, weight: .bold)).foregroundStyle(Palette.ink).monospacedDigit()
            Text(title).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: - Alerts

    @ViewBuilder
    private func alerts(_ summary: ActivitySummary) -> some View {
        let shown = summary.alerts.filter { childId == nil || $0.childId == childId || $0.childId == nil }
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Activity.alertsTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
            if shown.isEmpty {
                Text(FR.Activity.alertsNone).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            ForEach(shown) { alert in
                let seen = alert.seenAt != nil || seenAlerts.contains(alert.id)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(FR.Activity.alertKind(alert.kind)).font(AppFont.ui(17, weight: .semibold))
                        Spacer()
                        Text(date(alert.createdAt)).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                    if let name = childName(alert.childId) {
                        Text(name).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                    }
                    if !alert.detail.isEmpty {
                        Text(alert.detail).font(AppFont.ui(15)).foregroundStyle(Palette.ink)
                    }
                    if seen {
                        Label(FR.Activity.seen, systemImage: "checkmark").font(AppFont.ui(14)).foregroundStyle(Palette.success)
                    } else {
                        Button(FR.Activity.markSeen) { Task { await markSeen(alert.id) } }
                            .font(AppFont.ui(15, weight: .medium))
                    }
                }
                .padding(14)
                .background(seen ? Palette.card : Palette.warm.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    // MARK: - Help and budget

    private func help(_ summary: ActivitySummary) -> some View {
        let requests = summary.aiRequests.filter { childId == nil || $0.childId == childId }
        let cached = requests.filter(\.cacheHit).count
        return VStack(alignment: .leading, spacing: 6) {
            Text(FR.Activity.aiTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
            if requests.isEmpty {
                Text(FR.Activity.aiNone).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            } else {
                Text(FR.Activity.aiTotal(requests.count)).font(AppFont.ui(17)).foregroundStyle(Palette.ink)
                if cached > 0 {
                    Text(FR.Activity.cacheHits(cached)).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    private func budget(_ summary: ActivitySummary) -> some View {
        let budget = summary.budget
        let ratio = budget.monthlyBudgetEur > 0 ? budget.monthToDateEur / budget.monthlyBudgetEur : 0
        return VStack(alignment: .leading, spacing: 6) {
            Text(FR.Activity.budgetTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
            Text(FR.Activity.budgetValue(
                spent: FR.Activity.euros(budget.monthToDateEur), budget: FR.Activity.euros(budget.monthlyBudgetEur)
            ))
            .font(AppFont.ui(17))
            ProgressView(value: min(1, ratio)).tint(ratio >= 1 ? Palette.warning : Palette.accent)
            if ratio >= 1 {
                Text(FR.Activity.budgetReached).font(AppFont.ui(14)).foregroundStyle(Palette.warning)
            } else if ratio >= 0.8 {
                Text(FR.Activity.budgetWarning).font(AppFont.ui(14)).foregroundStyle(Palette.warning)
            }
            if budget.workerEstimateEur > 0 {
                Text(FR.Activity.budgetEstimate(FR.Activity.euros(budget.workerEstimateEur)))
                    .font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            }
        }
    }

    // MARK: - Free questions

    private var questionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Activity.questionsTitle).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
            Text(FR.Activity.questionsIntro).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            if questions.isEmpty {
                Text(FR.Activity.questionsEmpty).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            ForEach(questions) { entry in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(FR.Activity.questionOutcome(entry.outcome))
                            .font(AppFont.ui(13, weight: .semibold))
                            .foregroundStyle(entry.outcome == .answered ? Palette.success : Palette.warning)
                        Spacer()
                        Text(date(entry.createdAt)).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                    Text(entry.question).font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
                    if let answer = entry.answer, !answer.isEmpty {
                        DisclosureGroup(FR.Activity.showAnswer) {
                            Text(answer).font(AppFont.ui(15)).foregroundStyle(Palette.ink).padding(.top, 4)
                        }
                        .font(AppFont.ui(14))
                        .tint(Palette.accent)
                    }
                }
                .padding(12)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    // MARK: - Writing corrected (§24)

    /// One child at a time: the one chosen above, or the first when « Tous les enfants » is shown.
    private var writingChildId: String? {
        childId ?? model.children.first?.id
    }

    private func writingSection(_ name: String?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Activity.Writing.title).font(AppFont.ui(20, weight: .bold)).foregroundStyle(Palette.ink)
            Text(FR.Activity.Writing.intro).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            if childId == nil, model.children.count > 1, let name {
                Text(name).font(AppFont.ui(15, weight: .semibold)).foregroundStyle(Palette.ink)
            }
            if writingFailed {
                Text(FR.Activity.Writing.loadFailed).font(AppFont.ui(15)).foregroundStyle(Palette.warning)
                Button(FR.Activity.Writing.retry) { Task { await loadWriting() } }
                    .buttonStyle(.bordered)
            } else if let writing {
                if writing.entries.isEmpty {
                    Text(FR.Activity.Writing.empty).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                } else {
                    writingSummary(writing)
                    ForEach(writing.entries) { writingEntry($0) }
                }
            } else {
                ProgressView()
            }
        }
    }

    private func writingSummary(_ history: WritingCorrectionHistory) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Activity.Writing.summaryTitle).font(AppFont.ui(15, weight: .semibold)).foregroundStyle(Palette.ink)
            // A list rather than chips in a row: six kinds at most, and a list never runs off the side.
            ForEach(WritingCorrectionHistory.kindOrder.filter { history.count(of: $0) > 0 }, id: \.self) { kind in
                HStack {
                    Text(FR.Activity.Writing.kind(kind))
                    Spacer()
                    Text("\(history.count(of: kind))").monospacedDigit()
                }
                .font(AppFont.ui(15))
                .foregroundStyle(Palette.ink)
            }
            if !history.frequent.isEmpty {
                Text(FR.Activity.Writing.frequentTitle)
                    .font(AppFont.ui(15, weight: .semibold)).foregroundStyle(Palette.ink)
                    .padding(.top, 4)
                ForEach(history.frequent, id: \.self) { mistake in
                    HStack(spacing: 8) {
                        change(from: mistake.from, to: mistake.to)
                        Text(FR.Activity.Writing.frequentItem(mistake.count))
                            .font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func writingEntry(_ entry: WritingCorrectionEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(date(entry.createdAt)) · \(FR.Activity.Writing.corrections(entry.changes.count))")
                .font(AppFont.ui(13)).foregroundStyle(Palette.muted)
            ForEach(Array(entry.changes.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        change(from: item.from, to: item.to)
                        Text(FR.Activity.Writing.kind(item.kind))
                            .font(AppFont.ui(12, weight: .medium))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Palette.accentSoft, in: Capsule())
                    }
                    if let rule = item.rule, !rule.isEmpty {
                        Text(rule).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                }
            }
            DisclosureGroup(FR.Activity.Writing.showTexts) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(FR.Activity.Writing.original).font(AppFont.ui(13, weight: .semibold))
                    Text(entry.originalText).font(AppFont.ui(15)).textSelection(.enabled)
                    Text(FR.Activity.Writing.corrected).font(AppFont.ui(13, weight: .semibold)).padding(.top, 4)
                    Text(entry.correctedText).font(AppFont.ui(15)).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(Palette.ink)
                .padding(.top, 4)
            }
            .font(AppFont.ui(14))
            .tint(Palette.accent)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    /// « from → to », an empty side shown as ∅ (a word added or removed).
    private func change(from: String, to: String) -> some View {
        HStack(spacing: 6) {
            Text(from.isEmpty ? "∅" : from).strikethrough().foregroundStyle(Palette.warning)
            Text("→").foregroundStyle(Palette.muted).accessibilityHidden(true)
            Text(to.isEmpty ? "∅" : to).foregroundStyle(Palette.success)
        }
        .font(AppFont.ui(16, weight: .medium))
    }

    // MARK: - Loading

    private func childName(_ id: String?) -> String? {
        guard let id else { return nil }
        return model.children.first { $0.id == id }.map { "\($0.avatar) \($0.firstName)" }
    }

    private func date(_ millis: Millis) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    private func load() async {
        guard let api = model.services?.api else { return }
        isLoading = true
        failed = false
        defer { isLoading = false }

        let now = Millis(Date().timeIntervalSince1970 * 1000)
        let days: Millis = period == .week ? 7 : 30
        do {
            summary = try await api.activity(childId: childId, from: now - days * 24 * 3_600_000, to: now)
        } catch {
            failed = summary == nil
        }
        if let childId {
            questions = (try? await api.freeQuestionHistory(childId: childId)) ?? []
        } else {
            questions = []
        }
        await loadWriting()
    }

    private func loadWriting() async {
        guard let api = model.services?.api, let id = writingChildId else {
            writing = nil
            return
        }
        writingFailed = false
        do {
            writing = try await api.writingHistory(childId: id)
        } catch {
            writing = nil
            writingFailed = true
        }
    }

    private func markSeen(_ id: String) async {
        guard let api = model.services?.api else { return }
        if (try? await api.markAlertSeen(id: id)) != nil { seenAlerts.insert(id) }
    }
}
