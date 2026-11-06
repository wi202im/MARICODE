import Foundation

func desktopCommandAllowed(scheme: String, host: String, port: Int, mainFrame: Bool, action: String) -> Bool {
    mainFrame && scheme == "http" && host == "127.0.0.1" && port == 61192 &&
        ["quit-ready", "quit-cancelled", "connect", "add-project", "choose-claude-source", "codex", "claude", "configure", "add-agent", "change-project", "remote-settings", "pairing-qr"].contains(action)
}

// The QR opens the install guide with the one-time pairing code in the fragment, which browsers do not send to the server.
func pairingInstallURL(origin: String, code: String) -> String? {
    guard code.range(of: "^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$", options: .regularExpression) != nil,
          origin.range(of: #"^https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net(?::[0-9]{1,5})?$"#, options: .regularExpression) != nil else { return nil }
    return origin + "/install#code=" + code
}

// `tailscale status --json` names this Mac in Self.DNSName with a trailing dot.
func tailscaleSelfOrigin(_ status: Data) -> String? {
    guard let json = (try? JSONSerialization.jsonObject(with: status)) as? [String: Any], json["BackendState"] as? String == "Running",
          let me = json["Self"] as? [String: Any], var name = me["DNSName"] as? String else { return nil }
    if name.hasSuffix(".") { name.removeLast() }
    guard name.range(of: #"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$"#, options: .regularExpression) != nil else { return nil }
    return "https://" + name
}

func desktopMachineOrigin(_ url: URL) -> String? {
    guard url.scheme == "https", url.user == nil, url.password == nil, let host = url.host else { return nil }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    let parts = labels.compactMap { Int($0) }
    let privateIP = labels.count == 4 && parts.count == 4 && parts.allSatisfy({ 0...255 ~= $0 }) && (parts[0] == 10 || (parts[0] == 172 && 16...31 ~= parts[1]) || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 100 && 64...127 ~= parts[1]))
    guard privateIP || host.hasSuffix(".local") || host.hasSuffix(".ts.net") else { return nil }
    return "https://" + host + (url.port.map { ":\($0)" } ?? "")
}

// Visibility follows saved roles, never an unsaved checkbox or a remote page.
func desktopHostActions(roles: [String: Bool], localSelected: Bool) -> [String] {
    var actions = roles["remote"] == true ? ["connections"] : []
    actions.append("settings")
    if localSelected && (roles["local"] == true || roles["server"] == true) { actions.append("agent") }
    if localSelected && roles["server"] == true {
        actions += ["remote-address", "remote-info", "remote-start", "remote-stop"]
    }
    return actions + ["reconnect"]
}

// The local one-use POST serves the workspace before JS normalizes its address.
func desktopWorkspacePath(_ path: String?) -> Bool {
    path == "/workspace" || path == "/desktop-connect"
}

// Management navigation never owns or replaces the selected computer's work view.
struct DesktopUtilityTrail {
    private var screens: [String] = []
    var current: String? { screens.last }
    mutating func open(_ key: String) {
        guard ["settings", "connections"].contains(key), current != key else { return }
        if let index = screens.firstIndex(of: key) { screens = Array(screens.prefix(index + 1)) }
        else { screens.append(key) }
    }
    mutating func back() { if !screens.isEmpty { screens.removeLast() } }
    mutating func clear() { screens.removeAll() }
}

// Reflect the workspace transport state, not whether an AI session is running.
func desktopConnectionTone(_ state: String?) -> String {
    switch state {
    case "live", "empty": return "green"
    case "restoring", "connecting", "paused", "outdated": return "amber"
    case "unavailable", "expired", "denied": return "red"
    default: return "gray"
    }
}
