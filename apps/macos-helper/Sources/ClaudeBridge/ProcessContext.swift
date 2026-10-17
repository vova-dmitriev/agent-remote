import Foundation
import Darwin

func nativeProcessContext(_ pid: Int32) throws -> [String: Any] {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_uid == getuid() else {
        throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE")
    }
    var maximum: Int32 = 0
    var length = MemoryLayout<Int32>.size
    var limit: [Int32] = [CTL_KERN, KERN_ARGMAX]
    guard sysctl(&limit, 2, &maximum, &length, nil, 0) == 0, maximum > 0, maximum <= 1_048_576 else {
        throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE")
    }
    var bytes = [UInt8](repeating: 0, count: Int(maximum))
    length = bytes.count
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    guard sysctl(&mib, 3, &bytes, &length, nil, 0) == 0, length > 4 else {
        throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE")
    }
    let argc = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
    guard argc > 0, argc < 4096 else { throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE") }
    var offset = 4
    func take() throws -> String {
        let start = offset
        while offset < length && bytes[offset] != 0 { offset += 1 }
        guard offset < length, let value = String(bytes: bytes[start..<offset], encoding: .utf8) else {
            throw BridgeFailure("PROCESS_CONTEXT_UNAVAILABLE")
        }
        offset += 1
        return value
    }
    let executable = try take()
    while offset < length && bytes[offset] == 0 { offset += 1 }
    var arguments: [String] = []
    for _ in 0..<argc { arguments.append(try take()) }
    var environment: [String: String] = [:]
    while offset < length && bytes[offset] != 0 {
        let item = try take()
        if let separator = item.firstIndex(of: "=") {
            let name = String(item[..<separator])
            if name.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil {
                environment[name] = String(item[item.index(after: separator)...])
            }
        }
    }
    return ["executable": executable, "args": Array(arguments.dropFirst()), "env": environment]
}
