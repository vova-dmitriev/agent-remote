import AppKit
import ApplicationServices
import CryptoKit
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
 var value: CFTypeRef?
 guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
 return value
}
func text(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func descendants(_ element: AXUIElement) -> [AXUIElement] {
 var result: [AXUIElement] = []; var queue: [(AXUIElement, Int)] = [(element, 0)]; var index = 0
 while index < queue.count && result.count < 2048 {
  let (node, depth) = queue[index]; index += 1; result.append(node)
  if depth < 24 { for child in children(node) where queue.count < 4096 { queue.append((child, depth + 1)) } }
 }
 return result
}
func isForeground(_ app: NSRunningApplication) -> Bool {
 guard let value = attribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return false }
 let focused = unsafeBitCast(value, to: AXUIElement.self)
 var pid: pid_t = 0
 return AXUIElementGetPid(focused,&pid) == .success && pid == app.processIdentifier
}
struct UIContext {
 let app: NSRunningApplication
 let window: AXUIElement
 let document: AXUIElement
 let composer: AXUIElement
 let send: AXUIElement?
 let stop: AXUIElement?
 let identity: String
 var isActive: Bool { isForeground(app) }
 var process: String { "\(app.processIdentifier):\(app.launchDate?.timeIntervalSince1970 ?? 0)" }
}
func context(mode: String, requireActive: Bool = false) throws -> UIContext {
 guard AXIsProcessTrusted() else { throw BridgeFailure("ACCESSIBILITY_CONSENT_REQUIRED") }
 let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.anthropic.claudefordesktop")
 guard apps.count == 1, let app = apps.first else { throw BridgeFailure("CLAUDE_NOT_RUNNING") }
 if requireActive && !isForeground(app) { throw BridgeFailure("CLAUDE_WINDOW_MUST_BE_ACTIVE") }
 let appElement = AXUIElementCreateApplication(app.processIdentifier)
 guard let windowValue = attribute(appElement, kAXFocusedWindowAttribute), CFGetTypeID(windowValue) == AXUIElementGetTypeID() else { throw BridgeFailure("WINDOW_UNAVAILABLE") }
 let window = unsafeBitCast(windowValue, to: AXUIElement.self)
 let elements = descendants(window)
 let webAreas = elements.filter { text($0,kAXRoleAttribute) == "AXWebArea" }
 func urlOf(_ element: AXUIElement) -> String { (attribute(element,kAXURLAttribute) as? URL)?.absoluteString ?? text(element,kAXURLAttribute) }
 let index = try conversationWebAreaIndex(webAreas.map(urlOf), mode: mode)
 let document = webAreas[index], documentURL = urlOf(document)
 let documentElements = descendants(document)
 let inputs = documentElements.filter { text($0,kAXRoleAttribute) == "AXTextArea" }
 guard inputs.count == 1 else { throw BridgeFailure("COMPOSER_UNVERIFIED") }
 var settable: DarwinBoolean = false
 guard AXUIElementIsAttributeSettable(inputs[0],kAXValueAttribute as CFString,&settable) == .success, settable.boolValue else { throw BridgeFailure("COMPOSER_NOT_SETTABLE") }
 let sendLabels = Set(["Send", "Send message", "Отправить", "Отправить сообщение"])
 let stopLabels = Set(["Stop", "Stop response", "Stop generating", "Остановить", "Прервать"])
 let buttons = documentElements.filter { text($0,kAXRoleAttribute) == "AXButton" }
 func labeled(_ labels: Set<String>) -> AXUIElement? { let matches = buttons.filter { labels.contains(text($0,kAXTitleAttribute)) || labels.contains(text($0,kAXDescriptionAttribute)) }; return matches.count == 1 ? matches.first : nil }
 return UIContext(app: app,window: window,document: document,composer: inputs[0],send: labeled(sendLabels),stop: labeled(stopLabels),identity: documentURL)
}
func semanticLabel(_ element: AXUIElement) -> String {
 let description = text(element,kAXDescriptionAttribute)
 return description.isEmpty ? text(element,kAXTitleAttribute) : description
}
func headingLabel(_ element: AXUIElement) -> String {
 let label = semanticLabel(element)
 if !label.isEmpty { return label }
 return descendants(element).filter { text($0,kAXRoleAttribute) == "AXStaticText" }.map { text($0,kAXValueAttribute) }.joined(separator: " ")
}
func visibleBody(_ element: AXUIElement) -> String {
 var output: [String] = [], queue: [AXUIElement] = [element], index = 0
 while index < queue.count && index < 2048 {
  let node = queue[index]; index += 1
  let role = text(node,kAXRoleAttribute)
  if ["AXToolbar","AXButton","AXPopUpButton"].contains(role) { continue }
  if role == "AXHeading" { let label = headingLabel(node); if label.hasPrefix("You said:") || label.hasPrefix("Claude responded:") { continue } }
  if role == "AXStaticText" { let value = text(node,kAXValueAttribute); if !value.isEmpty { output.append(value) }; continue }
  queue.append(contentsOf: children(node).prefix(max(0,2048-queue.count)))
 }
 return output.joined(separator: "\n")
}
func messages(_ document: AXUIElement) -> [[String: Any]] {
 let roles = ["User message":"user", "Assistant message":"assistant", "Сообщение пользователя":"user", "Ответ Claude":"assistant"]
 var output: [[String: Any]] = []
 for node in descendants(document) {
  let label = semanticLabel(node)
  var role = roles[label]
  if role == nil && messageOrdinal(label) != nil {
   let heading = descendants(node).first { text($0,kAXRoleAttribute) == "AXHeading" }
   if let heading { role = messageRole(group:label,heading:headingLabel(heading)) }
  }
  guard let role else { continue }
  let content = boundedVisibleText(visibleBody(node))
  guard !content.isEmpty else { continue }
  let nodeIdentity = messageOrdinal(label) ?? (text(node,kAXIdentifierAttribute).isEmpty ? String(CFHash(node)) : text(node,kAXIdentifierAttribute))
  let digest = SHA256.hash(data: Data((role + ":" + nodeIdentity).utf8)).map { String(format: "%02x", $0) }.joined()
  output.append(["id":digest,"role":role,"text":content,"occurredAt":Int(Date().timeIntervalSince1970 * 1000)])
 }
 return Array(output.suffix(20))
}
