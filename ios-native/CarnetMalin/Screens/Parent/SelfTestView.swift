import CarnetKit
import PDFKit
import SwiftUI
import UIKit

/// « Tester la lecture sur cet appareil »: runs each step of the document pipeline on content it makes itself and
/// sends the outcome to the diagnostics, so a problem that only happens on the family's iPad can be understood.
/// Ported from `client/src/documents/selfTest.ts`. No personal document is ever used.
struct SelfTestView: View {
    enum Step: String, CaseIterable, Identifiable {
        case storage, ocrEngine = "ocr_engine", photo, pdf, server

        var id: String { rawValue }

        var title: String {
            switch self {
            case .storage: return "Stockage sur l’appareil"
            case .ocrEngine: return "Lecture des images sur l’appareil"
            case .photo: return "Préparation d’une grande photo"
            case .pdf: return "Lecture d’un PDF"
            case .server: return "Connexion au serveur"
            }
        }
    }

    enum Status: Equatable {
        case pending, running, ok, warning, error, skipped

        var label: String {
            switch self {
            case .pending: return "En attente"
            case .running: return "En cours…"
            case .ok: return "OK"
            case .warning: return "Attention"
            case .error: return "Problème"
            case .skipped: return "Non testé"
            }
        }
    }

    struct Outcome: Equatable {
        var status: Status = .pending
        var detail: String?
        var seconds: Double?
    }

    @EnvironmentObject private var model: AppModel

    @State private var outcomes: [Step: Outcome] = [:]
    @State private var running = false
    @State private var done = false

    private static let expected = "bonjour le monde"

    var body: some View {
        List {
            Section {
                Text("Vérifie en une minute que cet iPad sait lire les photos et les PDF. Aucun document personnel "
                    + "n’est utilisé : le test crée ses propres images.")
                    .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            Section {
                ForEach(Step.allCases) { step in
                    let outcome = outcomes[step] ?? Outcome()
                    HStack(alignment: .top, spacing: 12) {
                        icon(outcome.status).frame(width: 24)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(step.title).font(AppFont.ui(17, weight: .medium))
                            if let detail = outcome.detail {
                                Text(detail).font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(outcome.status.label).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                            if let seconds = outcome.seconds {
                                Text(String(format: "%.1f s", seconds).replacingOccurrences(of: ".", with: ","))
                                    .font(AppFont.ui(12)).foregroundStyle(Palette.muted).monospacedDigit()
                            }
                        }
                    }
                }
            }
            if done {
                Section {
                    let problems = outcomes.values.contains { $0.status == .error || $0.status == .warning }
                    Text(problems
                        ? "Des problèmes ont été détectés. Le résultat a été envoyé pour analyse."
                        : "Tout fonctionne sur cet appareil.")
                        .font(AppFont.ui(16, weight: .medium))
                        .foregroundStyle(problems ? Palette.warning : Palette.success)
                    Text("Résultat envoyé pour aider à corriger les problèmes (sans aucun texte de vos documents).")
                        .font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                }
            }
            Section {
                Button(running ? "Test en cours…" : done ? "Relancer le test" : "Lancer le test") {
                    Task { await run() }
                }
                .disabled(running)
                .font(AppFont.ui(17, weight: .semibold))
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle("Tester la lecture")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func icon(_ status: Status) -> some View {
        switch status {
        case .pending: Image(systemName: "circle").foregroundStyle(Palette.muted)
        case .running: ProgressView().controlSize(.small)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.success)
        case .warning: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.warning)
        case .error: Image(systemName: "xmark.octagon.fill").foregroundStyle(Palette.warning)
        case .skipped: Image(systemName: "minus.circle").foregroundStyle(Palette.muted)
        }
    }

    // MARK: - Running

    private func run() async {
        guard !running else { return }
        running = true
        done = false
        outcomes = [:]
        defer {
            running = false
            done = true
        }

        for step in Step.allCases {
            outcomes[step] = Outcome(status: .running)
            let started = Date()
            var outcome: Outcome
            switch step {
            case .storage: outcome = await storage()
            case .ocrEngine: outcome = await ocrEngine()
            case .photo: outcome = photo()
            case .pdf: outcome = await pdf()
            case .server: outcome = await server()
            }
            outcome.seconds = Date().timeIntervalSince(started)
            outcomes[step] = outcome
            await report(step, outcome)
        }
        await model.diagnostics?.flush()
    }

    private func report(_ step: Step, _ outcome: Outcome) async {
        let status: String
        switch outcome.status {
        case .ok: status = "ok"
        case .warning: status = "warning"
        case .error: status = "error"
        case .skipped: status = "skipped"
        case .pending, .running: return
        }
        await model.diagnostics?.report(
            .selfTest, message: "\(step.rawValue): \(status)", stage: step.rawValue,
            context: [
                "status": .string(status),
                "detail": outcome.detail.map(ClientDiagnosticReport.Value.string) ?? .null,
                "durationMs": .number(((outcome.seconds ?? 0) * 1000).rounded()),
                // Every step is reported, even a success: the point is the whole picture of this device.
                "final": .bool(true),
            ]
        )
    }

    private func storage() async -> Outcome {
        guard let library = model.services?.library else { return Outcome(status: .skipped, detail: "store_unavailable") }
        let key = "selfTest.probe"
        let value = UUID().uuidString
        do {
            try await library.setValue(value, forKey: key)
            let read = try await library.value(forKey: key)
            try await library.setValue(nil, forKey: key)
            guard read == value else { return Outcome(status: .error, detail: "read_back_mismatch") }
            let values = try? URL(fileURLWithPath: NSHomeDirectory())
                .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            let free = values?.volumeAvailableCapacityForImportantUsage
            let detail = free.map { "\(Int($0 / 1_000_000)) Mo libres" }
            if let free, free < 200_000_000 { return Outcome(status: .warning, detail: detail) }
            return Outcome(status: .ok, detail: detail)
        } catch {
            return Outcome(status: .error, detail: Diagnostics.describe(error))
        }
    }

    private func ocrEngine() async -> Outcome {
        guard let image = Self.textImage(size: CGSize(width: 900, height: 300), fontSize: 64) else {
            return Outcome(status: .error, detail: "render_failed")
        }
        do {
            let result = try await VisionOcr.read(image)
            let text = TextNormalizer.normalizedForMatch(result.lines.map(\.text).joined(separator: " "))
            let detail = "confiance \(Int((result.confidence * 100).rounded())) %"
            return Outcome(status: text.contains(Self.expected) ? .ok : .warning, detail: detail)
        } catch {
            return Outcome(status: .error, detail: Diagnostics.describe(error))
        }
    }

    /// A photo the size of a recent iPad camera's, made smaller and compressed the way an imported page is.
    private func photo() -> Outcome {
        guard let image = Self.textImage(size: CGSize(width: 4032, height: 3024), fontSize: 180) else {
            return Outcome(status: .error, detail: "render_failed")
        }
        guard let jpeg = PageImaging.jpeg(from: image) else { return Outcome(status: .error, detail: "jpeg_failed") }
        return Outcome(status: .ok, detail: "\(jpeg.count / 1024) Ko")
    }

    private func pdf() async -> Outcome {
        let bounds = CGRect(x: 0, y: 0, width: 360, height: 144)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            context.beginPage()
            ("Bonjour le monde" as NSString).draw(
                at: CGPoint(x: 24, y: 50), withAttributes: [.font: UIFont.systemFont(ofSize: 28)]
            )
        }
        do {
            let document = try PDFReader.open(data: data)
            let text = TextNormalizer.normalizedForMatch(document.lines(onPage: 0).map(\.text).joined(separator: " "))
            return Outcome(status: text.contains(Self.expected) ? .ok : .warning, detail: nil)
        } catch {
            return Outcome(status: .error, detail: Diagnostics.describe(error))
        }
    }

    private func server() async -> Outcome {
        guard let api = model.services?.api else { return Outcome(status: .skipped, detail: "no_server") }
        do {
            let status = try await api.status()
            return Outcome(status: .ok, detail: status.aiReading ? "lecture intelligente disponible" : nil)
        } catch APIError.offline, APIError.timedOut {
            return Outcome(status: .warning, detail: "hors ligne")
        } catch {
            return Outcome(status: .error, detail: Diagnostics.describe(error))
        }
    }

    /// Black text on white, the simplest page there is.
    private static func textImage(size: CGSize, fontSize: CGFloat) -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            ("Bonjour le monde" as NSString).draw(
                at: CGPoint(x: fontSize * 0.6, y: size.height / 2 - fontSize * 0.6),
                withAttributes: [.font: UIFont.systemFont(ofSize: fontSize), .foregroundColor: UIColor.black]
            )
        }
        return image.cgImage
    }
}
