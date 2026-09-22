import CarnetKit
import SwiftUI

/// The home computer that runs the « lecture intelligente » (§17.5), with the use of the subscription it last saw and
/// the estimate of the month (§21). Information only: nothing here can go wrong for the parent.
struct WorkerStatusSection: View {
    @EnvironmentObject private var model: AppModel

    @State private var status: WorkerStatus?
    @State private var isLoading = true

    var body: some View {
        Section {
            if isLoading && status == nil {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(FR.Worker.checking).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                }
            } else if let status {
                let view = WorkerStatusDescription(status: status, now: Date())
                line(view.text, tone: view.tone, weight: .semibold)
                ForEach(view.queued, id: \.self) { Text($0).font(AppFont.ui(15)).foregroundStyle(Palette.ink) }
                if let subscription = view.subscription {
                    line(subscription.text, tone: subscription.tone, weight: .regular)
                    ForEach(subscription.details, id: \.self) {
                        Text($0).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    }
                }
                ForEach(view.estimate, id: \.self) { Text($0).font(AppFont.ui(15)).foregroundStyle(Palette.ink) }
            } else {
                Text(FR.Worker.unavailable).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            Button(FR.Worker.refresh) { Task { await load() } }
                .font(AppFont.ui(15))
                .disabled(isLoading)
        } header: {
            Text(FR.Worker.title).font(AppFont.ui(15, weight: .semibold))
        }
        .task { await load() }
    }

    private func line(_ text: String, tone: WorkerStatusDescription.Tone, weight: Font.Weight) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(colour(tone)).frame(width: 10, height: 10).accessibilityHidden(true)
            Text(text).font(AppFont.ui(16, weight: weight)).foregroundStyle(Palette.ink)
        }
    }

    private func colour(_ tone: WorkerStatusDescription.Tone) -> Color {
        switch tone {
        case .ok: return Palette.success
        case .warn: return Palette.warning
        case .off: return Palette.muted
        }
    }

    private func load() async {
        guard let api = model.services?.api else {
            isLoading = false
            return
        }
        isLoading = true
        status = await api.workerStatus()
        isLoading = false
    }
}

/// What the parent reads about the home computer. Ported from `client/src/features/parent/workerStatus.ts`.
struct WorkerStatusDescription {
    enum Tone { case ok, warn, off }

    struct Subscription {
        let tone: Tone
        let text: String
        let details: [String]
    }

    let tone: Tone
    /// « Ordinateur de la maison : connecté ».
    let text: String
    /// Waiting pages and help requests, only the counts that are not zero.
    let queued: [String]
    /// Nil when no home computer is configured.
    let subscription: Subscription?
    /// « Estimation du mois : 3,20 € » (and every account of the server, for its owner).
    let estimate: [String]

    init(status: WorkerStatus, now: Date) {
        let nowMillis = Millis(now.timeIntervalSince1970 * 1000)
        let state: (Tone, String)
        if !status.configured {
            state = (.off, FR.Worker.notConfigured)
        } else if !status.connected {
            state = (.off, status.lastSeenAt.map { FR.Worker.offline(Self.relative($0, now: nowMillis)) }
                ?? FR.Worker.neverSeen)
        } else if status.limited {
            state = (.warn, status.limitResetsAt.map { FR.Worker.limited(Self.time($0, now: nowMillis)) }
                ?? FR.Worker.limitedNoTime)
        } else {
            state = (.ok, FR.Worker.connected)
        }
        tone = state.0
        text = FR.Worker.state(state.1)

        var queued: [String] = []
        var estimate: [String] = []
        if status.configured {
            if status.queued.pageText > 0 { queued.append(FR.Worker.pages(status.queued.pageText)) }
            if status.queued.ai > 0 { queued.append(FR.Worker.requests(status.queued.ai)) }
            if status.queued.pageSpeech > 0 { queued.append(FR.Worker.speech(status.queued.pageSpeech)) }
            estimate.append(FR.Worker.estimate(FR.Activity.euros(status.estimate.monthToDateEur)))
            if let all = status.estimate.allAccountsEur, all > status.estimate.monthToDateEur {
                estimate.append(FR.Worker.estimateAll(FR.Activity.euros(all)))
            }
        }
        self.queued = queued
        self.estimate = estimate
        subscription = status.configured ? Self.describe(status.usage, now: nowMillis) : nil
    }

    /// « Abonnement : 82 % utilisés sur la semaine », with the reset time and how recent the figure is.
    static func describe(_ usage: SubscriptionUsage?, now: Millis) -> Subscription {
        guard let usage else { return Subscription(tone: .off, text: FR.Worker.usageNone, details: []) }
        let window = FR.Worker.window(usage.window ?? .other)
        let text: String
        if usage.status == .rejected {
            text = FR.Worker.usageReached(window)
        } else if let utilization = usage.utilization {
            text = FR.Worker.usagePercent(Int(utilization.rounded()), window)
        } else {
            text = FR.Worker.usageComfortable(window)
        }
        var details: [String] = []
        if let resetsAt = usage.resetsAt, resetsAt > now { details.append(FR.Worker.resets(time(resetsAt, now: now))) }
        // The home computer's clock: never « dans 5 secondes ».
        if let observedAt = usage.observedAt { details.append(FR.Worker.observed(relative(min(observedAt, now), now: now))) }
        return Subscription(tone: usage.status == .allowed ? .ok : .warn, text: text, details: details)
    }

    static func relative(_ millis: Millis, now: Millis) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        return formatter.localizedString(
            for: Date(timeIntervalSince1970: Double(millis) / 1000),
            relativeTo: Date(timeIntervalSince1970: Double(now) / 1000)
        )
    }

    /// The time alone today, the date and time otherwise.
    static func time(_ millis: Millis, now: Millis) -> String {
        let date = Date(timeIntervalSince1970: Double(millis) / 1000)
        let today = Date(timeIntervalSince1970: Double(now) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateStyle = Calendar.current.isDate(date, inSameDayAs: today) ? .none : .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
