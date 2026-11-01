import Foundation

struct RemoteConnection {
    enum Failure: Error { case unavailable }
    let directory: String
    let address: String
    private static func object(_ path: String) throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as? [String: Any] else { throw Failure.unavailable }
        return result
    }
    static func read(directory: String) throws -> RemoteConnection {
        let state = try object(directory + "/environment.json")
        let backend = try object(directory + "/backend.json")
        let remote = try object(directory + "/remote.json")
        guard state["version"] as? Int == 1, (state["roles"] as? [String: Bool])?["server"] == true,
              backend["version"] as? Int == 1, remote["version"] as? Int == 1,
              let address = remote["origin"] as? String,
              address.range(of: #"^https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net(?::[0-9]+)?$"#, options: .regularExpression) != nil,
              let url = URL(string: address), url.port == nil || (1...65535).contains(url.port!) else { throw Failure.unavailable }
        return RemoteConnection(directory: directory, address: address)
    }
    func token() throws -> String {
        // Recheck the exact destination and role after the confirmation dialog.
        guard try Self.read(directory: directory).address == address else { throw Failure.unavailable }
        let root = URL(fileURLWithPath: directory).resolvingSymlinksInPath()
        let file = root.appendingPathComponent("hub/token.private")
        guard file.resolvingSymlinksInPath().path == file.path else { throw Failure.unavailable }
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600 else { throw Failure.unavailable }
        let value = try String(contentsOf: file, encoding: .utf8)
        guard value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.unavailable }
        return value
    }
}
