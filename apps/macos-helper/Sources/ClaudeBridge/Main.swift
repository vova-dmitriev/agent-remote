import Foundation
import AppKit
import ApplicationServices
struct SavedBinding { let mode: String; let state: BindingState; let window: AXUIElement; let composer: AXUIElement; let generation: String }
@main struct ClaudeBridge {
 static func main() {
  if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--process-context" {
   do {
    guard let pid = Int32(CommandLine.arguments[2]) else { throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE") }
    let data = try JSONSerialization.data(withJSONObject: nativeProcessContext(pid))
    FileHandle.standardOutput.write(data)
   } catch { FileHandle.standardError.write(Data("PROCESS_CONTEXT_UNAVAILABLE\n".utf8)); exit(1) }
   return
  }
  var bindings: [String: SavedBinding] = [:]
  while let line = readLine() {
   var response: [String:Any]
   do {
    guard line.utf8.count <= 131072, let data = line.data(using:.utf8), let request = try JSONSerialization.jsonObject(with:data) as? [String:Any], Set(request.keys).isSubset(of:["operation","mode","bindingId","text"]), let operation = request["operation"] as? String else { throw BridgeFailure("INVALID_REQUEST") }
    if operation == "probe" {
     response = ["ok":true,"result":["trusted":AXIsProcessTrusted(),"running":!NSRunningApplication.runningApplications(withBundleIdentifier:"com.anthropic.claudefordesktop").isEmpty,"frontmostIsClaude":NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.anthropic.claudefordesktop"]]
    } else if operation == "bind" {
     guard let mode = request["mode"] as? String, ["chat","code"].contains(mode) else { throw BridgeFailure("INVALID_MODE") }
     let selected = try context(mode:mode)
     // This operation is reachable only through the authenticated local setup socket.
     // Remote send/read never activate an application or choose another window.
     guard selected.app.activate(options: []) else { throw BridgeFailure("CLAUDE_ACTIVATION_FAILED") }
     guard AXUIElementPerformAction(selected.window,kAXRaiseAction as CFString) == .success else { throw BridgeFailure("WINDOW_UNAVAILABLE") }
     RunLoop.current.run(until:Date(timeIntervalSinceNow:0.1))
     let current = try context(mode:mode,requireActive:true)
     guard current.identity == selected.identity, CFEqual(current.window,selected.window), CFEqual(current.composer,selected.composer) else { throw BridgeFailure("STALE_SESSION") }
     let id = UUID().uuidString, generation = UUID().uuidString
     let state = BindingState(identity:current.identity,process:current.process,composer:String(CFHash(current.composer)))
     bindings[id] = SavedBinding(mode:mode,state:state,window:current.window,composer:current.composer,generation:generation)
     let visible = messages(current.document)
     var result: [String:Any] = ["bindingId":id,"generation":generation,"conversationId":URL(string:current.identity)?.lastPathComponent ?? "","canPrompt":true,"canInterrupt":current.stop != nil,"canHistory":!visible.isEmpty]
     if mode == "code" { result["claudeSessionId"] = try conversationSessionId(current.identity) }
     response = ["ok":true,"result":result]
    } else {
     guard let id = request["bindingId"] as? String, let binding = bindings[id] else { throw BridgeFailure("STALE_SESSION") }
     if operation == "unbind" { bindings.removeValue(forKey:id); response = ["ok":true,"result":[:]] }
     else {
      let current = try context(mode:binding.mode)
      guard current.identity == binding.state.identity, current.process == binding.state.process, CFEqual(current.window,binding.window), CFEqual(current.composer,binding.composer) else { bindings.removeValue(forKey:id);throw BridgeFailure("STALE_SESSION") }
      if operation == "read" { response = ["ok":true,"result":["draftUtf8Length":text(current.composer,kAXValueAttribute).utf8.count,"draftHasTrailingLF":text(current.composer,kAXValueAttribute).hasSuffix("\n"),"messages":messages(current.document),"status":current.stop == nil ? "idle":"running","canInterrupt":current.isActive && current.stop != nil,"canPrompt":current.isActive && isComposerEmpty(text(current.composer,kAXValueAttribute))]] }
      else if operation == "send_prompt" {
       guard let prompt = request["text"] as? String else { throw BridgeFailure("INVALID_PROMPT") }; try validatePrompt(prompt)
       try binding.state.validate(identity:current.identity,process:current.process,composer:String(CFHash(current.composer)),active:current.isActive,draft:text(current.composer,kAXValueAttribute))
       guard AXUIElementSetAttributeValue(current.composer,kAXValueAttribute as CFString,prompt as CFString) == .success else { throw BridgeFailure("COMPOSER_WRITE_FAILED") }
       do {
        var sendAction: AXUIElement?
        for _ in 0..<5 {
         let verified = try context(mode:binding.mode,requireActive:true)
         guard verified.identity == binding.state.identity, verified.process == binding.state.process, CFEqual(verified.window,binding.window), CFEqual(verified.composer,binding.composer), text(verified.composer,kAXValueAttribute) == prompt else { throw BridgeFailure("UNKNOWN_AFTER_WRITE") }
         if let send = verified.send, attribute(send,kAXEnabledAttribute) as? Bool == true { sendAction = send; break }
         Thread.sleep(forTimeInterval:0.05)
        }
        guard let send = sendAction, AXUIElementPerformAction(send,kAXPressAction as CFString) == .success else { throw BridgeFailure("UNKNOWN_AFTER_WRITE") }
       } catch { throw BridgeFailure("UNKNOWN_AFTER_WRITE") }

       response = ["ok":true,"result":["status":"dispatched"]]
      } else if operation == "interrupt" {
       guard current.isActive else { throw BridgeFailure("CAPABILITY_UNAVAILABLE") }
       guard let stop = current.stop, attribute(stop,kAXEnabledAttribute) as? Bool == true else { throw BridgeFailure("CAPABILITY_UNAVAILABLE") }
       guard AXUIElementPerformAction(stop,kAXPressAction as CFString) == .success else { throw BridgeFailure("UNKNOWN_AFTER_WRITE") }
       response = ["ok":true,"result":["status":"dispatched"]]
      } else { throw BridgeFailure("INVALID_OPERATION") }
     }
    }
   } catch let failure as BridgeFailure { response = ["ok":false,"code":failure.code] }
   catch { response = ["ok":false,"code":"HELPER_FAILED"] }
   if let data = try? JSONSerialization.data(withJSONObject:response,options:[.sortedKeys]), let output = String(data:data,encoding:.utf8) { print(output);fflush(stdout) }
  }
 }
}
