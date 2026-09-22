import CarnetKit
import SwiftUI

#if canImport(UIKit)
import UIKit

/// One worksheet, being filled in: the photograph of the page, with the child's pencil and text boxes on top.
///
/// Everything is drawn in the page's own space — fractions of the image — so the answers stay exactly where they
/// were written whatever the size of the screen, and print where they belong when the sheet is handed in.
struct HomeworkView: View {
    let child: ChildProfile
    let documentId: String
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    enum Tool: Equatable { case none, draw, write }

    @State private var document: DocumentMeta?
    @State private var pageCount = 0
    @State private var pageIndex = 0
    @State private var image: UIImage?
    @State private var imageMissing = false
    @State private var strokes: [InkAnnotation] = []
    @State private var boxes: [TextBoxAnnotation] = []
    @State private var tool: Tool = .none
    @State private var ink = InkSettings()
    @State private var editing: TextBoxAnnotation?
    @State private var exportURL: URL?
    @State private var isExporting = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let image {
                sheet(image)
            } else if imageMissing {
                EmptyStateView(icon: "photo", title: FR.Reader.originalTitle, message: FR.Homework.noImage)
                    .frame(maxHeight: .infinity)
            } else {
                LoadingView(message: FR.Common.loading)
            }
            footer
        }
        .background(Palette.paper)
        .navigationBarBackButtonHidden()
        .task { await load() }
        .onChange(of: ink.fingerDraws) { _, draws in
            Task { try? await model.services?.library.setValue(draws ? "1" : nil, forKey: AppKeys.fingerDraws) }
        }
        .task(id: pageIndex) { await loadPage() }
        .sheet(item: $editing) { box in
            TextBoxEditor(box: box, child: child, document: document) { updated in
                Task { await save(box: updated) }
            } onDelete: {
                Task { await delete(box: box) }
            }
        }
    }

    // MARK: - Header and footer

    private var header: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(AppFont.ui(20, weight: .bold))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FR.Homework.title)

            Text(document?.title ?? FR.Library.untitled)
                .font(AppFont.ui(19, weight: .semibold)).lineLimit(1)
            Spacer()

            Picker("", selection: $tool) {
                Image(systemName: "hand.point.up").tag(Tool.none).accessibilityLabel(FR.Reader.modeReading)
                Image(systemName: "pencil.tip").tag(Tool.draw).accessibilityLabel(FR.Homework.draw)
                Image(systemName: "character.cursor.ibeam").tag(Tool.write).accessibilityLabel(FR.Homework.write)
            }
            .pickerStyle(.segmented)
            .frame(width: 200)

            Button { go(.reader(documentId: documentId, pageIndex: pageIndex)) } label: {
                Image(systemName: "text.book.closed").font(AppFont.ui(20))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FR.Homework.readText)

            if let exportURL {
                ShareLink(item: exportURL) {
                    Image(systemName: "square.and.arrow.up").font(AppFont.ui(20))
                        .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .accessibilityLabel(FR.Homework.share)
            } else {
                Button { Task { await export() } } label: {
                    Image(systemName: isExporting ? "hourglass" : "printer").font(AppFont.ui(20))
                        .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(FR.Homework.share)
            }
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, 10)
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if tool == .draw {
                PencilToolbar(settings: $ink) { Task { await clearPage() } }
            } else if tool == .write {
                Text(FR.TextBox.addHint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            HStack(spacing: 14) {
                Button { pageIndex -= 1 } label: {
                    Image(systemName: "chevron.left").frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .disabled(pageIndex == 0)
                .accessibilityLabel(FR.Reader.previousPage)

                Text(FR.Homework.pageOf(pageIndex + 1, max(pageCount, 1)))
                    .font(AppFont.ui(16, weight: .medium)).monospacedDigit()

                Button { pageIndex += 1 } label: {
                    Image(systemName: "chevron.right").frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .disabled(pageIndex + 1 >= pageCount)
                .accessibilityLabel(FR.Reader.nextPage)

                Spacer()

                if document?.isHomeworkDone == true {
                    BigButton(title: FR.Homework.reopen, icon: "arrow.uturn.backward", kind: .secondary) {
                        Task { await setDone(false) }
                    }
                    .frame(maxWidth: 260)
                } else {
                    BigButton(title: FR.Homework.finish, icon: "checkmark.seal") { Task { await setDone(true) } }
                        .frame(maxWidth: 260)
                }
            }
            .buttonStyle(.plain)
            .font(AppFont.ui(20, weight: .semibold))
            .foregroundStyle(Palette.ink)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
        .background(Palette.card)
    }

    // MARK: - The sheet

    private func sheet(_ image: UIImage) -> some View {
        GeometryReader { outer in
            let width = outer.size.width - Metrics.gutter * 2
            let height = image.size.width > 0 ? width * image.size.height / image.size.width : width
            let frame = Anchoring.PageFrame(left: 0, top: 0, width: width, height: height)

            ScrollView {
                ZStack(alignment: .topLeading) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: width, height: height)
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            guard tool == .write else { return }
                            addBox(at: location, in: frame)
                        }

                    ForEach(boxes) { box in
                        textBox(box, in: frame)
                    }

                    InkCanvasView(
                        strokes: resolved(in: frame),
                        settings: ink,
                        isEnabled: tool == .draw,
                        onStroke: { points, width in Task { await saveStroke(points, width, frame) } },
                        onErase: { path, radius in Task { await erase(path, radius, frame) } }
                    )
                    .frame(width: width, height: height)
                    .allowsHitTesting(tool == .draw)
                }
                .frame(width: width, height: height)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 16)
            }
            .scrollDisabled(tool == .draw && ink.fingerDraws)
        }
    }

    private func textBox(_ box: TextBoxAnnotation, in frame: Anchoring.PageFrame) -> some View {
        let fontSize = max(10, box.fontSize * frame.width)
        return Text(box.text.isEmpty ? " " : box.text)
            .font(.system(size: fontSize))
            .foregroundStyle(Color(ReaderColor(hex: box.color) ?? ReaderTheme.clair.ink))
            .frame(width: max(40, box.width * frame.width), alignment: .topLeading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(4)
            .background(tool == .write ? Palette.accentSoft.opacity(0.5) : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(tool == .write ? Palette.accent : .clear, style: StrokeStyle(lineWidth: 1, dash: [4]))
            )
            .offset(x: box.x * frame.width, y: box.y * frame.height)
            .onTapGesture { if tool != .draw { editing = box } }
    }

    // MARK: - Loading

    private func load() async {
        guard let library = model.services?.library else { return }
        document = try? await library.document(documentId)
        let pages = (try? await library.pages(ofDocument: documentId)) ?? []
        pageCount = max(pages.count, document?.pageCount ?? 0)
        ink.fingerDraws = (try? await library.value(forKey: AppKeys.fingerDraws)) == "1"
    }

    private func loadPage() async {
        image = nil
        imageMissing = false
        exportURL = nil
        if let data = await PageImageLoader.load(documentId: documentId, pageIndex: pageIndex, api: model.services?.api),
           let loaded = UIImage(data: data) {
            image = loaded
        } else {
            imageMissing = true
        }
        await reloadMarks()
    }

    private func reloadMarks() async {
        guard let library = model.services?.library else { return }
        let all = (try? await library.annotations(documentId: documentId, childId: child.id)) ?? []
        strokes = all.compactMap {
            guard case let .ink(value) = $0, case let .original(page) = value.space, page == pageIndex else { return nil }
            return value
        }
        boxes = all.compactMap {
            guard case let .textBox(value) = $0, value.pageIndex == pageIndex else { return nil }
            return value
        }
    }

    // MARK: - The pencil

    private func resolved(in frame: Anchoring.PageFrame) -> [InkCanvasView.ResolvedStroke] {
        strokes.map { stroke in
            let points = Anchoring.fromOriginalSpace(points: stroke.points, width: stroke.width, frame: frame)
            return InkCanvasView.ResolvedStroke(
                id: stroke.id, points: points.points, width: points.width, colour: stroke.color,
                tool: stroke.tool, opacity: stroke.opacity
            )
        }
    }

    private func saveStroke(_ points: [InkPoint], _ width: Double, _ frame: Anchoring.PageFrame) async {
        guard let library = model.services?.library,
              let stored = Anchoring.toOriginalSpace(points: points, width: width, frame: frame)
        else { return }
        let now = DocumentImporter.now()
        try? await library.save(.ink(InkAnnotation(
            id: UUID().uuidString, childId: child.id, documentId: documentId, tool: ink.tool, color: ink.colour,
            width: stored.width, opacity: ink.opacity, space: .original(pageIndex: pageIndex), points: stored.points,
            createdAt: now, updatedAt: now
        )))
        await reloadMarks()
    }

    private func erase(_ path: [Pt], _ radius: Double, _ frame: Anchoring.PageFrame) async {
        guard let library = model.services?.library else { return }
        for stroke in strokes {
            let screen = Anchoring.fromOriginalSpace(points: stroke.points, width: stroke.width, frame: frame)
            switch ink.eraser ?? .stroke {
            case .stroke, .page:
                if Geometry.hitTestStroke(
                    stroke: screen.points.map(Pt.init), strokeWidth: screen.width, eraser: path, eraserRadius: radius
                ) {
                    try? await library.markDeleted(.ink(stroke))
                }
            case .partial:
                guard let fragments = StrokeEditing.split(screen.points, eraser: path, radius: radius) else { continue }
                try? await library.markDeleted(.ink(stroke))
                let now = DocumentImporter.now()
                for fragment in fragments {
                    guard let stored = Anchoring.toOriginalSpace(points: fragment, width: screen.width, frame: frame)
                    else { continue }
                    var piece = stroke
                    piece.id = UUID().uuidString
                    piece.points = stored.points
                    piece.createdAt = now
                    piece.updatedAt = now
                    piece.deletedAt = nil
                    try? await library.save(.ink(piece))
                }
            }
        }
        await reloadMarks()
    }

    private func clearPage() async {
        guard let library = model.services?.library else { return }
        for stroke in strokes { try? await library.markDeleted(.ink(stroke)) }
        await reloadMarks()
    }

    // MARK: - Text boxes

    private func addBox(at location: CGPoint, in frame: Anchoring.PageFrame) {
        guard frame.width > 0, frame.height > 0 else { return }
        let now = DocumentImporter.now()
        let box = TextBoxAnnotation(
            id: UUID().uuidString, childId: child.id, documentId: documentId, pageIndex: pageIndex,
            x: min(max(0, location.x / frame.width), 0.95),
            y: min(max(0, location.y / frame.height), 0.97),
            width: min(0.45, 1 - location.x / frame.width),
            fontSize: 0.028,
            color: "#1D4ED8",
            text: "",
            createdAt: now,
            updatedAt: now
        )
        editing = box
    }

    private func save(box: TextBoxAnnotation) async {
        guard let library = model.services?.library else { return }
        var updated = box
        updated.updatedAt = max(DocumentImporter.now(), box.updatedAt + 1)
        if updated.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // An empty box is a tap that changed its mind: nothing is kept.
            if boxes.contains(where: { $0.id == box.id }) { try? await library.markDeleted(.textBox(box)) }
        } else {
            try? await library.save(.textBox(updated))
        }
        await reloadMarks()
    }

    private func delete(box: TextBoxAnnotation) async {
        guard let library = model.services?.library else { return }
        if boxes.contains(where: { $0.id == box.id }) { try? await library.markDeleted(.textBox(box)) }
        await reloadMarks()
    }

    // MARK: - Done, and handing it in

    private func setDone(_ isDone: Bool) async {
        guard let library = model.services?.library, var updated = document else { return }
        // « J'ai terminé » is the child's own switch, so it travels with the sync without the adult code.
        updated.homeworkDoneAt = isDone ? DocumentImporter.now() : nil
        updated.updatedAt = max(DocumentImporter.now(), updated.updatedAt + 1)
        try? await library.save(updated)
        document = updated
        model.show(isDone ? FR.Homework.finished : FR.Homework.reopened, tone: .success)
    }

    /// The sheet as a PDF, pages with everything the child wrote on them, ready to print or send to the teacher.
    private func export() async {
        guard let library = model.services?.library, let document else { return }
        isExporting = true
        defer { isExporting = false }
        let all = (try? await library.annotations(documentId: documentId, childId: child.id)) ?? []
        var pages: [HomeworkExport.Page] = []
        for index in 0..<pageCount {
            guard let data = await PageImageLoader.load(documentId: documentId, pageIndex: index, api: model.services?.api),
                  let image = UIImage(data: data)
            else { continue }
            pages.append(HomeworkExport.Page(image: image, annotations: all.filter { $0.pageIndex == index }))
        }
        exportURL = HomeworkExport.pdf(title: document.title, pages: pages)
        if exportURL == nil { model.show(FR.Homework.shareFailed, tone: .warning) }
    }
}

/// Where a page image comes from: the iPad first, then the family's server, which is then kept here.
enum PageImageLoader {
    static func load(documentId: String, pageIndex: Int, api: APIClient?) async -> Data? {
        let store = PageImageStore.standard()
        if let data = store?.image(documentId: documentId, pageIndex: pageIndex) { return data }
        guard let api, let data = await api.pageImage(documentId: documentId, pageIndex: pageIndex) else { return nil }
        try? store?.save(data, documentId: documentId, pageIndex: pageIndex)
        return data
    }
}

/// Drawing a finished worksheet into a PDF.
enum HomeworkExport {
    struct Page {
        let image: UIImage
        let annotations: [Annotation]
    }

    static func pdf(title: String, pages: [Page]) -> URL? {
        guard let first = pages.first else { return nil }
        let bounds = CGRect(origin: .zero, size: first.image.size)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let safeTitle = title.filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" }
        // In the exports folder, which a sign-out empties: this PDF is the child's handwriting, with the name of
        // their homework on it (§28).
        let url = Exports.url(named: (safeTitle.isEmpty ? "devoir" : safeTitle) + ".pdf")

        do {
            try renderer.writePDF(to: url) { context in
                for page in pages {
                    let rect = CGRect(origin: .zero, size: page.image.size)
                    context.beginPage(withBounds: rect, pageInfo: [:])
                    page.image.draw(in: rect)
                    let frame = Anchoring.PageFrame(left: 0, top: 0, width: rect.width, height: rect.height)
                    for annotation in page.annotations {
                        draw(annotation, frame: frame, in: context.cgContext)
                    }
                }
            }
            return url
        } catch {
            return nil
        }
    }

    private static func draw(_ annotation: Annotation, frame: Anchoring.PageFrame, in context: CGContext) {
        switch annotation {
        case let .ink(ink):
            guard case .original = ink.space, let colour = UIColor(hex: ink.color) else { return }
            let screen = Anchoring.fromOriginalSpace(points: ink.points, width: ink.width, frame: frame)
            guard screen.points.count >= 2 else { return }
            context.setStrokeColor(colour.withAlphaComponent(ink.opacity).cgColor)
            context.setLineWidth(screen.width)
            context.setLineCap(.round)
            context.setLineJoin(.round)
            context.move(to: CGPoint(x: screen.points[0].x, y: screen.points[0].y))
            for point in screen.points.dropFirst() { context.addLine(to: CGPoint(x: point.x, y: point.y)) }
            context.strokePath()
        case let .textBox(box):
            let font = UIFont.systemFont(ofSize: max(8, box.fontSize * frame.width))
            let colour = UIColor(hex: box.color) ?? .black
            let rect = CGRect(
                x: box.x * frame.width, y: box.y * frame.height,
                width: max(40, box.width * frame.width), height: frame.height - box.y * frame.height
            )
            (box.text as NSString).draw(in: rect, withAttributes: [.font: font, .foregroundColor: colour])
        case .highlight:
            return
        }
    }
}
#endif
