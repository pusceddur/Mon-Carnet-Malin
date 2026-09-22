@testable import CarnetKit
import XCTest

final class DiagnosticsTests: XCTestCase {
    private enum Broken: Error { case engine, page(Int) }

    /// Keeps what was sent, batch by batch.
    private actor Outbox {
        var batches: [[ClientDiagnosticReport]] = []
        func add(_ batch: [ClientDiagnosticReport]) { batches.append(batch) }
    }

    private func make(_ outbox: Outbox, device: [String: ClientDiagnosticReport.Value] = [:]) -> Diagnostics {
        Diagnostics(userAgent: "CarnetMalin/1.0 iPadOS/17.4", device: device, now: { 1_000 }) { batch in
            await outbox.add(batch)
            return true
        }
    }

    func testTheSameProblemIsReportedOncePerSession() async {
        let outbox = Outbox()
        let diagnostics = make(outbox)
        await diagnostics.report(.ocrEngine, Broken.engine, stage: "recognize")
        await diagnostics.report(.ocrEngine, Broken.engine, stage: "recognize")
        await diagnostics.report(.ocrEngine, Broken.engine, stage: "recognize", context: ["final": .bool(true)])
        await diagnostics.report(.ocrEngine, Broken.engine, stage: "other_stage")
        let pending = await diagnostics.pending
        XCTAssertEqual(pending.count, 3)
        XCTAssertEqual(pending.first?.message, "Broken: engine")
        XCTAssertEqual(pending.first?.occurredAt, 1_000)
    }

    func testBatchesStayWithinTheServerLimitAndTheSessionCap() async {
        let outbox = Outbox()
        let diagnostics = make(outbox)
        for index in 0..<100 { await diagnostics.report(.processingFailed, Broken.page(index)) }
        await diagnostics.flush()
        let batches = await outbox.batches
        XCTAssertEqual(batches.map(\.count), [20, 20, 20])
        // The cap counts what was already sent.
        await diagnostics.report(.processingFailed, Broken.page(500))
        let pending = await diagnostics.pending
        XCTAssertEqual(pending, [])
    }

    func testTextIsCutToTheServerLimitsInUTF16Units() async {
        let outbox = Outbox()
        let long = String(repeating: "é", count: 600)
        let diagnostics = make(outbox, device: ["appareil": .string(String(repeating: "x", count: 300))])
        await diagnostics.report(
            .other, message: long, stage: String(repeating: "s", count: 50),
            context: [String(repeating: "k", count: 60): .number(1)]
        )
        let report = await diagnostics.pending.first
        XCTAssertEqual(report?.message.utf16.count, DiagnosticLimits.messageMax)
        XCTAssertEqual(report?.message.hasSuffix("…"), true)
        XCTAssertEqual(report?.stage?.utf16.count, DiagnosticLimits.stageMax)
        XCTAssertEqual(report?.context["appareil"], .string(String(repeating: "x", count: 199) + "…"))
        XCTAssertEqual(report?.context[String(repeating: "k", count: 39) + "…"], .number(1))
    }

    func testAtMostThirtyContextKeys() async {
        let outbox = Outbox()
        let diagnostics = make(outbox)
        var context: [String: ClientDiagnosticReport.Value] = [:]
        for index in 0..<40 { context["key\(index)"] = .number(Double(index)) }
        await diagnostics.report(.other, message: "x", context: context)
        let report = await diagnostics.pending.first
        XCTAssertEqual(report?.context.count, DiagnosticLimits.contextKeysMax)
    }

    func testTheWireFormatKeepsNullKeys() throws {
        let report = ClientDiagnosticReport(
            kind: .ocrEngine, message: "m", stage: nil,
            context: ["ok": .bool(true), "none": .null, "infinite": .number(.infinity), "n": .number(2)],
            userAgent: "ua", occurredAt: 5
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let json = String(decoding: try encoder.encode(report), as: UTF8.self)
        XCTAssertEqual(
            json,
            #"{"context":{"infinite":null,"n":2,"none":null,"ok":true},"kind":"ocr_engine","message":"m","#
                + #""occurredAt":5,"stage":null,"userAgent":"ua"}"#
        )
    }

    func testFrameworkErrorsGiveDomainAndCodeOnly() {
        let error = NSError(
            domain: NSCocoaErrorDomain, code: 260,
            userInfo: [NSFilePathErrorKey: "/private/var/Inbox/Devoir de Léa.pdf"]
        )
        let described = Diagnostics.describe(error)
        XCTAssertEqual(described, "NSError: NSCocoaErrorDomain 260")
        XCTAssertFalse(described.contains("Léa"))
    }
}
