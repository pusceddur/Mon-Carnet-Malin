#if canImport(UIKit)
import CarnetKit
import PDFKit
import UIKit

/// Turning pages into the JPEGs the app keeps and sends.
enum PageImaging {
    /// Longest side of a stored page, as the server expects (`ocrImageMaxSidePx`). Enough for a small print to be
    /// read by a machine, small enough to go up over a school's Wi-Fi.
    static let maxSide: CGFloat = 2480
    /// The server's ceiling for one page image.
    static let maxBytes = 5 * 1024 * 1024

    /// A page as a JPEG: scaled down if needed, and without any metadata.
    ///
    /// Drawn afresh into a new context rather than re-encoded, which is what drops EXIF — the location a photo was
    /// taken at has no business travelling with a child's homework.
    static func jpeg(from image: CGImage) -> Data? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        guard width > 0, height > 0 else { return nil }
        let scale = min(1, maxSide / max(width, height))
        let size = CGSize(width: floor(width * scale), height: floor(height * scale))

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIImage(cgImage: image).draw(in: CGRect(origin: .zero, size: size))
        }

        // Lower the quality until it fits, rather than refuse a page because it is dense.
        for quality in stride(from: 0.82, through: 0.4, by: -0.14) {
            if let data = rendered.jpegData(compressionQuality: quality), data.count <= maxBytes { return data }
        }
        return nil
    }

    /// A page of a PDF drawn as an image, for the scans the PDF carries no text for.
    static func render(_ page: PDFPage) -> CGImage? {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        // A scanned page is usually 200 to 300 dpi inside a 72-point box: draw it at about that density.
        let scale = min(maxSide / max(bounds.width, bounds.height), 300.0 / 72.0)
        let size = CGSize(width: floor(bounds.width * scale), height: floor(bounds.height * scale))

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            context.cgContext.translateBy(x: 0, y: size.height)
            context.cgContext.scaleBy(x: scale, y: -scale)
            page.draw(with: .mediaBox, to: context.cgContext)
        }
        return image.cgImage
    }
}
#endif
