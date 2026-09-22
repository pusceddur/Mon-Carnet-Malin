#if canImport(Security)
import Foundation
import Security

/// The session token, kept in the Keychain.
///
/// It goes here rather than in `UserDefaults` because it is exactly as good as the family's password: anything
/// holding it can read every book, every note and every page of a child's homework. `UserDefaults` is a plain file
/// in the app's container, readable from a backup of an unlocked device.
///
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: the app needs it to sync in the background, so it cannot wait
/// for the screen to be unlocked every time — but it never leaves this device, and never travels in an iCloud backup
/// to another one.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String
    private let account: String
    private let lock = NSLock()
    /// The last value read or written. The Keychain is asked once, not on every request.
    private var cached: String??

    public init(service: String = "org.carnetmalin.app", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func read() -> String? {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }

        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8),
              !token.isEmpty
        else {
            cached = .some(nil)
            return nil
        }
        cached = token
        return token
    }

    public func write(_ token: String?) {
        lock.lock()
        defer { lock.unlock() }
        cached = token

        guard let token, !token.isEmpty else {
            SecItemDelete(query as CFDictionary)
            return
        }

        let data = Data(token.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard updated != errSecSuccess else { return }

        // Nothing to update: add it. A stale item of any other kind is cleared first, because a half-written one
        // would otherwise sign the family out on every launch with no way to tell them why.
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    /// Forgets what was read, so the next read goes back to the Keychain. For the tests and for a sign-out that
    /// happened elsewhere.
    public func invalidateCache() {
        lock.lock()
        defer { lock.unlock() }
        cached = nil
    }
}
#endif
