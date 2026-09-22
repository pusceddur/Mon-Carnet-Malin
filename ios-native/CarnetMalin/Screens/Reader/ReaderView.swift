import CarnetKit
import SwiftUI

/// The book, open.
struct ReaderView: View {
    let child: ChildProfile
    let documentId: String
    let startPage: Int
    /// A passage to mark for a moment once the page is open.
    var quote: String?
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var reader: ReaderViewModel
    @StateObject private var preparation = ReadingPreparation()

    @State private var showingSettings = false
    @State private var showingTTS = false
    @State private var help: HelpRequest?
    @State private var showingSummary = false
    @State private var showingExerciseSetup = false

    /// One opening of the help sheet: what kind, about what.
    struct HelpRequest: Identifiable {
        let id = UUID()
        let kind: HelpKind
        let context: HelpContext
    }
    @State private var ink = InkSettings()
    /// Where every word of the page ended up, so the pencil can anchor to them.
    @State private var wordBoxes: [Int: [WordBox]] = [:]
    /// Where each block starts on the page. A block measures its words in its own space; the pencil draws in the
    /// page's. Without this shift every stroke after the first paragraph would anchor to the wrong words.
    @State private var blockOrigins: [Int: CGPoint] = [:]
    /// Top of the reading ruler, in the page's space.
    @State private var guideTop: CGFloat = 120

    init(
        child: ChildProfile,
        documentId: String,
        startPage: Int,
        quote: String? = nil,
        library: LibraryStore? = nil,
        go: @escaping (ChildRootView.Destination) -> Void
    ) {
        self.child = child
        self.documentId = documentId
        self.startPage = startPage
        self.quote = quote
        self.go = go
        // The store is handed in by the environment on the first appearance; this placeholder is replaced there.
        _reader = StateObject(wrappedValue: ReaderViewModel(
            child: child,
            documentId: documentId,
            library: library ?? LibraryStore(store: InMemoryStore()),
            startPage: startPage
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().overlay(Palette.line)

            if reader.isLoading {
                LoadingView(message: FR.Reader.loading)
            } else if reader.document == nil {
                EmptyStateView(
                    icon: "questionmark.folder",
                    title: FR.Reader.notFoundTitle,
                    message: FR.Reader.notFoundMessage,
                    actionTitle: FR.Reader.notFoundAction
                ) { dismiss() }
                .frame(maxHeight: .infinity)
            } else {
                page
            }

            if showingTTS {
                TTSBar(reader: reader, preparation: preparationControl) { showingTTS = false }
                    .transition(.move(edge: .bottom))
            }
            pageBar
        }
        .background(reader.palette.paper.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .task { await start() }
        .onChange(of: ink.fingerDraws) { _, draws in
            Task { try? await model.services?.library.setValue(draws ? "1" : nil, forKey: AppKeys.fingerDraws) }
        }
        // A sync that brought new text for this book — a page read by the home computer, a page prepared for the
        // voice — shows up without closing it.
        .onChange(of: model.syncStatus?.lastSyncAt) { _, _ in
            Task { await reader.refreshPages() }
        }
        .onDisappear {
            reader.stopSpeaking()
            preparation.stop()
            Task { await reader.saveSession() }
        }
        .sheet(isPresented: $showingSettings) {
            ReaderSettingsPanel(reader: reader)
        }
        .sheet(item: $help) { request in
            HelpSheet(
                kind: request.kind, context: request.context, child: child, pages: reader.pages,
                speak: { reader.speakOnce($0) },
                goToSource: { ref in Task { await showSource(ref) } }
            )
        }
        .sheet(isPresented: $showingSummary) {
            if let document = reader.document {
                SummaryView(
                    child: child, document: document, pages: reader.pages, currentPage: reader.pageIndex,
                    speak: { reader.speakOnce($0) },
                    goToSource: { ref in Task { await showSource(ref) } }
                )
            }
        }
        .sheet(isPresented: $showingExerciseSetup) {
            if let document = reader.document {
                ExerciseSetupView(
                    child: child, document: document, pages: reader.pages, currentPage: reader.pageIndex
                ) { _ in go(.exercises(documentId: documentId)) }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: showingTTS)
        .animation(.easeInOut(duration: 0.2), value: reader.mode)
    }

    /// §22: offered only online and when the parent left the help on; the page on screen only.
    private var preparationControl: TTSBar.Preparation? {
        guard model.syncStatus?.state != .offline, model.settings.ai.enabled,
              let api = model.services?.api, reader.currentPage != nil else { return nil }
        let pageIndex = reader.pageIndex
        return TTSBar.Preparation(
            status: preparation.status(pageIndex: pageIndex, prepared: reader.isCurrentPagePrepared)
        ) {
            preparation.prepare(
                api: api, documentId: documentId, pageIndex: pageIndex,
                sync: {
                    await model.syncInBackground()
                    await reader.refreshPages()
                },
                isPrepared: { reader.isPrepared(pageIndex: pageIndex) },
                notify: { text, tone in model.show(text, tone: tone) }
            )
        }
    }

    /// The page a help answer points at, with its passage marked for a moment.
    private func showSource(_ ref: SourceRef) async {
        await reader.goToPage(ref.pageIndex)
        if !reader.markQuote(ref.quote) { model.show(FR.Reader.quoteNotFound) }
    }

    private func start() async {
        guard let library = model.services?.library else { return }
        await reader.attach(library: library)
        await reader.load()
        await loadFingerDraws()
        if let quote, !reader.markQuote(quote) {
            // The page is right even when the words moved: said kindly, not as an error.
            model.show(FR.Reader.quoteNotFound)
        }
    }

    // MARK: - The bar at the top

    private var toolbar: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(AppFont.ui(20, weight: .bold))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .buttonStyle(.plain)
            .foregroundStyle(reader.palette.ink)
            .accessibilityLabel(FR.Reader.back)

            Text(reader.document?.title ?? FR.Library.untitled)
                .font(AppFont.ui(19, weight: .semibold))
                .foregroundStyle(reader.palette.ink)
                .lineLimit(1)

            Spacer(minLength: 6)

            // Reading or annotating. Two modes rather than a pencil that is always live, because a hand resting on
            // the page while reading must not leave a line across it.
            Picker(FR.Reader.modeLabel, selection: $reader.mode) {
                Label(FR.Reader.modeReading, systemImage: "book").tag(ReaderViewModel.Mode.reading)
                Label(FR.Reader.modeAnnotation, systemImage: "pencil.tip").tag(ReaderViewModel.Mode.annotating)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 220)

            toolbarButton(
                showingTTS ? "speaker.slash" : "speaker.wave.2",
                showingTTS ? FR.Reader.listenClose : FR.Reader.listen
            ) {
                showingTTS.toggle()
                if showingTTS { reader.startSpeaking() } else { reader.stopSpeaking() }
            }
            toolbarButton("textformat.size", FR.Reader.settings) { showingSettings = true }

            Menu {
                if model.helpAvailable(.questionOnText), let context = reader.bookContext() {
                    Button(FR.Reader.menuQuestion, systemImage: "questionmark.bubble") {
                        reader.noteHelpAsked(lookedUpAWord: false)
                        help = HelpRequest(kind: .question, context: context)
                    }
                }
                if model.helpAvailable(.summarize) {
                    Button(FR.Reader.menuSummary, systemImage: "text.append") {
                        reader.noteHelpAsked(lookedUpAWord: false)
                        showingSummary = true
                    }
                }
                if model.helpAvailable(.generateQuestions) {
                    Button(FR.ExerciseSetup.create, systemImage: "sparkles") { showingExerciseSetup = true }
                }
                Button(FR.Reader.menuExercises, systemImage: "brain.head.profile") {
                    go(.exercises(documentId: documentId))
                }
                Button(
                    reader.display == .text ? FR.Reader.menuShowOriginal : FR.Reader.menuShowText,
                    systemImage: reader.display == .text ? "photo" : "text.alignleft"
                ) {
                    reader.display = reader.display == .text ? .original : .text
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(AppFont.ui(22))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .foregroundStyle(reader.palette.ink)
            .accessibilityLabel(FR.Reader.menu)
        }
        .padding(.horizontal, 10)
        .background(reader.palette.paper)
    }

    private func toolbarButton(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(AppFont.ui(22))
                .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
        }
        .buttonStyle(.plain)
        .foregroundStyle(reader.palette.ink)
        .accessibilityLabel(label)
    }

    // MARK: - The page

    @ViewBuilder
    private var page: some View {
        if reader.display == .original {
            #if canImport(UIKit)
            OriginalPageView(documentId: documentId, pageIndex: reader.pageIndex)
            #else
            EmptyView()
            #endif
        } else {
            textPage
        }
    }

    @ViewBuilder
    private var textPage: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let page = reader.currentPage, !page.isAvailable {
                        notice(FR.Reader.pageNotReady, icon: "hourglass")
                    } else if reader.blocks.isEmpty {
                        notice(FR.Reader.pageNoText, icon: "text.badge.xmark")
                    } else if reader.currentPage?.status == .lowConfidence {
                        // Said plainly rather than hidden: a child who meets a wrong word should know the machine
                        // read this page, not wonder whether they read it wrong.
                        notice(FR.Reader.pageLowConfidence, icon: "eye.trianglebadge.exclamationmark")
                    }

                    ForEach(reader.blocks, id: \.blockIndex) { block in
                        blockView(block)
                    }
                }
                .frame(maxWidth: reader.typography.columnWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 24)
                .overlay(alignment: .topLeading) {
                    if reader.typography.showsReadingGuide && reader.mode == .reading {
                        ReadingGuideBand(
                            top: $guideTop,
                            height: max(32, reader.typography.lineHeight * 1.3),
                            palette: reader.palette
                        )
                    }
                }
                .overlay(inkLayer)
                .coordinateSpace(name: "page")
            }
            .scrollDisabled(reader.mode == .annotating && ink.fingerDraws)
            .onChange(of: reader.pageIndex) { _, _ in
                wordBoxes = [:]
                blockOrigins = [:]
            }
            .onChange(of: reader.speech.wordRange) { _, _ in followVoiceWithGuide() }

            if reader.mode == .annotating {
                PencilToolbar(settings: $ink) {
                    Task { await reader.eraseEverythingOnThisPage() }
                }
                .padding(.top, 8)
            }

            if let selection = reader.selection, reader.mode == .reading {
                SelectionToolbar(reader: reader, selection: selection) { kind in
                    guard let context = reader.helpContext() else { return }
                    reader.noteHelpAsked(lookedUpAWord: kind == .definition)
                    help = HelpRequest(kind: kind, context: context)
                }
                    .padding(.top, 8)
            }
        }
    }

    private func notice(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(AppFont.ui(16))
            .foregroundStyle(reader.palette.ink.opacity(0.75))
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(reader.palette.sentenceHighlight.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.bottom, 16)
    }

    /// Whether a finger draws, for an iPad without an Apple Pencil. A property of the device, not of the child.
    private func loadFingerDraws() async {
        let stored = try? await model.services?.library.value(forKey: AppKeys.fingerDraws)
        ink.fingerDraws = (stored ?? nil) == "1"
    }

    @ViewBuilder
    private func blockView(_ block: BlockModel) -> some View {
        #if canImport(UIKit)
        ReaderBlockView(
            block: block,
            aids: reader.aids(for: block),
            highlights: reader.highlights(inBlock: block.blockIndex),
            typography: reader.typography,
            selection: reader.selection,
            spokenSentence: spokenSentence(in: block),
            spokenWord: spokenWord(in: block),
            onLayout: { boxes in wordBoxes[block.blockIndex] = boxes },
            onTapWord: { offset in
                guard reader.mode == .reading else { return }
                reader.selectWord(blockIndex: block.blockIndex, offset: offset)
                moveGuide(toBlock: block.blockIndex, offset: offset)
            }
        )
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { blockOrigins[block.blockIndex] = proxy.frame(in: .named("page")).origin }
                    .onChange(of: proxy.frame(in: .named("page")).origin) { _, origin in
                        blockOrigins[block.blockIndex] = origin
                    }
            }
        )
        .padding(.bottom, block.kind == .title ? 8 : 18)
        #else
        Text(block.text).padding(.bottom, 18)
        #endif
    }

    /// The sentence the voice is on, when it is in this block.
    private func spokenSentence(in block: BlockModel) -> Range<Int>? {
        guard let position = SpeechQueue.position(fromItemId: reader.speech.itemId),
              position.pageIndex == reader.pageIndex, position.blockIndex == block.blockIndex,
              block.sentences.indices.contains(position.sentenceIndex)
        else { return nil }
        let sentence = block.sentences[position.sentenceIndex]
        return sentence.start..<sentence.end
    }

    private func spokenWord(in block: BlockModel) -> NSRange? {
        guard let range = reader.speech.wordRange,
              let sentence = spokenSentence(in: block),
              range.location >= sentence.lowerBound, range.location < sentence.upperBound
        else { return nil }
        return range
    }

    /// The pencil layer, over the text and measured in the same points.
    @ViewBuilder
    private var inkLayer: some View {
        #if canImport(UIKit)
        InkCanvasView(
            strokes: resolvedStrokes(),
            settings: ink,
            isEnabled: reader.mode == .annotating,
            onStroke: { points, width in
                Task { await saveStroke(points: points, width: width) }
            },
            onErase: { path, radius in
                Task { await erase(path: path, radius: radius) }
            }
        )
        .allowsHitTesting(reader.mode == .annotating)
        #else
        EmptyView()
        #endif
    }

    #if canImport(UIKit)
    /// The strokes of this page, put back into the points where they belong on this screen.
    private func resolvedStrokes() -> [InkCanvasView.ResolvedStroke] {
        let layout = currentLayout()
        return reader.strokes.compactMap { stroke in
            guard case .text = stroke.space,
                  let anchor = Reanchor.currentAnchor(of: stroke.space, on: reader.currentPage),
                  let resolved = Anchoring.resolveTextStroke(
                      anchor: anchor, points: stroke.points, width: stroke.width, layout: layout
                  )
            else { return nil }
            return InkCanvasView.ResolvedStroke(
                id: stroke.id, points: resolved.points, width: resolved.width,
                colour: stroke.color, tool: stroke.tool, opacity: stroke.opacity
            )
        }
    }

    private func currentLayout() -> TextLayout {
        let blocks = reader.blocks.map {
            BlockLayout(
                blockIndex: $0.blockIndex,
                textHash: Anchoring.blockTextHash($0.text),
                text: $0.text,
                fontSize: reader.typography.pointSize
            )
        }
        return TextLayout(pageIndex: reader.pageIndex, blocks: blocks, words: pageWordBoxes())
    }

    /// Every word of the page in the page's own space, in reading order — the order matters: the nearest word wins a
    /// tie by coming first, and the same gesture must always pick the same word.
    private func pageWordBoxes() -> [WordBox] {
        wordBoxes.keys.sorted().flatMap { blockIndex -> [WordBox] in
            let origin = blockOrigins[blockIndex] ?? .zero
            return (wordBoxes[blockIndex] ?? []).sorted { $0.charOffset < $1.charOffset }.map { box in
                var moved = box
                moved.rect = Rect(
                    left: box.rect.left + origin.x, top: box.rect.top + origin.y,
                    width: box.rect.width, height: box.rect.height
                )
                return moved
            }
        }
    }

    /// The ruler goes to the word the child tapped.
    private func moveGuide(toBlock blockIndex: Int, offset: Int) {
        guard reader.typography.showsReadingGuide,
              let box = pageWordBoxes().last(where: { $0.blockIndex == blockIndex && $0.charOffset <= offset })
        else { return }
        guideTop = CGFloat(box.top) - (max(32, reader.typography.lineHeight * 1.3) - CGFloat(box.height)) / 2
    }

    /// While the voice reads, the ruler stays on the line it is reading.
    private func followVoiceWithGuide() {
        guard reader.typography.showsReadingGuide,
              let range = reader.speech.wordRange,
              let position = SpeechQueue.position(fromItemId: reader.speech.itemId),
              position.pageIndex == reader.pageIndex
        else { return }
        moveGuide(toBlock: position.blockIndex, offset: range.location)
    }

    private func saveStroke(points: [InkPoint], width: Double) async {
        let layout = currentLayout()
        let source = BlockTextSource(layout: layout, page: reader.currentPage)
        guard let anchored = Anchoring.anchorToText(
            points: points, width: width, layout: layout, source: source
        ) else { return }

        let now = Millis(Date().timeIntervalSince1970 * 1000)
        await reader.save(stroke: InkAnnotation(
            id: UUID().uuidString,
            childId: child.id,
            documentId: documentId,
            tool: ink.tool,
            color: ink.colour,
            width: anchored.width,
            opacity: ink.opacity,
            space: anchored.space,
            points: anchored.points,
            createdAt: now,
            updatedAt: now
        ))
    }

    private func erase(path: [Pt], radius: Double) async {
        let mode = ink.eraser ?? .stroke
        let layout = currentLayout()

        for stroke in reader.strokes {
            guard let anchor = Reanchor.currentAnchor(of: stroke.space, on: reader.currentPage),
                  let resolved = Anchoring.resolveTextStroke(
                      anchor: anchor, points: stroke.points, width: stroke.width, layout: layout
                  )
            else { continue }

            switch mode {
            case .stroke:
                if Geometry.hitTestStroke(
                    stroke: resolved.points.map(Pt.init), strokeWidth: resolved.width,
                    eraser: path, eraserRadius: radius
                ) {
                    await reader.erase(stroke: stroke)
                }
            case .partial:
                guard let fragments = StrokeEditing.split(resolved.points, eraser: path, radius: radius) else {
                    continue
                }
                // Back into the stroke's own space before they are stored.
                let source = BlockTextSource(layout: layout, page: reader.currentPage)
                let anchoredFragments = fragments.compactMap { fragment -> [InkPoint]? in
                    Anchoring.anchorToText(
                        points: fragment, width: resolved.width, layout: layout, source: source
                    )?.points
                }
                await reader.replace(stroke: stroke, with: anchoredFragments)
            case .page:
                await reader.eraseEverythingOnThisPage()
                return
            }
        }
    }
    #endif

    // MARK: - The bar at the bottom

    private var pageBar: some View {
        HStack(spacing: 16) {
            Button { Task { await reader.previousPage() } } label: {
                Label(FR.Reader.previousPage, systemImage: "chevron.left")
                    .labelStyle(.iconOnly)
                    .font(AppFont.ui(22, weight: .semibold))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .buttonStyle(.plain)
            .disabled(!reader.canGoBack)
            .opacity(reader.canGoBack ? 1 : 0.3)
            .accessibilityLabel(FR.Reader.previousPage)

            Spacer()
            Text(FR.Reader.pageOf(current: reader.pageIndex + 1, total: max(reader.pageCount, 1)))
                .font(AppFont.ui(17, weight: .medium))
                .foregroundStyle(reader.palette.ink)
                .monospacedDigit()
            Spacer()

            Button { Task { await reader.nextPage() } } label: {
                Label(FR.Reader.nextPage, systemImage: "chevron.right")
                    .labelStyle(.iconOnly)
                    .font(AppFont.ui(22, weight: .semibold))
                    .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
            }
            .buttonStyle(.plain)
            .disabled(!reader.canGoForward)
            .opacity(reader.canGoForward ? 1 : 0.3)
            .accessibilityLabel(FR.Reader.nextPage)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 6)
        .background(reader.palette.paper)
        .overlay(alignment: .top) { Divider().overlay(Palette.line.opacity(0.4)) }
    }
}

/// The pencil's own small toolbar, which only exists in annotation mode.
struct PencilToolbar: View {
    @Binding var settings: InkSettings
    let onClearPage: () -> Void

    private let colours = ["#1D4ED8", "#B91C1C", "#15803D", "#7C3AED", "#111827"]
    private let highlighterColours = ["#FFD97A", "#A7F3D0", "#BFDBFE", "#FBCFE8"]

    var body: some View {
        HStack(spacing: 10) {
            tool(.pencil, "pencil", FR.Pencil.pencil)
            tool(.pen, "pencil.tip", FR.Pencil.pen)
            tool(.highlighter, "highlighter", FR.Pencil.highlighter)

            Divider().frame(height: 26)

            Menu {
                Button(FR.Pencil.eraserStroke) { settings.eraser = .stroke }
                Button(FR.Pencil.eraserPartial) { settings.eraser = .partial }
                Button(FR.Pencil.eraserPage, role: .destructive) { onClearPage() }
            } label: {
                Image(systemName: "eraser")
                    .font(AppFont.ui(20))
                    .frame(width: 44, height: 44)
                    .background(settings.eraser != nil ? Palette.accentSoft : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .accessibilityLabel(FR.Pencil.eraser)

            Divider().frame(height: 26)

            ForEach(settings.tool == .highlighter ? highlighterColours : colours, id: \.self) { hex in
                Button {
                    settings.colour = hex
                    settings.eraser = nil
                } label: {
                    Circle()
                        .fill(ReaderColor(hex: hex).map { Color($0) } ?? .gray)
                        .frame(width: 26, height: 26)
                        .overlay(
                            Circle().strokeBorder(
                                settings.colour == hex ? Palette.ink : Palette.line,
                                lineWidth: settings.colour == hex ? 3 : 1
                            )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(FR.Pencil.colour)
            }

            Divider().frame(height: 26)

            Toggle(isOn: $settings.fingerDraws) {
                Image(systemName: "hand.draw").accessibilityLabel(FR.Pencil.fingerDraws)
            }
            .toggleStyle(.button)
            .tint(Palette.accent)
            .help(FR.Pencil.fingerDrawsHint)

            Picker(FR.Pencil.thickness, selection: $settings.thickness) {
                Text(FR.Pencil.thicknessFine).tag(Thickness.fine)
                Text(FR.Pencil.thicknessMedium).tag(Thickness.medium)
                Text(FR.Pencil.thicknessThick).tag(Thickness.thick)
            }
            .pickerStyle(.segmented)
            .frame(width: 190)
            .labelsHidden()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Palette.card)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Palette.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
    }

    private func tool(_ value: InkTool, _ icon: String, _ label: String) -> some View {
        Button {
            settings.tool = value
            settings.eraser = nil
        } label: {
            Image(systemName: icon)
                .font(AppFont.ui(20))
                .frame(width: 44, height: 44)
                .background(settings.tool == value && settings.eraser == nil ? Palette.accentSoft : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.ink)
        .accessibilityLabel(label)
    }
}
