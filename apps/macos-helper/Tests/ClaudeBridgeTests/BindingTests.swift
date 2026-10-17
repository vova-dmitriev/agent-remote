import XCTest
@testable import ClaudeBridge
final class BindingTests: XCTestCase {
 func testEmptyBrowserParagraphIsNotAUserDraftButWhitespaceDraftsArePreserved() throws {
  let state = BindingState(identity:"chat",process:"process",composer:"input")
  XCTAssertNoThrow(try state.validate(identity:"chat",process:"process",composer:"input",active:true,draft:"\n"))
  XCTAssertThrowsError(try state.validate(identity:"chat",process:"process",composer:"input",active:true,draft:" \n"))
  XCTAssertThrowsError(try state.validate(identity:"chat",process:"process",composer:"input",active:true,draft:"\n\n"))
 }

 func testSelectsTheConversationWebAreaInsideTheElectronShell() throws {
  let chat = "https://claude.ai/chat/00000000-0000-4000-8000-000000000002"
  XCTAssertEqual(try conversationWebAreaIndex(["file:///app/index.html", chat], mode: "chat"), 1)
  XCTAssertThrowsError(try conversationWebAreaIndex([chat, chat], mode: "chat"))
 }
 func testObservedMessageGroupsIdentifyRolesWithoutCopyingHeadingOrToolbar() throws {
  XCTAssertEqual(messageRole(group: "Message 1 of 2", heading: "You said: test"), "user")
  XCTAssertEqual(messageRole(group: "Message 2 of 2", heading: "Claude responded: READY"), "assistant")
  XCTAssertNil(messageRole(group: "Sidebar", heading: "Claude responded: private"))
  XCTAssertEqual(messageOrdinal("Message 2 of 2"), messageOrdinal("Message 2 of 4"))
  XCTAssertLessThanOrEqual(boundedVisibleText(String(repeating:"👋", count:2000)).utf8.count, 3000)
 }

 func testCodeIdentityRequiresAnExplicitSessionUrl() throws {
  let id = "00000000-0000-4000-8000-000000000002"
  XCTAssertEqual(try conversationSessionId("https://claude.ai/code/sessions/" + id), id)
  XCTAssertThrowsError(try conversationSessionId("https://claude.ai/chat/" + id))
  XCTAssertThrowsError(try conversationSessionId("https://example.com/code/sessions/" + id))
 }

 func testNavigationAndRestartInvalidateBinding() throws {
  let state = BindingState(identity: "chat-1", process: "pid-1-launch-1", composer: "composer-1")
  XCTAssertNoThrow(try state.validate(identity: "chat-1", process: "pid-1-launch-1", composer: "composer-1", active: true, draft: ""))
  XCTAssertThrowsError(try state.validate(identity: "chat-2", process: "pid-1-launch-1", composer: "composer-1", active: true, draft: ""))
  XCTAssertThrowsError(try state.validate(identity: "chat-1", process: "pid-1-launch-2", composer: "composer-1", active: true, draft: ""))
 }
 func testDraftAndInactiveSessionBlockInput() throws {
  let state = BindingState(identity: "chat-1", process: "process", composer: "input")
  XCTAssertThrowsError(try state.validate(identity: "chat-1", process: "process", composer: "input", active: true, draft: "local draft"))
  XCTAssertThrowsError(try state.validate(identity: "chat-1", process: "process", composer: "input", active: false, draft: ""))
 }
 func testPromptRejectsTerminalControlsAndCountsUtf8() throws {
  XCTAssertNoThrow(try validatePrompt(String(repeating: "👋", count: 4096)))
  XCTAssertThrowsError(try validatePrompt(String(repeating: "👋", count: 4097)))
  XCTAssertThrowsError(try validatePrompt("hello\u{1b}[201~"))
 }
}
