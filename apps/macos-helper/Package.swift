// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ClaudeBridge", platforms: [.macOS(.v13)], products: [.executable(name: "ClaudeBridge", targets: ["ClaudeBridge"])], targets: [.executableTarget(name: "ClaudeBridge", linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("ApplicationServices")]), .testTarget(name: "ClaudeBridgeTests", dependencies: ["ClaudeBridge"])])
