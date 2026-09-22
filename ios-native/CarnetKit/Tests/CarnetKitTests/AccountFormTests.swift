@testable import CarnetKit
import XCTest

final class AccountFormTests: XCTestCase {
    private func filled(_ mode: AccountForm.Mode) -> AccountForm {
        var form = AccountForm(mode: mode)
        form.code = mode == .register ? " K7QM-3FXA-9TRD " : "setup-code"
        form.displayName = "  Camille "
        form.email = " Camille@Example.org "
        form.password = "un long mot de passe"
        form.passwordConfirm = form.password
        form.pin = "482913"
        form.pinConfirm = "482913"
        return form
    }

    func testAFilledFormHasNothingToFix() {
        XCTAssertEqual(filled(.register).problems, [:])
        XCTAssertEqual(filled(.setup).problems, [:])
    }

    func testEveryFieldIsRequired() {
        let problems = AccountForm(mode: .register).problems
        XCTAssertEqual(problems[.code], AccountForm.Messages.required)
        XCTAssertEqual(problems[.displayName], AccountForm.Messages.required)
        XCTAssertEqual(problems[.email], AccountForm.Messages.required)
        XCTAssertEqual(problems[.password], AccountForm.Messages.passwordLength)
        XCTAssertEqual(problems[.pin], AccountForm.Messages.pinFormat)
    }

    func testConfirmationsMustMatch() {
        var form = filled(.register)
        form.passwordConfirm = "autre chose encore"
        form.pinConfirm = "482914"
        XCTAssertEqual(form.problems[.passwordConfirm], AccountForm.Messages.passwordMismatch)
        XCTAssertEqual(form.problems[.pinConfirm], AccountForm.Messages.pinMismatch)
    }

    func testInvitationCodeFormat() {
        XCTAssertTrue(AccountForm.isInviteCode("K7QM-3FXA-9TRD"))
        XCTAssertTrue(AccountForm.isInviteCode("abcdefgh"))
        XCTAssertFalse(AccountForm.isInviteCode("abc"))
        XCTAssertFalse(AccountForm.isInviteCode("K7QM 3FXA"))
        XCTAssertFalse(AccountForm.isInviteCode("CODE_AVEC_É"))
        // The setup code has no format of its own: the server compares it to the one it was given.
        var setup = filled(.setup)
        setup.code = "x"
        XCTAssertNil(setup.problems[.code])
    }

    func testPinAndEmail() {
        XCTAssertTrue(AccountForm.isPin("1234"))
        XCTAssertTrue(AccountForm.isPin("12345678"))
        XCTAssertFalse(AccountForm.isPin("123"))
        XCTAssertFalse(AccountForm.isPin("123456789"))
        XCTAssertFalse(AccountForm.isPin("12a4"))
        XCTAssertFalse(AccountForm.isPin("١٢٣٤"))
        XCTAssertTrue(AccountForm.isEmail("a@b.fr"))
        XCTAssertFalse(AccountForm.isEmail("a@b"))
        XCTAssertFalse(AccountForm.isEmail("a b@c.fr"))
        XCTAssertFalse(AccountForm.isEmail("@c.fr"))
        XCTAssertFalse(AccountForm.isEmail("a@@c.fr"))
    }

    func testAShortCodeIsAWarningNotAnError() {
        var form = filled(.register)
        form.pin = "4829"
        form.pinConfirm = "4829"
        XCTAssertEqual(form.problems, [:])
        XCTAssertEqual(form.pinWarning, AccountForm.Messages.pinShort)
        XCTAssertNil(filled(.register).pinWarning)
    }

    func testTheBodyIsCleanedLikeTheWebOne() {
        XCTAssertEqual(filled(.register).body, [
            "inviteCode": "K7QM-3FXA-9TRD", "displayName": "Camille", "email": "camille@example.org",
            "password": "un long mot de passe", "pin": "482913",
        ])
        XCTAssertEqual(filled(.setup).body["setupToken"], "setup-code")
        XCTAssertNil(filled(.setup).body["inviteCode"])
    }
}
