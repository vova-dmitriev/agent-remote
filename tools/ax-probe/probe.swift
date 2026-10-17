import AppKit
import ApplicationServices
let applications = NSRunningApplication.runningApplications(withBundleIdentifier: "com.anthropic.claudefordesktop")
let result: [String: Any] = ["accessibilityTrusted": AXIsProcessTrusted(), "claudeRunning": !applications.isEmpty, "claudeInstalled": FileManager.default.fileExists(atPath: "/Applications/Claude.app")]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
