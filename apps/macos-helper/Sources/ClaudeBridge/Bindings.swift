import Foundation
struct BridgeFailure: Error { let code: String; init(_ code: String) { self.code = code } }
struct BindingState {
 let identity: String
 let process: String
 let composer: String
 func validate(identity: String, process: String, composer: String, active: Bool, draft: String) throws {
  guard active else { throw BridgeFailure("CAPABILITY_UNAVAILABLE") }
  guard self.identity == identity, self.process == process, self.composer == composer else { throw BridgeFailure("STALE_SESSION") }
  guard isComposerEmpty(draft) else { throw BridgeFailure("LOCAL_DRAFT_PRESENT") }
 }
}
func validatePrompt(_ text: String) throws {
 guard text.utf8.count <= 16384 else { throw BridgeFailure("PROMPT_TOO_LARGE") }
 for scalar in text.unicodeScalars {
  if (scalar.value < 32 && scalar.value != 9 && scalar.value != 10) || (scalar.value >= 127 && scalar.value <= 159) { throw BridgeFailure("INVALID_PROMPT") }
 }
}
func conversationSessionId(_ identity: String) throws -> String {
 guard let url = URL(string: identity), url.scheme == "https", url.host == "claude.ai" else { throw BridgeFailure("CODE_IDENTITY_UNVERIFIED") }
 let parts = url.pathComponents.filter { $0 != "/" }
 guard parts.count >= 2, parts.first == "code" || parts.first == "sessions", let id = parts.last, UUID(uuidString: id) != nil else { throw BridgeFailure("CODE_IDENTITY_UNVERIFIED") }
 return id
}
func conversationWebAreaIndex(_ urls: [String], mode: String) throws -> Int {
 let matches = urls.indices.filter { index in
  guard let url = URL(string: urls[index]), url.scheme == "https", url.host == "claude.ai" else { return false }
  let parts = url.pathComponents.filter { $0 != "/" }
  if mode == "code" { return (try? conversationSessionId(urls[index])) != nil }
  return parts.count == 2 && parts[0] == "chat" && UUID(uuidString: parts[1]) != nil
 }
 guard matches.count == 1, let index = matches.first else { throw BridgeFailure(matches.isEmpty ? "STABLE_CHAT_ID_UNAVAILABLE" : "AMBIGUOUS_DOCUMENT") }
 return index
}
func messageOrdinal(_ group: String) -> String? {
 guard group.range(of: "^Message [1-9][0-9]* of [1-9][0-9]*$", options: .regularExpression) != nil else { return nil }
 return String(group.split(separator: " ")[1])
}
func messageRole(group: String, heading: String) -> String? {
 guard messageOrdinal(group) != nil else { return nil }
 if heading.hasPrefix("You said:") { return "user" }
 if heading.hasPrefix("Claude responded:") { return "assistant" }
 return nil
}
func boundedVisibleText(_ value: String) -> String {
 let clean = String(String.UnicodeScalarView(value.unicodeScalars.filter { $0.value >= 32 || $0.value == 9 || $0.value == 10 }))
 var bytes = Array(clean.utf8.prefix(3000))
 while !bytes.isEmpty { if let text = String(bytes: bytes, encoding: .utf8) { return text }; bytes.removeLast() }
 return ""
}

// Chromium exposes its empty contenteditable paragraph as a single line-feed.
func isComposerEmpty(_ value: String) -> Bool { value.isEmpty || value == "\n" }
