import Foundation

/// An optional that is written as `null` rather than left out.
///
/// The server validates every row with `.nullable()`: the key must be there, and its value may be null. Swift's own
/// `Codable` does the opposite — it leaves a `nil` field out entirely — and a row written that way is refused by the
/// sync as `invalid`. Nothing on the iPad would notice: the row would sit in the outbox, be sent, be refused, and the
/// change a child or a parent made would simply never reach any other device.
///
/// Fields the server declares `optional()` instead (like `TextBlock.spoken`) must keep the default behaviour and do
/// not use this.
@propertyWrapper
public struct NullCodable<Wrapped: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public var wrappedValue: Wrapped?

    public init(wrappedValue: Wrapped?) {
        self.wrappedValue = wrappedValue
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        wrappedValue = container.decodeNil() ? nil : try container.decode(Wrapped.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue {
            try container.encode(wrappedValue)
        } else {
            try container.encodeNil()
        }
    }
}

extension KeyedDecodingContainer {
    /// A missing key reads as `nil` rather than as an error, so rows written by an older server still open.
    public func decode<Wrapped>(_ type: NullCodable<Wrapped>.Type, forKey key: Key) throws -> NullCodable<Wrapped> {
        try decodeIfPresent(type, forKey: key) ?? NullCodable(wrappedValue: nil)
    }
}
