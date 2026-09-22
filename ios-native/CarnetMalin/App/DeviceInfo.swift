import CarnetKit
import Foundation

#if canImport(UIKit)
import UIKit
#endif

/// What the diagnostics say about this device: enough to tell an old iPad from a new one, nothing about who uses it.
/// No device name (« L’iPad de Léa »), no identifier.
enum DeviceInfo {
    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    @MainActor
    static var userAgent: String {
        #if canImport(UIKit)
        let device = UIDevice.current
        return "CarnetMalin/\(appVersion) \(device.systemName)/\(device.systemVersion) (\(device.model))"
        #else
        return "CarnetMalin/\(appVersion)"
        #endif
    }

    @MainActor
    static var flags: [String: ClientDiagnosticReport.Value] {
        var flags: [String: ClientDiagnosticReport.Value] = [
            "native": .bool(true),
            "app": .string(appVersion),
            "memoryGB": .number((Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824).rounded()),
            "cores": .number(Double(ProcessInfo.processInfo.activeProcessorCount)),
            "lowPower": .bool(ProcessInfo.processInfo.isLowPowerModeEnabled),
        ]
        #if canImport(UIKit)
        flags["ipad"] = .bool(UIDevice.current.userInterfaceIdiom == .pad)
        flags["system"] = .string(UIDevice.current.systemVersion)
        #endif
        return flags
    }
}
