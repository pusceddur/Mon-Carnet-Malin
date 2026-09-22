import CarnetKit
import CoreGraphics
import SwiftUI
import UniformTypeIdentifiers

#if canImport(UIKit)
import UIKit
#endif

#if canImport(VisionKit)
import VisionKit
#endif

/// Adding a book: scanning pages with the camera, or choosing a file.
///
/// Everything is read on the iPad. A page a child scans is their homework, sometimes with their name and their
/// school on it; it is turned into text here and the family's own server is the only place it ever goes.
struct ImportView: View {
    /// §29 a document another app opened in Carnet Malin: added as it is, instead of scanning or choosing one.
    var incoming: URL?
    let onDone: () -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var showingScanner = false
    @State private var showingFiles = false
    @State private var title = ""
    @State private var purpose: DocumentPurpose = .reading
    @State private var selectedChildren: Set<String> = []
    @State private var progress: (done: Int, total: Int)?
    @State private var message: String?
    /// Set once the incoming document has been added or turned down, so closing the sheet does not do it twice.
    @State private var settled = false

    init(incoming: URL? = nil, onDone: @escaping () -> Void) {
        self.incoming = incoming
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let progress {
                        ImportProgressView(done: progress.done, total: progress.total)
                    } else {
                        form
                    }
                    if let message {
                        Text(message).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(incoming == nil ? FR.Parent.addBook : FR.Incoming.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FR.Common.cancel) { dismiss() }.disabled(progress != nil)
                }
            }
        }
        .task {
            // Every reader in the family, to start with: sharing a book is the usual case, and un-ticking one is
            // easier than remembering to tick them.
            selectedChildren = Set(model.children.map(\.id))
            if let incoming, title.isEmpty { title = DocumentParser.title(fromFileName: incoming.lastPathComponent) }
        }
        .onDisappear {
            // Closed without adding it: the parent decided not to, and it must not come back on its own.
            if let incoming, !settled { model.finishIncoming(incoming) }
        }
        #if canImport(VisionKit)
        .fullScreenCover(isPresented: $showingScanner) {
            DocumentScannerView { images in
                showingScanner = false
                Task { await run { await $0.importImages(images, $1, progress: $2) } }
            } onCancel: {
                showingScanner = false
            }
            .ignoresSafeArea()
        }
        #endif
        .fileImporter(
            isPresented: $showingFiles, allowedContentTypes: [.pdf, .epub, .image], allowsMultipleSelection: false
        ) { result in
            guard case let .success(urls) = result, let url = urls.first else { return }
            Task { await importFile(url) }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text(FR.Documents.titleLabel).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
                TextField(FR.Library.untitled, text: $title)
                    .textFieldStyle(.plain)
                    .font(AppFont.ui(19))
                    .padding(14)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            Picker(FR.Library.homework, selection: $purpose) {
                Text(FR.Library.title).tag(DocumentPurpose.reading)
                Text(FR.Library.homework).tag(DocumentPurpose.homework)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            VStack(alignment: .leading, spacing: 8) {
                Text(FR.Documents.readers).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
                ForEach(model.children) { child in
                    Toggle(isOn: Binding(
                        get: { selectedChildren.contains(child.id) },
                        set: { isOn in
                            if isOn { selectedChildren.insert(child.id) } else { selectedChildren.remove(child.id) }
                        }
                    )) {
                        Text("\(child.avatar) \(child.nickname)").font(AppFont.ui(17))
                    }
                    .tint(Palette.accent)
                }
            }

            if let incoming {
                incomingCard(incoming)
            } else {
                #if canImport(VisionKit)
                if VNDocumentCameraViewController.isSupported {
                    BigButton(
                        title: FR.Parent.scanPages, icon: "doc.viewfinder", isEnabled: !selectedChildren.isEmpty
                    ) { showingScanner = true }
                }
                #endif

                BigButton(
                    title: FR.Parent.importFile, icon: "folder", kind: .secondary, isEnabled: !selectedChildren.isEmpty
                ) { showingFiles = true }
            }
        }
    }

    private func incomingCard(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(FR.Incoming.intro).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
            Label(url.lastPathComponent, systemImage: "doc")
                .font(AppFont.ui(17, weight: .medium))
                .foregroundStyle(Palette.ink)
                .lineLimit(2)
            BigButton(title: FR.Incoming.add, icon: "plus", isEnabled: !selectedChildren.isEmpty) {
                Task { await run { try await $0.importFile(url, $1, progress: $2) } }
            }
            Button(FR.Incoming.ignore, role: .destructive) {
                settled = true
                model.finishIncoming(url)
                dismiss()
            }
            .font(AppFont.ui(16))
        }
    }

    private func importFile(_ url: URL) async {
        // Files chosen outside the app's own container need permission to be opened, and it has to be given back.
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        await run { try await $0.importFile(url, $1, progress: $2) }
    }

    private func run(
        _ work: (DocumentImporter, DocumentImporter.Request, @escaping DocumentImporter.Progress) async throws
            -> DocumentMeta?
    ) async {
        guard let services = model.services, let parentId = model.parentId else {
            message = FR.Common.genericError
            return
        }
        let importer = DocumentImporter(
            library: services.library, store: services.store, settings: model.settings, parentId: parentId,
            diagnostics: model.diagnostics
        )
        let request = DocumentImporter.Request(
            title: title, purpose: purpose, childIds: model.children.map(\.id).filter(selectedChildren.contains)
        )
        message = nil
        progress = (0, 1)
        do {
            _ = try await work(importer, request) { done, total in progress = (done, total) }
            progress = nil
            if let incoming {
                settled = true
                model.finishIncoming(incoming)
            }
            await model.syncInBackground()
            onDone()
            dismiss()
        } catch {
            progress = nil
            message = DocumentImporter.message(for: error)
        }
    }
}

/// How far an import has got, in pages a parent — or a child — can count.
struct ImportProgressView: View {
    let done: Int
    let total: Int

    var body: some View {
        VStack(spacing: 16) {
            ProgressView(value: Double(done), total: Double(max(total, 1))).tint(Palette.accent)
            Text(FR.Parent.importing).font(AppFont.ui(18)).foregroundStyle(Palette.ink)
            Text(FR.format(FR.Parent.importPagesReady, ["ready": String(done), "total": String(total)]))
                .font(AppFont.ui(15)).foregroundStyle(Palette.muted).monospacedDigit()
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}

#if canImport(VisionKit)
/// The system's own scanner: it finds the page in the camera, straightens it and cleans it up.
struct DocumentScannerView: UIViewControllerRepresentable {
    let onScan: ([CGImage]) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan, onCancel: onCancel)
    }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: ([CGImage]) -> Void
        let onCancel: () -> Void

        init(onScan: @escaping ([CGImage]) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan
            self.onCancel = onCancel
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
        ) {
            var images: [CGImage] = []
            for index in 0..<scan.pageCount {
                if let image = scan.imageOfPage(at: index).cgImage { images.append(image) }
            }
            onScan(images)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onCancel()
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onCancel()
        }
    }
}
#endif
