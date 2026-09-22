import Foundation

/// The sync as it really travels: `POST /api/sync` (§15.2).
///
/// It is written against the raw JSON rather than against typed rows on purpose. A field added to a book on the
/// server, in a version of the app the family has not installed yet, has to travel through this device untouched
/// rather than be dropped on the way — otherwise the iPad that syncs least often quietly erases what the others did.
public struct APISyncTransport: SyncTransport {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func exchange(
        cursor: String?, deviceId: String, changes: [SyncTable: [Data]]
    ) async throws -> SyncResponse {
        try await api.sync(cursor: cursor, deviceId: deviceId, changes: changes)
    }
}

extension APIClient {
    /// One round of the sync.
    ///
    /// Every table is sent, empty ones included: the server reads the request as the whole shape of a push, and a
    /// missing key is not the same thing as an empty list.
    public func sync(
        cursor: String?, deviceId: String, changes: [SyncTable: [Data]]
    ) async throws -> SyncResponse {
        var body = Data()
        body.append(Data("{\"cursor\":".utf8))
        body.append(Data((cursor.map { Self.jsonString($0) } ?? "null").utf8))
        body.append(Data(",\"deviceId\":\(Self.jsonString(deviceId)),\"changes\":{".utf8))

        for (index, table) in SyncTable.allCases.enumerated() {
            if index > 0 { body.append(Data(",".utf8)) }
            body.append(Data("\(Self.jsonString(table.rawValue)):[".utf8))
            for (rowIndex, row) in (changes[table] ?? []).enumerated() {
                if rowIndex > 0 { body.append(Data(",".utf8)) }
                body.append(row)
            }
            body.append(Data("]".utf8))
        }
        body.append(Data("}}".utf8))

        // A long timeout: a first sync of a whole shelf of books is a big answer over a home connection, and
        // failing it halfway would mean starting again from nothing.
        let data = try await performRaw(
            path: "/api/sync", body: body, contentType: "application/json", timeout: 120
        )
        return try Self.decodeSyncResponse(data)
    }

    static func jsonString(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }

    /// Reads the answer, keeping each row as the bytes the server sent.
    static func decodeSyncResponse(_ data: Data) throws -> SyncResponse {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cursor = object["cursor"] as? String
        else { throw APIError.invalidResponse }

        let hasMore = object["hasMore"] as? Bool ?? false
        let serverTime = (object["serverTime"] as? NSNumber)?.int64Value ?? 0

        var changes: [SyncTable: [Data]] = [:]
        if let raw = object["changes"] as? [String: Any] {
            for table in SyncTable.allCases {
                guard let rows = raw[table.rawValue] as? [Any] else { continue }
                changes[table] = rows.compactMap {
                    try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed])
                }
            }
        }

        var rejected: [SyncRejection] = []
        if let raw = object["rejected"] as? [[String: Any]] {
            for item in raw {
                guard let table = (item["table"] as? String).flatMap(SyncTable.init(rawValue:)),
                      let key = item["entityKey"] as? String,
                      let reason = (item["reason"] as? String).flatMap(SyncRejectionReason.init(rawValue:))
                else { continue }
                rejected.append(SyncRejection(table: table, entityKey: key, reason: reason))
            }
        }

        return SyncResponse(
            cursor: cursor, hasMore: hasMore, serverTime: serverTime, changes: changes, rejected: rejected
        )
    }
}
