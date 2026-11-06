import Foundation

func desktopCommandAllowed(scheme: String, host: String, port: Int, mainFrame: Bool, action: String) -> Bool {
    mainFrame && scheme == "http" && host == "127.0.0.1" && port == 61192 &&
        ["quit-ready", "quit-cancelled", "connect", "add-project", "choose-claude-source", "codex", "claude", "configure", "add-agent", "change-project", "remote-settings", "pairing-qr", "pairing-prepare", "pairing-cancel", "remote-start", "remote-stop", "remote-state"].contains(action)
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

// Visibility follows the saved setting, never an unsaved checkbox.
func desktopHostActions(server: Bool) -> [String] {
    ["settings", "agent"] + (server ? ["devices"] : []) + ["reconnect"]
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
        guard key == "settings", current != key else { return }
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
