#if canImport(Vision)
import CoreGraphics
import Foundation
@preconcurrency import Vision

/// Reading a page image with the device's own engine.
///
/// On-device on purpose. A page a child scans is their homework, their reading book, sometimes their name and their
/// school on the first line — none of which has any reason to leave the iPad. Vision reads it here, offline, and the
/// image never goes anywhere.
public enum VisionOcr {
    public enum Failure: Error {
        case failed(String)
    }

    /// Languages asked for, in order of preference. French first, because that is what the app is for; English
    /// second, because a French schoolbook has English in it often enough to matter.
    public static let languages = ["fr-FR", "en-US"]

    /// Reads a page image.
    ///
    /// - Parameter correctLanguage: Vision's own language correction, which fixes what it read against a lexicon.
    ///   On for a printed page. It is worth turning off for a page of a child's own handwriting, where « correcting »
    ///   an invented spelling would hide exactly what a parent needs to see.
    public static func read(
        _ image: CGImage, correctLanguage: Bool = true, extraWords: [String] = []
    ) async throws -> OcrResult {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = correctLanguage
        request.recognitionLanguages = languages
        if !extraWords.isEmpty { request.customWords = extraWords }

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        let width = Double(image.width)
        let height = Double(image.height)

        // Run on a background queue and read the results back, rather than through the request's own completion
        // handler: `perform` can both call that handler and throw, and a continuation resumed twice is a crash.
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try handler.perform([request])
                    continuation.resume(returning: result(
                        from: request.results ?? [], width: width, height: height
                    ))
                } catch {
                    continuation.resume(throwing: Failure.failed(error.localizedDescription))
                }
            }
        }
    }

    /// Turns what Vision saw into the lines the rest of the app works with.
    ///
    /// Vision measures everything from the bottom left corner in fractions of the image; every other part of this app
    /// counts pixels from the top left. The conversion happens here, once, rather than in each place that would
    /// otherwise have to remember.
    static func result(
        from observations: [VNRecognizedTextObservation], width: Double, height: Double
    ) -> OcrResult {
        var lines: [OcrLine] = []
        var total = 0.0
        var counted = 0

        for observation in observations {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            let box = observation.boundingBox
            let confidence = OcrCleanup.clampConfidence(Double(candidate.confidence) * 100)
            total += confidence
            counted += 1

            let line = OcrLine(
                text: text,
                top: (1 - box.maxY) * height,
                left: box.minX * width,
                height: max(box.height * height, 1),
                words: words(of: candidate, confidence: confidence, width: width)
            )
            if let cleaned = OcrCleanup.removeDebris(from: line) { lines.append(cleaned) }
        }

        // Reading order, not the order Vision happened to return them in.
        lines.sort { $0.top != $1.top ? $0.top < $1.top : $0.left < $1.left }
        return OcrResult(lines: lines, confidence: counted == 0 ? 0 : total / Double(counted))
    }

    /// The words of a line with where each one sits across it.
    ///
    /// Vision scores a whole line rather than each word, so every word of a line carries the line's confidence. The
    /// horizontal extents are real, though, and they are what the edge-debris cleanup needs: a stray mark is told
    /// from a word by the gap in front of it, not by its score.
    private static func words(
        of candidate: VNRecognizedText, confidence: Double, width: Double
    ) -> [OcrWord] {
        let text = candidate.string
        var words: [OcrWord] = []

        for piece in text.split(whereSeparator: { $0.isWhitespace }) {
            guard !piece.isEmpty else { continue }
            var left: Double?
            var right: Double?
            if let box = try? candidate.boundingBox(for: piece.startIndex..<piece.endIndex) {
                left = box.boundingBox.minX * width
                right = box.boundingBox.maxX * width
            }
            words.append(OcrWord(text: String(piece), confidence: confidence, left: left, right: right))
        }
        return words
    }

    /// Reads a page image and turns it straight into a stored page.
    public static func page(
        _ image: CGImage,
        documentId: String,
        pageIndex: Int,
        wordList: WordList?,
        correctLanguage: Bool = true,
        now: Millis
    ) async throws -> PageContent {
        let result = try await read(image, correctLanguage: correctLanguage)
        let quality = OcrQuality.score(lines: result.lines, pageConfidence: result.confidence, against: wordList)
        return DocumentParser.page(
            documentId: documentId,
            pageIndex: pageIndex,
            blocks: DocumentParser.blocks(fromOcrLines: result.lines),
            quality: quality,
            source: .ocrLocal,
            size: (width: Double(image.width), height: Double(image.height)),
            now: now
        )
    }
}
#endif
