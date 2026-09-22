import CarnetKit
import SwiftUI

#if canImport(UIKit)
import UIKit

/// « Voir la page originale »: the photograph of the page, beside the text the machine read from it.
///
/// This is how a child checks a word that looks wrong. When the text says « la maisan », the original settles
/// whether the book or the machine made the mistake — and knowing it was the machine is worth a lot to a child who
/// assumes, by default, that it was them.
struct OriginalPageView: View {
    let documentId: String
    let pageIndex: Int

    @EnvironmentObject private var model: AppModel
    @State private var image: UIImage?
    @State private var isLoading = true

    var body: some View {
        Group {
            if let image {
                ZoomableImageView(image: image)
                    .accessibilityLabel(FR.format("Photo de la page {page}", ["page": String(pageIndex + 1)]))
            } else if isLoading {
                LoadingView(message: "Je charge l’image…")
            } else {
                EmptyStateView(
                    icon: "photo",
                    title: FR.Reader.originalTitle,
                    message: FR.Reader.originalUnavailable
                )
                .frame(maxHeight: .infinity)
            }
        }
        .task(id: "\(documentId):\(pageIndex)") { await load() }
    }

    /// From the iPad first; from the server when the page was scanned somewhere else, and then kept here.
    private func load() async {
        isLoading = true
        image = nil
        defer { isLoading = false }

        let store = PageImageStore.standard()
        if let data = store?.image(documentId: documentId, pageIndex: pageIndex), let local = UIImage(data: data) {
            image = local
            return
        }
        guard let api = model.services?.api,
              let data = await api.pageImage(documentId: documentId, pageIndex: pageIndex),
              let remote = UIImage(data: data)
        else { return }
        image = remote
        try? store?.save(data, documentId: documentId, pageIndex: pageIndex)
    }
}

/// An image that pinches to zoom and pans, starting fitted to the screen.
struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 5
        scroll.bouncesZoom = true
        scroll.showsHorizontalScrollIndicator = false
        scroll.backgroundColor = .secondarySystemBackground

        // The zoomed view must be a container, not the image view itself: the image view is sized to fit, and
        // zooming it directly would scale from a frame the scroll view does not know about.
        let container = UIView()
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: container.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        scroll.addSubview(container)
        context.coordinator.container = container
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.toggleZoom(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        if context.coordinator.imageView?.image !== image {
            context.coordinator.imageView?.image = image
            scroll.zoomScale = 1
        }
        context.coordinator.layout(in: scroll)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var container: UIView?
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { container }

        func scrollViewDidZoom(_ scrollView: UIScrollView) { center(in: scrollView) }

        /// Fits the page to the width of the screen, keeping its proportions.
        func layout(in scroll: UIScrollView) {
            guard let container, let image = imageView?.image, scroll.bounds.width > 0,
                  image.size.width > 0, scroll.zoomScale == 1
            else { return }
            let width = scroll.bounds.width
            let height = width * image.size.height / image.size.width
            container.frame = CGRect(x: 0, y: 0, width: width, height: height)
            scroll.contentSize = container.frame.size
            center(in: scroll)
        }

        private func center(in scroll: UIScrollView) {
            guard let container else { return }
            let horizontal = max(0, (scroll.bounds.width - container.frame.width) / 2)
            let vertical = max(0, (scroll.bounds.height - container.frame.height) / 2)
            scroll.contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
        }

        @objc func toggleZoom(_ recognizer: UITapGestureRecognizer) {
            guard let scroll = recognizer.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 {
                scroll.setZoomScale(1, animated: true)
            } else {
                let point = recognizer.location(in: container)
                let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                scroll.zoom(
                    to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width,
                               height: size.height),
                    animated: true
                )
            }
        }
    }
}
#endif
