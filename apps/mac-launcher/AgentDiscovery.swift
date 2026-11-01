import Foundation

// Read-only suggestions. Never run a candidate or search the project/PATH.
func installedAgentCandidates(_ agent: String, directories: [String]) -> [String] {
    guard ["codex", "claude"].contains(agent) else { return [] }
    var seen = Set<String>()
    return directories.compactMap { directory in
        let path = URL(fileURLWithPath: directory).appendingPathComponent(agent).path
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
              !isDirectory.boolValue, FileManager.default.isExecutableFile(atPath: path),
              seen.insert(path).inserted else { return nil }
        return path
    }
}
