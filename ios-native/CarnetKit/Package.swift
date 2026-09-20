// swift-tools-version: 5.9
import PackageDescription

// Portable core of the native app: the domain, the client of the existing API, and (later) the French text engine.
// It is a package and not an app target on purpose: `swift test` runs it without opening Xcode, so every piece can be
// checked on its own before the interface exists.
let package = Package(
    name: "CarnetKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CarnetKit", targets: ["CarnetKit"])
    ],
    targets: [
        .target(name: "CarnetKit"),
        .testTarget(name: "CarnetKitTests", dependencies: ["CarnetKit"])
    ]
)
