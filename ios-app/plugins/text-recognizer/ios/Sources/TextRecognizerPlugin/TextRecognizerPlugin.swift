import Capacitor
import Foundation
import UIKit
import Vision

/// On-device text recognition (Vision). Inside the app this replaces the WebAssembly OCR: it reads French better,
/// costs no download, and runs on the Neural Engine instead of the web view's main thread.
///
/// The answer has the same shape as the engine it replaces (`client/src/ocr/ocrLines.ts`): lines with their position in
/// image pixels and the words they contain, plus a mean confidence on 0..100.
@objc(TextRecognizerPlugin)
public class TextRecognizerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextRecognizerPlugin"
    public let jsName = "TextRecognizer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    /// Reading a page is slow enough to deserve its own queue, and serial so that two pages never compete for the ANE.
    private let queue = DispatchQueue(label: "app.carnetmalin.textrecognizer", qos: .userInitiated)

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "languages": TextRecognizerPlugin.supportedLanguages()
        ])
    }

    @objc func recognize(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"), let data = Data(base64Encoded: base64) else {
            call.reject("base64 is required", "invalid_image")
            return
        }
        guard let image = UIImage(data: data), let cgImage = image.cgImage else {
            call.reject("The image could not be read", "invalid_image")
            return
        }
        let languages = call.getArray("languages", String.self) ?? ["fr-FR"]
        let fast = call.getBool("fast") ?? false

        queue.async { [weak self] in
            guard let self else { return }
            do {
                let lines = try self.read(cgImage, languages: languages, fast: fast)
                call.resolve([
                    "lines": lines.map { $0.payload },
                    "confidence": TextRecognizerPlugin.meanConfidence(lines),
                    "engine": "vision",
                    "width": cgImage.width,
                    "height": cgImage.height
                ])
            } catch {
                call.reject(error.localizedDescription, "recognition_failed", error)
            }
        }
    }

    // MARK: - Recognition

    private struct Line {
        let text: String
        let top: Int
        let left: Int
        let height: Int
        let confidence: Double
        let words: [[String: Any]]

        var payload: [String: Any] {
            ["text": text, "top": top, "left": left, "height": height, "confidence": confidence, "words": words]
        }
    }

    private func read(_ image: CGImage, languages: [String], fast: Bool) throws -> [Line] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = fast ? .fast : .accurate
        // The app reads school books: the language model fixes far more than it breaks.
        request.usesLanguageCorrection = true
        request.recognitionLanguages = languages
        if #available(iOS 16.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
        }

        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])

        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let observations = request.results ?? []
        return observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string
            guard !text.isEmpty else { return nil }
            let box = TextRecognizerPlugin.pixelRect(observation.boundingBox, width: width, height: height)
            return Line(
                text: text,
                top: Int(box.origin.y.rounded()),
                left: Int(box.origin.x.rounded()),
                height: Int(box.size.height.rounded()),
                confidence: Double(candidate.confidence) * 100,
                words: TextRecognizerPlugin.words(of: candidate, width: width, height: height)
            )
        }
    }

    /// Words of a line with their horizontal extent, taken from the recognized text itself so that the ranges stay valid.
    private static func words(of candidate: VNRecognizedText, width: CGFloat, height: CGFloat) -> [[String: Any]] {
        let text = candidate.string
        let confidence = Double(candidate.confidence) * 100
        var result: [[String: Any]] = []
        for range in wordRanges(of: text) {
            var word: [String: Any] = ["text": String(text[range]), "confidence": confidence]
            // Vision can place any sub-range of what it read; when it cannot, the word keeps its text without a position.
            if let observation = try? candidate.boundingBox(for: range) {
                let box = pixelRect(observation.boundingBox, width: width, height: height)
                word["left"] = Int(box.origin.x.rounded())
                word["right"] = Int((box.origin.x + box.size.width).rounded())
            }
            result.append(word)
        }
        return result
    }

    /// Ranges of the words of a line: anything separated by whitespace, keeping hyphens and apostrophes inside the word.
    private static func wordRanges(of text: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var start: String.Index?
        for index in text.indices {
            if text[index].isWhitespace {
                if let from = start { ranges.append(from..<index) }
                start = nil
            } else if start == nil {
                start = index
            }
        }
        if let from = start { ranges.append(from..<text.endIndex) }
        return ranges
    }

    /// Vision works in a 0..1 box whose origin is the bottom-left corner; the app works in pixels from the top-left one.
    private static func pixelRect(_ box: CGRect, width: CGFloat, height: CGFloat) -> CGRect {
        CGRect(
            x: box.minX * width,
            y: (1 - box.maxY) * height,
            width: box.width * width,
            height: box.height * height
        )
    }

    private static func meanConfidence(_ lines: [Line]) -> Double {
        guard !lines.isEmpty else { return 0 }
        return lines.reduce(0.0) { $0 + $1.confidence } / Double(lines.count)
    }

    private static func supportedLanguages() -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        if #available(iOS 16.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
        }
        return (try? request.supportedRecognitionLanguages()) ?? []
    }
}
