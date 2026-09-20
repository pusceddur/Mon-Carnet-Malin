// swift-tools-version: 5.9
import PackageDescription

// The package name must match the name derived by the Capacitor CLI from the npm name (carnet-file-import).
let package = Package(
    name: "CarnetFileImport",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CarnetFileImport",
            targets: ["FileImportPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "FileImportPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/FileImportPlugin")
    ]
)
