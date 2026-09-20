import Capacitor
import Foundation
import UIKit
import VisionKit

/// The document camera of iPadOS: it finds the edges of the page, straightens the perspective and cleans the image,
/// which a photo taken through the web view cannot do. Several pages can be scanned in one go.
///
/// `scan` resolves with the pages as JPEG, in the order they were scanned, or with `cancelled` when the parent closes
/// the camera. It never rejects for a cancellation: closing the camera is a normal answer, not a failure.
@objc(DocumentScannerPlugin)
public class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocumentScannerPlugin"
    public let jsName = "DocumentScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    /// Quality of the returned JPEG: high enough for the text to stay readable, low enough to keep the pages small.
    private static let defaultQuality: CGFloat = 0.85
    /// Longest side of a returned page, in pixels. Above this the text gains nothing and the memory cost grows fast.
    private static let defaultMaxSide: CGFloat = 2480

    /// The call waiting for the camera to close. Main thread only.
    private var pendingCall: CAPPluginCall?
    private var quality: CGFloat = DocumentScannerPlugin.defaultQuality
    private var maxSide: CGFloat = DocumentScannerPlugin.defaultMaxSide

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("The document camera is not available on this device", "unavailable")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.pendingCall != nil {
                call.reject("A scan is already open", "busy")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller to present the camera from", "unavailable")
                return
            }
            self.quality = CGFloat(call.getDouble("quality") ?? Double(DocumentScannerPlugin.defaultQuality))
            self.maxSide = CGFloat(call.getInt("maxSide") ?? Int(DocumentScannerPlugin.defaultMaxSide))
            self.pendingCall = call
            call.keepAlive = true

            let camera = VNDocumentCameraViewController()
            camera.delegate = self
            camera.modalPresentationStyle = .fullScreen
            presenter.present(camera, animated: true)
        }
    }

    // MARK: - Delegate

    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        // The images are encoded before the camera is dismissed, so a page is never lost while the view goes away.
        var pages: [[String: Any]] = []
        for index in 0..<scan.pageCount {
            let image = scan.imageOfPage(at: index)
            guard let page = encode(image) else { continue }
            pages.append(page)
        }
        controller.dismiss(animated: true) { [weak self] in
            self?.finish(["cancelled": false, "pages": pages])
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true) { [weak self] in
            self?.finish(["cancelled": true, "pages": []])
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true) { [weak self] in
            guard let self, let call = self.pendingCall else { return }
            self.pendingCall = nil
            call.keepAlive = false
            call.reject(error.localizedDescription, "scan_failed", error)
        }
    }

    // MARK: - Helpers

    private func finish(_ result: [String: Any]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        call.keepAlive = false
        call.resolve(result)
    }

    /// JPEG of a scanned page, scaled down when it is larger than `maxSide`, with its size in pixels.
    private func encode(_ image: UIImage) -> [String: Any]? {
        let scaled = downscaled(image)
        guard let data = scaled.jpegData(compressionQuality: quality) else { return nil }
        return [
            "base64": data.base64EncodedString(),
            "mediaType": "image/jpeg",
            "width": Int(scaled.size.width * scaled.scale),
            "height": Int(scaled.size.height * scaled.scale)
        ]
    }

    private func downscaled(_ image: UIImage) -> UIImage {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        let longest = max(pixelWidth, pixelHeight)
        guard longest > maxSide, maxSide > 0 else { return image }
        let ratio = maxSide / longest
        let target = CGSize(width: (pixelWidth * ratio).rounded(), height: (pixelHeight * ratio).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
