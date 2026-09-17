// swift-tools-version: 5.9
import PackageDescription

// The package name must match the name derived by the Capacitor CLI from the npm name (carnet-native-speech).
let package = Package(
    name: "CarnetNativeSpeech",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CarnetNativeSpeech",
            targets: ["NativeSpeechPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "NativeSpeechPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/NativeSpeechPlugin")
    ]
)
