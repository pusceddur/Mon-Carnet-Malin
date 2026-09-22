import CarnetKit
import Foundation
import SwiftUI

/// Everything one open book is doing.
///
/// The reader is where the app spends almost all its time, so the rules it follows are worth stating plainly:
/// nothing here waits on the network, the child's place is saved as they read rather than when they leave, and every
/// piece of help — the voice, the colours, the pencil — can be switched off without taking anything else with it.
@MainActor
final class ReaderViewModel: ObservableObject {
    enum Mode: String, CaseIterable {
        case reading, annotating
    }

    enum Display: String {
        case text, original
    }

    @Published private(set) var document: DocumentMeta?
    @Published private(set) var pages: [PageContent] = []
    @Published private(set) var blocks: [BlockModel] = []
    @Published private(set) var highlights: [TextHighlight] = []
    @Published private(set) var strokes: [InkAnnotation] = []
    @Published private(set) var isLoading = true

    @Published var pageIndex = 0
    @Published var mode: Mode = .reading
    @Published var display: Display = .text
    @Published var selection: ReaderRange?
    @Published var speech: SpeechState = .idle
    @Published var isSpeaking = false
    /// A passage marked for a moment: where an exercise's question comes from.
    @Published private(set) var quoteMark: ReaderRange?
    private var quoteMarkTask: Task<Void, Never>?

    /// The child's own reading settings, edited live from the panel.
    @Published var reading: ReadingPreferences
    @Published var tts: TTSPreferences
    @Published var aids: ReadingAids

    let child: ChildProfile
    let documentId: String

    private var library: LibraryStore
    private let reader = SpeechReader()
    private var voiceIdentifier: String?
    private var saveTask: Task<Void, Never>?
    /// This sitting with the book, for the parent's weekly page.
    private var session: ReadingSession?
    private var speakingSince: Date?

    init(child: ChildProfile, documentId: String, library: LibraryStore, startPage: Int) {
        self.child = child
        self.documentId = documentId
        self.library = library
        self.pageIndex = max(0, startPage)
        self.reading = child.reading
        self.tts = child.tts
        self.aids = child.reading.aids
    }

    // MARK: - Loading

    /// Hands over the real store.
    ///
    /// The view model is created by `@StateObject`, which runs before the view has an environment, so it starts with
    /// an empty store and is given the family's one here. Anything else would mean either a global or a store built
    /// again on every redraw.
    func attach(library: LibraryStore) async {
        self.library = library
    }

    func load() async {
        defer { isLoading = false }
        document = try? await library.document(documentId)
        pages = (try? await library.pages(ofDocument: documentId)) ?? []
        pageIndex = min(max(0, pageIndex), max(0, pages.count - 1))
        voiceIdentifier = try? await library.value(forKey: AppKeys.voiceIdentifier)
        await reloadPage()
        await reloadAnnotations()
        wireSpeech()
        beginSession()
    }

    // MARK: - The sitting

    /// Counts what the child did in this sitting: minutes, pages, words looked up, help asked for. Never mistakes —
    /// a number a child can fail at would turn reading into a test.
    private func beginSession() {
        let now = Millis(Date().timeIntervalSince1970 * 1000)
        session = ReadingSession(
            id: UUID().uuidString, childId: child.id, documentId: documentId, startedAt: now, endedAt: now,
            pagesViewed: [pageIndex], updatedAt: now
        )
    }

    func noteHelpAsked(lookedUpAWord: Bool) {
        session?.aiRequests += 1
        if lookedUpAWord { session?.wordsLookedUp += 1 }
    }

    private func noteSpeaking(_ isSpeaking: Bool) {
        if isSpeaking, speakingSince == nil {
            speakingSince = Date()
        } else if !isSpeaking, let since = speakingSince {
            session?.ttsSeconds += max(0, Int(Date().timeIntervalSince(since)))
            speakingSince = nil
        }
    }

    /// Writes the sitting so far. Called on each page turn and when the book is closed, so a tablet that runs out of
    /// battery still leaves most of the afternoon on the parent's page.
    func saveSession() async {
        noteSpeaking(false)
        guard var current = session else { return }
        let now = Millis(Date().timeIntervalSince1970 * 1000)
        // A book opened and closed at once is not a reading session.
        guard now - current.startedAt >= 15_000 || current.pagesViewed.count > 1 || current.aiRequests > 0 else { return }
        current.endedAt = now
        current.updatedAt = max(now, current.updatedAt + 1)
        session = current
        try? await library.save(current)
    }

    /// Takes the pages again from the store after a sync, keeping the child's place: a page read by the home
    /// computer, or prepared for the voice, shows up without closing the book.
    func refreshPages() async {
        guard !isLoading else { return }
        let fresh = (try? await library.pages(ofDocument: documentId)) ?? []
        guard !fresh.isEmpty, fresh != pages else { return }
        document = (try? await library.document(documentId)) ?? document
        pages = fresh
        pageIndex = min(pageIndex, max(0, pages.count - 1))
        await reloadPage()
        await reloadAnnotations()
    }

    /// The voice reads at least part of this page from a preparation (§22).
    var isCurrentPagePrepared: Bool { isPrepared(pageIndex: pageIndex) }

    func isPrepared(pageIndex: Int) -> Bool {
        pages.first { $0.pageIndex == pageIndex }?.blocks.contains { $0.spoken != nil } ?? false
    }

    func reloadPage() async {
        guard let page = currentPage else {
            blocks = []
            return
        }
        blocks = page.blocks.enumerated().map { index, block in
            ReaderModel.buildBlock(pageIndex: page.pageIndex, blockIndex: index, block: block)
        }
    }

    func reloadAnnotations() async {
        let all = (try? await library.annotations(documentId: documentId, childId: child.id)) ?? []
        // Placed on the text as it is now, not as it was when they were made: a page read again by the home
        // computer moves its words, and a highlight drawn at its old offsets would colour the wrong ones. One whose
        // words are gone is not drawn — it stays in « Mes notes ».
        let page = currentPage
        highlights = all.compactMap {
            guard case var .highlight(value) = $0, value.pageIndex == pageIndex else { return nil }
            guard let page, !page.blocks.isEmpty else { return value }
            guard case let .found(blockIndex, start, end) = Reanchor.find(.highlight(value), in: page) else {
                return nil
            }
            value.blockIndex = blockIndex
            value.start = start
            value.end = end
            return value
        }
        strokes = all.compactMap {
            guard case let .ink(value) = $0 else { return nil }
            return value.space.pageIndex == pageIndex ? value : nil
        }
    }

    var currentPage: PageContent? {
        pages.indices.contains(pageIndex) ? pages[pageIndex] : nil
    }

    var pageCount: Int { max(pages.count, document?.pageCount ?? 0) }

    var typography: ReaderTypography { ReaderTypography.of(reading) }
    var palette: ReaderPalette { ReaderPalette(theme: typography.theme) }

    /// The reading aids for one block, or nothing at all when every aid is off — which lets the view skip the whole
    /// attributed-text path and just draw the words.
    func aids(for block: BlockModel) -> BlockAids {
        ReadingAidsModel.isOn(aids) ? ReadingAidsModel.build(for: block, aids: aids) : .none
    }

    // MARK: - Turning pages

    var canGoBack: Bool { pageIndex > 0 }
    var canGoForward: Bool { pageIndex + 1 < pageCount }

    func goToPage(_ index: Int) async {
        guard index >= 0, index < pageCount, index != pageIndex else { return }
        stopSpeaking()
        pageIndex = index
        selection = nil
        if session?.pagesViewed.contains(index) == false { session?.pagesViewed.append(index) }
        await saveSession()
        await reloadPage()
        await reloadAnnotations()
        await savePosition()
    }

    func previousPage() async { await goToPage(pageIndex - 1) }
    func nextPage() async { await goToPage(pageIndex + 1) }

    /// Saves where the child is, a moment after they stop moving.
    ///
    /// Written as they read rather than when they close the book: a tablet that runs out of battery mid-chapter
    /// should not cost a child their place, and asking them to find it again is asking them to read the page twice.
    func savePosition(blockIndex: Int = 0, sentenceIndex: Int = 0) async {
        saveTask?.cancel()
        let documentId = documentId
        let childId = child.id
        let pageIndex = pageIndex
        saveTask = Task { [library] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            try? await library.recordPosition(
                childId: childId, documentId: documentId, pageIndex: pageIndex,
                blockIndex: blockIndex, sentenceIndex: sentenceIndex
            )
        }
    }

    // MARK: - Selecting text

    func block(at blockIndex: Int) -> BlockModel? {
        blocks.indices.contains(blockIndex) ? blocks[blockIndex] : nil
    }

    func selectWord(blockIndex: Int, offset: Int) {
        guard let block = block(at: blockIndex) else { return }
        selection = ReaderModel.selectWord(in: block, at: offset)
    }

    func extendSelectionToSentence() {
        guard let selection, let block = block(at: selection.blockIndex) else { return }
        self.selection = ReaderModel.sentenceRange(in: block, selection)
    }

    func extendSelectionToParagraph() {
        guard let selection, let block = block(at: selection.blockIndex) else { return }
        self.selection = ReaderModel.paragraphRange(of: block)
    }

    func extendSelection(backwards: Bool) {
        guard let selection, let block = block(at: selection.blockIndex) else { return }
        self.selection = backwards
            ? ReaderModel.extendToPreviousWord(in: block, selection)
            : ReaderModel.extendToNextWord(in: block, selection)
    }

    /// The text the child picked out.
    func selectedText() -> String? {
        guard let selection, let block = block(at: selection.blockIndex) else { return nil }
        let units = Array(block.text.utf16)
        guard selection.start >= 0, selection.end <= units.count, selection.start < selection.end else { return nil }
        return String(decoding: units[selection.start..<selection.end], as: UTF16.self)
    }

    /// What the help needs to know about the selection: the words, the sentence they sit in, the paragraph.
    func helpContext() -> HelpContext? {
        guard let selection, let block = block(at: selection.blockIndex), let document,
              let text = selectedText()
        else { return nil }
        let sentence = ReaderModel.sentence(in: block, at: selection.start)?.text ?? text
        let words = ReaderModel.words(in: block, from: selection.start, to: selection.end)
        return HelpContext(
            document: document,
            pageIndex: pageIndex,
            text: text,
            isSingleWord: words.count <= 1,
            sentence: sentence,
            paragraph: block.text,
            ocrLowConfidence: currentPage?.isLowConfidence ?? false
        )
    }

    /// For help about the book as a whole, where nothing in particular is selected.
    func bookContext() -> HelpContext? {
        guard let document else { return nil }
        return HelpContext(
            document: document, pageIndex: pageIndex, text: "", isSingleWord: false, sentence: "", paragraph: "",
            ocrLowConfidence: currentPage?.isLowConfidence ?? false
        )
    }

    // MARK: - Highlighting

    func highlight(_ range: ReaderRange, colour: String) async {
        guard let block = block(at: range.blockIndex) else { return }
        let units = Array(block.text.utf16)
        guard range.start >= 0, range.end <= units.count, range.start < range.end else { return }
        let now = Millis(Date().timeIntervalSince1970 * 1000)

        let highlight = TextHighlight(
            id: UUID().uuidString,
            childId: child.id,
            documentId: documentId,
            color: colour,
            pageIndex: pageIndex,
            blockIndex: range.blockIndex,
            start: range.start,
            end: range.end,
            blockTextHash: Anchoring.blockTextHash(block.text),
            text: String(decoding: units[range.start..<range.end], as: UTF16.self),
            createdAt: now,
            updatedAt: now
        )
        try? await library.save(.highlight(highlight))
        selection = nil
        await reloadAnnotations()
    }

    /// Takes back a highlight the child's selection lies inside.
    func removeHighlight(at range: ReaderRange) async {
        let touched = highlights.filter {
            $0.blockIndex == range.blockIndex && $0.start < range.end && $0.end > range.start
        }
        for highlight in touched {
            try? await library.markDeleted(.highlight(highlight))
        }
        selection = nil
        await reloadAnnotations()
    }

    func highlights(inBlock blockIndex: Int) -> [TextHighlight] {
        var shown = highlights.filter { $0.blockIndex == blockIndex }
        if let mark = quoteMark, mark.pageIndex == pageIndex, mark.blockIndex == blockIndex {
            // Drawn like a highlight, never saved as one: it is the app pointing, not the child marking.
            shown.append(TextHighlight(
                id: "quote-mark", childId: child.id, documentId: documentId, color: Self.quoteMarkColour,
                pageIndex: mark.pageIndex, blockIndex: mark.blockIndex, start: mark.start, end: mark.end,
                blockTextHash: "", text: "", createdAt: 0, updatedAt: 0
            ))
        }
        return shown
    }

    static let quoteMarkColour = "#ffd43b"
    static let quoteMarkSeconds: UInt64 = 8

    /// Marks a passage of the current page for a few seconds. False when its words are not on the page any more.
    @discardableResult
    func markQuote(_ quote: String) -> Bool {
        guard let page = currentPage, let range = QuoteFinder.find(quote, in: page) else { return false }
        quoteMark = range
        quoteMarkTask?.cancel()
        quoteMarkTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.quoteMarkSeconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.quoteMark = nil
        }
        return true
    }

    // MARK: - The pencil

    func save(stroke: InkAnnotation) async {
        try? await library.save(.ink(stroke))
        await reloadAnnotations()
    }

    func replace(stroke: InkAnnotation, with fragments: [[InkPoint]]) async {
        try? await library.markDeleted(.ink(stroke))
        let now = Millis(Date().timeIntervalSince1970 * 1000)
        for fragment in fragments where fragment.count >= 2 {
            var piece = stroke
            piece.id = UUID().uuidString
            piece.points = fragment
            piece.createdAt = now
            piece.updatedAt = now
            piece.deletedAt = nil
            try? await library.save(.ink(piece))
        }
        await reloadAnnotations()
    }

    func erase(stroke: InkAnnotation) async {
        try? await library.markDeleted(.ink(stroke))
        await reloadAnnotations()
    }

    func eraseEverythingOnThisPage() async {
        for stroke in strokes {
            try? await library.markDeleted(.ink(stroke))
        }
        await reloadAnnotations()
    }

    // MARK: - Reading aloud

    private func wireSpeech() {
        reader.onStateChange = { [weak self] state in
            Task { @MainActor in
                self?.speech = state
                self?.isSpeaking = state.activity == .speaking
                self?.noteSpeaking(state.activity == .speaking)
                if let position = SpeechQueue.position(fromItemId: state.itemId) {
                    await self?.savePosition(
                        blockIndex: position.blockIndex, sentenceIndex: position.sentenceIndex
                    )
                }
            }
        }
        reader.onFinished = { [weak self] in
            Task { @MainActor in
                self?.isSpeaking = false
                self?.speech = .idle
            }
        }
    }

    /// The whole page, sentence by sentence, in reading order.
    private func speechItems() -> [SpeechItem] {
        guard let page = currentPage else { return [] }
        return SpeechQueue.build(from: [PageModel(pageIndex: page.pageIndex, status: page.status, blocks: blocks)])
    }

    func startSpeaking(fromItemId itemId: String? = nil) {
        let items = speechItems()
        guard !items.isEmpty else { return }
        let start = itemId.flatMap { id in items.firstIndex { $0.id == id } } ?? 0
        reader.speak(items: items, from: start, preferences: tts, voiceIdentifier: voiceIdentifier)
        isSpeaking = true
    }

    /// Reads one piece out loud on its own, without disturbing where the child was in the page.
    func speakOnce(_ text: String) {
        guard !text.isEmpty else { return }
        reader.speak(
            items: [SpeechItem(id: "once", text: text, spoken: nil)],
            preferences: tts,
            voiceIdentifier: voiceIdentifier
        )
    }

    func pauseSpeaking() { reader.pause() }
    func resumeSpeaking() { reader.resume() }
    func stopSpeaking() {
        reader.stop()
        isSpeaking = false
        speech = .idle
    }

    func speakNext() { reader.next() }
    func speakPrevious() { reader.previous() }

    func chooseVoice(_ identifier: String?) async {
        voiceIdentifier = identifier
        try? await library.setValue(identifier, forKey: AppKeys.voiceIdentifier)
    }

    var currentVoiceIdentifier: String? { voiceIdentifier }

    // MARK: - Settings

    /// Saves the child's settings, which the parent set and the child may adjust here.
    ///
    /// They are part of the profile rather than of this device: a child who found a size that works should find it
    /// again on the other iPad, not start over.
    func saveSettings() async -> ChildProfile? {
        var updated = child
        var reading = self.reading
        reading.aids = aids
        updated.reading = reading
        updated.tts = tts
        updated.updatedAt = Millis(Date().timeIntervalSince1970 * 1000)
        try? await library.save(updated)
        return updated
    }

    func resetSettings() {
        reading = .standard
        tts = .standard
        aids = .none
    }
}
