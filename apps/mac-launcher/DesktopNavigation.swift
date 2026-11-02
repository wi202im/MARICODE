import Foundation

func desktopCommandAllowed(scheme: String, host: String, port: Int, mainFrame: Bool, action: String) -> Bool {
    mainFrame && scheme == "http" && host == "127.0.0.1" && port == 61192 &&
        ["quit-ready", "connect", "add-project", "choose-claude-source", "codex", "claude", "configure", "add-agent", "change-project", "remote-settings"].contains(action)
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
