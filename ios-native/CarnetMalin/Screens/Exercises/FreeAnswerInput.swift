import CarnetKit
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// « Réponds avec tes mots »: typed, dictated, written with Scribble — or drawn by hand.
///
/// Two ways in because some children cannot yet write legibly, or not fast enough to keep the thought, and an
/// exercise that only accepted typing would be testing typing. The drawing is kept as ink, like any other mark.
struct FreeAnswerInput: View {
    let child: ChildProfile
    let exercise: Exercise
    let question: Question
    /// What was answered, how, and the last stroke of a drawn answer.
    let onChange: (String, InputMethod, String?) -> Void

    @EnvironmentObject private var model: AppModel

    enum Tab: Hashable { case write, draw }

    @State private var tab: Tab = .write
    @State private var text = ""
    @State private var method: InputMethod = .keyboard
    @State private var strokes: [InkAnnotation] = []
    @State private var recognized: String?
    @State private var isRecognizing = false
    @State private var message: String?
    @State private var ink = InkSettings(tool: .pen, colour: "#111827", thickness: .medium)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Comment veux-tu répondre ?", selection: $tab) {
                Label("Écrire", systemImage: "keyboard").tag(Tab.write)
                Label("Dessiner", systemImage: "pencil.tip").tag(Tab.draw)
            }
            .pickerStyle(.segmented)

            switch tab {
            case .write: writeArea
            case .draw: drawArea
            }

            if let message {
                Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
        }
        .task { await loadInk() }
    }

    // MARK: - Writing

    private var writeArea: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: $text)
                .font(AppFont.ui(20))
                .frame(minHeight: 140)
                .padding(10)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
                .onChange(of: text) { _, value in
                    let clipped = String(value.prefix(AILimits.answerMaxChars))
                    if clipped != value { text = clipped }
                    report()
                }
            if text.isEmpty {
                Text("Tu peux écrire avec le crayon, le clavier ou la dictée.")
                    .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
        }
    }

    // MARK: - Drawing

    private var drawArea: some View {
        VStack(alignment: .leading, spacing: 10) {
            #if canImport(UIKit)
            GeometryReader { geometry in
                let width = geometry.size.width
                InkCanvasView(
                    strokes: strokes.map { stroke in
                        let screen = Anchoring.fromAnswerSpace(points: stroke.points, width: stroke.width, boxWidth: width)
                        return InkCanvasView.ResolvedStroke(
                            id: stroke.id, points: screen.points, width: screen.width, colour: stroke.color,
                            tool: stroke.tool, opacity: stroke.opacity
                        )
                    },
                    settings: InkSettings(tool: .pen, colour: "#111827", thickness: .medium, eraser: ink.eraser, fingerDraws: true),
                    isEnabled: true,
                    onStroke: { points, strokeWidth in Task { await save(points, strokeWidth, width) } },
                    onErase: { path, radius in Task { await erase(path, radius, width) } }
                )
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
            }
            .frame(height: 260)
            #endif

            HStack(spacing: 12) {
                Button {
                    ink.eraser = ink.eraser == nil ? .stroke : nil
                } label: {
                    Label(FR.Pencil.eraser, systemImage: ink.eraser == nil ? "eraser" : "eraser.fill")
                }
                .buttonStyle(.bordered)

                if model.helpAvailable(.recognizeHandwriting), !strokes.isEmpty {
                    Button { Task { await recognize() } } label: {
                        Label(isRecognizing ? "Je lis ton écriture…" : "Transformer en texte", systemImage: "character.textbox")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .disabled(isRecognizing)
                }
            }
            .font(AppFont.ui(16, weight: .medium))

            if !strokes.isEmpty {
                Text("Ton dessin est gardé dans tes notes.").font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            }

            if let recognized {
                // The child confirms: a machine's reading of their handwriting is not put in their mouth unasked.
                VStack(alignment: .leading, spacing: 8) {
                    Text("J’ai lu :").font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                    Text(recognized).font(AppFont.ui(20, weight: .medium)).foregroundStyle(Palette.ink)
                    Text("C’est bien ce que tu as écrit ?").font(AppFont.ui(16)).foregroundStyle(Palette.ink)
                    HStack(spacing: 12) {
                        BigButton(title: "Oui, c’est ça", icon: "checkmark") {
                            text = recognized
                            method = .handwriting
                            self.recognized = nil
                            report()
                        }
                        BigButton(title: "Non", kind: .secondary) { self.recognized = nil }
                    }
                }
                .padding(14)
                .background(Palette.accentSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    // MARK: - Reporting

    private func report() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            onChange(trimmed, method == .handwriting ? .handwriting : .keyboard, method == .handwriting ? strokes.last?.id : nil)
        } else if !strokes.isEmpty {
            // A drawing alone is an answer too; nobody can read it for the child, so they will compare themselves.
            onChange("", .handwriting, strokes.last?.id)
        } else {
            onChange("", .keyboard, nil)
        }
    }

    // MARK: - The ink

    private func loadInk() async {
        guard let library = model.services?.library else { return }
        let all = (try? await library.annotations(childId: child.id)) ?? []
        strokes = all.compactMap { annotation in
            guard Handwriting.isAnswerInk(annotation, exerciseId: exercise.id, questionId: question.id),
                  case let .ink(value) = annotation else { return nil }
            return value
        }
        .sorted { $0.createdAt < $1.createdAt }
    }

    private func save(_ points: [InkPoint], _ width: Double, _ boxWidth: Double) async {
        guard let library = model.services?.library,
              let stored = Anchoring.toAnswerSpace(points: points, width: width, boxWidth: boxWidth)
        else { return }
        let now = DocumentImporter.now()
        let stroke = InkAnnotation(
            id: UUID().uuidString, childId: child.id, documentId: exercise.documentId, tool: .pen,
            color: "#111827", width: stored.width, opacity: 1,
            space: .answer(exerciseId: exercise.id, questionId: question.id),
            points: stored.points, createdAt: now, updatedAt: now
        )
        try? await library.save(.ink(stroke))
        strokes.append(stroke)
        report()
    }

    private func erase(_ path: [Pt], _ radius: Double, _ boxWidth: Double) async {
        guard let library = model.services?.library else { return }
        for stroke in strokes {
            let screen = Anchoring.fromAnswerSpace(points: stroke.points, width: stroke.width, boxWidth: boxWidth)
            if Geometry.hitTestStroke(
                stroke: screen.points.map(Pt.init), strokeWidth: screen.width, eraser: path, eraserRadius: radius
            ) {
                try? await library.markDeleted(.ink(stroke))
            }
        }
        await loadInk()
        report()
    }

    /// Draws the answer into a PNG and asks the help to read it.
    private func recognize() async {
        #if canImport(UIKit)
        guard let ai = model.ai else { return }
        isRecognizing = true
        message = nil
        defer { isRecognizing = false }

        var png: String?
        for side in [Handwriting.maxSide, Handwriting.maxSide / 2, Handwriting.maxSide / 4] {
            guard let raster = Handwriting.plan(strokes, maxSide: side), let data = Self.render(raster) else { break }
            let base64 = data.base64EncodedString()
            if Handwriting.decodedSize(ofBase64: base64) <= Handwriting.maxImageBytes {
                png = base64
                break
            }
        }
        guard let png else {
            message = "Je n’arrive pas à préparer ton dessin. Tu peux écrire ta réponse."
            return
        }

        let result = await ai.request(RecognizeHandwritingRequest(
            childId: child.id, documentId: exercise.documentId, documentHash: nil, imagePngBase64: png
        ), for: child)
        switch result {
        case let .ok(data, _):
            let read = String(data.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AILimits.answerMaxChars))
            if read.isEmpty {
                message = "Je n’arrive pas à lire ton écriture. Tu peux l’écrire avec le clavier."
            } else {
                recognized = read
            }
        default:
            message = result.message
        }
        #endif
    }

    #if canImport(UIKit)
    /// Dark strokes on white, which is what a reader of handwriting expects.
    static func render(_ raster: InkRaster) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: raster.width, height: raster.height)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let cg = context.cgContext
            cg.setStrokeColor(UIColor(white: 0.07, alpha: 1).cgColor)
            cg.setFillColor(UIColor(white: 0.07, alpha: 1).cgColor)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            for stroke in raster.strokes {
                guard let first = stroke.points.first else { continue }
                cg.setLineWidth(stroke.lineWidth)
                if stroke.points.count == 1 {
                    let r = stroke.lineWidth / 2
                    cg.fillEllipse(in: CGRect(x: first.x - r, y: first.y - r, width: r * 2, height: r * 2))
                    continue
                }
                cg.move(to: CGPoint(x: first.x, y: first.y))
                for point in stroke.points.dropFirst() { cg.addLine(to: CGPoint(x: point.x, y: point.y)) }
                cg.strokePath()
            }
        }
        return image.pngData()
    }
    #endif
}
