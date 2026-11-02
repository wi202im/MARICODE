import AppKit
import CryptoKit
import Darwin

struct AppVersion: Comparable, Equatable {
    let value: String
    let parts: [Int]
    init?(_ value: String) {
        let components = value.split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 3, components.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) && ($0 == "0" || !$0.hasPrefix("0")) }),
              components.allSatisfy({ Int($0) != nil }) else { return nil }
        self.value = value; self.parts = components.map { Int($0)! }
    }
    static func < (a: Self, b: Self) -> Bool { a.parts.lexicographicallyPrecedes(b.parts) }
}
struct UpdateRelease {
    let version: AppVersion
    let download: URL
    let page: URL
    let sha256: String
    let size: Int64
    let notes: String
    init(data: Data) throws {
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              raw["draft"] as? Bool == false, raw["prerelease"] as? Bool == false,
              let tag = raw["tag_name"] as? String, tag.hasPrefix("v"), let version = AppVersion(String(tag.dropFirst())),
              let assets = raw["assets"] as? [[String: Any]] else { throw UpdateError.invalid }
        let name = "MARICODE-\(version.value)-arm64.dmg"
        let matches = assets.filter { $0["name"] as? String == name }
        let expected = "https://github.com/wi202im/MARICODE/releases/download/\(tag)/\(name)"
        guard matches.count == 1, let asset = matches.first,
              asset["browser_download_url"] as? String == expected,
              let digest = asset["digest"] as? String, digest.hasPrefix("sha256:"),
              digest.count == 71, digest.dropFirst(7).allSatisfy({ "0123456789abcdef".contains($0) }),
              let size = asset["size"] as? Int64, size > 0, size <= 1_073_741_824 else { throw UpdateError.invalid }
        self.version = version; download = URL(string: expected)!; self.size = size
        page = URL(string: "https://github.com/wi202im/MARICODE/releases/tag/\(tag)")!
        sha256 = String(digest.dropFirst(7)); notes = String((raw["body"] as? String ?? "변경 내용은 공개 릴리스에서 확인할 수 있습니다.").prefix(20000))
    }
}
enum UpdateError: Error { case invalid }
func verifyUpdateFile(_ url: URL, size: Int64, sha256: String) throws -> Bool {
    let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
    var hash = SHA256(), count: Int64 = 0
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
        count += Int64(data.count); if count > size { return false }; hash.update(data: data)
    }
    return count == size && hash.finalize().map { String(format: "%02x", $0) }.joined() == sha256
}

// One verified installer, opened only after a confirmed normal shutdown.
// Consuming/cancelling the intent prevents a later ordinary Quit from installing.
final class UpdateInstallFlow {
    private var intent: (file: URL, size: Int64, sha256: String)?
    var pending: Bool { intent != nil }
    func begin(file: URL, size: Int64, sha256: String) -> Bool {
        guard intent == nil, (try? verifyUpdateFile(file, size: size, sha256: sha256)) == true else { return false }
        intent = (file, size, sha256); return true
    }
    func cancel() { intent = nil }
    func finish(normalShutdown: Bool, open: (URL) -> Bool) -> Bool {
        guard let selected = intent else { return true }
        intent = nil
        guard normalShutdown, (try? verifyUpdateFile(selected.file, size: selected.size, sha256: selected.sha256)) == true else { return false }
        return open(selected.file)
    }
}

// UI flow reference: Paseo update callout + settings rows (Apache-2.0; see NOTICES).
// No credentials, remote-server updates, app replacement, or Gatekeeper overrides.
final class AppUpdateController: NSObject, URLSessionDownloadDelegate {
    var onAvailable: ((String?) -> Void)?
    var onInstall: ((URL, UpdateRelease) -> Bool)?
    private var installing = false
    private let current: AppVersion
    private var panel: NSWindow?
    private let state = NSTextField(wrappingLabelWithString: "공개된 새 버전을 확인하세요.")
    private let versions = NSTextField(labelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")
    private let check = NSButton(title: "업데이트 확인", target: nil, action: nil)
    private let download = NSButton(title: "다운로드", target: nil, action: nil)
    private let changes = NSButton(title: "변경사항", target: nil, action: nil)
    private let progress = NSProgressIndicator()
    private var release: UpdateRelease?
    private var task: URLSessionTask?
    private var image: URL?
    private var session: URLSession?
    init(version: String) { current = AppVersion(version) ?? AppVersion("0.0.0")!; super.init(); download.isHidden = true; changes.isHidden = true }
    func show() {
        if panel == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 440), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "MARICODE 업데이트"; w.appearance = NSAppearance(named: .darkAqua); w.isReleasedWhenClosed = false
            let heading = NSTextField(labelWithString: "앱 업데이트"); heading.font = .systemFont(ofSize: 21, weight: .semibold)
            let scope = NSTextField(wrappingLabelWithString: "지금 사용하는 Mac 앱 · 원격 서버는 변경하지 않습니다."); scope.textColor = .secondaryLabelColor
            versions.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium); if versions.stringValue.isEmpty { versions.stringValue = "현재 버전  \(current.value)" }
            state.font = .systemFont(ofSize: 15, weight: .medium); detail.textColor = .secondaryLabelColor
            detail.stringValue = "다운로드 후 ‘앱 종료 후 설치’를 누르면 정상 종료를 확인하고 설치 디스크를 엽니다. 그 안에서 앱을 Applications로 옮겨 교체하세요. 계정·설정·대화는 유지됩니다. 미전송 초안은 먼저 보관하세요."
            for (button, action) in [(check, #selector(checkNow)), (download, #selector(downloadOrOpen)), (changes, #selector(openChanges))] {
                button.target = self; button.action = action; button.bezelStyle = .rounded
            }
            let actions = NSStackView(views: [changes, check, download]); actions.spacing = 8
            progress.isIndeterminate = false; progress.minValue = 0; progress.maxValue = 100; progress.isHidden = true
            let security = NSButton(title: "실행 차단·보안 설정 안내", target: self, action: #selector(openSecurity)); security.bezelStyle = .recessed
            let stack = NSStackView(views: [heading, scope, versions, state, progress, actions, detail, security])
            stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 18; stack.translatesAutoresizingMaskIntoConstraints = false
            w.contentView!.addSubview(stack)
            NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: w.contentView!.leadingAnchor, constant: 28), stack.trailingAnchor.constraint(equalTo: w.contentView!.trailingAnchor, constant: -28), stack.topAnchor.constraint(equalTo: w.contentView!.topAnchor, constant: 26), progress.widthAnchor.constraint(equalTo: stack.widthAnchor)])
            panel = w; w.center()
        }
        panel?.makeKeyAndOrderFront(nil)
    }
    func showFromMenu() { show(); if image == nil { checkNow() } }
    @objc func checkNow() { checkForUpdates(showWindow: true) }
    func checkSilently() { checkForUpdates(showWindow: false) }
    private func checkForUpdates(showWindow: Bool) {
        guard task == nil, !installing else { return }
        if showWindow { show() }; release = nil; image = nil; download.isHidden = true; changes.isHidden = true; check.isEnabled = false
        state.stringValue = "새 버전 확인 중…"; progress.isHidden = true
        let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 900
        self.session?.finishTasksAndInvalidate()
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil); self.session = session
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/wi202im/MARICODE/releases/latest")!)
        req.setValue("MARICODE", forHTTPHeaderField: "User-Agent"); req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let request = session.dataTask(with: req) { [weak self] data, response, _ in
            let result: UpdateRelease? = (response as? HTTPURLResponse)?.statusCode == 200 ? data.flatMap { try? UpdateRelease(data: $0) } : nil
            DispatchQueue.main.async {
                guard let self else { return }; self.task = nil; self.check.isEnabled = true
                guard let result else { self.state.stringValue = "확인하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요."; return }
                self.release = result; self.onAvailable?(result.version > self.current ? result.version.value : nil); self.versions.stringValue = "현재 \(self.current.value)   ·   공개 최신 \(result.version.value)"
                self.changes.isHidden = false
                if result.version > self.current { self.state.stringValue = "새 버전을 사용할 수 있습니다."; self.download.title = "다운로드"; self.download.isHidden = false }
                else { self.state.stringValue = result.version == self.current ? "최신 버전을 사용하고 있습니다." : "공개 릴리스보다 새로운 개발 버전입니다." }
            }
        }
        task = request; request.resume()
    }
    @objc private func openChanges() { if let release { NSWorkspace.shared.open(release.page) } }
    @objc private func openSecurity() {
        let alert = NSAlert(); alert.messageText = "설치·업데이트 후 실행이 차단됐나요?"
        alert.informativeText = "설치한 앱을 한 번 실행한 뒤, 개인정보 보호 및 보안에서 MARICODE의 ‘그래도 열기’를 직접 선택하세요. 이 배포본은 Apple 공증을 받지 않아 업데이트 후에도 확인이 필요할 수 있습니다. 앱이 대신 승인하거나 전체 보안 설정을 해제하지 않습니다."
        alert.addButton(withTitle: "보안 설정 열기"); alert.addButton(withTitle: "닫기")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension")!) }
    }
    @objc private func downloadOrOpen() {
        guard task == nil, !installing, let release else { return }
        if let image {
            guard onInstall?(image, release) == true else {
                state.stringValue = "설치를 시작하지 않았습니다. 진행 중인 종료·설정 작업과 다운로드 파일을 확인하세요."; return
            }
            installing = true; download.isEnabled = false; check.isEnabled = false
            state.stringValue = "앱 종료 확인 중… 작업 화면에서 실행 종료가 필요한지 확인해 주세요."
            panel?.orderOut(nil); return
        }
        download.isEnabled = false; check.isEnabled = false; progress.doubleValue = 0; progress.isHidden = false; state.stringValue = "다운로드 중…"
        let t = session!.downloadTask(with: release.download); task = t; t.resume()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let host = request.url?.host
        completionHandler(request.url?.scheme == "https" && ["github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].contains(host ?? "") ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let release else { return }
        if totalBytesWritten > release.size { downloadTask.cancel(); return }
        DispatchQueue.main.async { self.progress.doubleValue = Double(totalBytesWritten) / Double(release.size) * 100 }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard let release, (downloadTask.response as? HTTPURLResponse)?.statusCode == 200,
                  try verifyUpdateFile(location, size: release.size, sha256: release.sha256) else { throw UpdateError.invalid }
            let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("MARICODE/Updates/\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            let destination = cache.appendingPathComponent(release.download.lastPathComponent)
            try FileManager.default.moveItem(at: location, to: destination)
            // Preserve macOS first-open checks for files downloaded by this app.
            let quarantine = "0083;" + String(Int(Date().timeIntervalSince1970), radix: 16) + ";MARICODE;"
            let tagged = quarantine.withCString { setxattr(destination.path, "com.apple.quarantine", $0, quarantine.utf8.count, 0, 0) }
            guard tagged == 0 else { try? FileManager.default.removeItem(at: destination); throw UpdateError.invalid }
            DispatchQueue.main.async {
                self.image = destination; self.task = nil; self.download.isEnabled = true; self.check.isEnabled = true
                self.state.stringValue = "다운로드 완료 · SHA-256 확인됨"; self.download.title = "앱 종료 후 설치"; self.progress.isHidden = true
            }
        } catch { DispatchQueue.main.async { self.failedDownload() } }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if task is URLSessionDownloadTask, error != nil { DispatchQueue.main.async { self.failedDownload() } }
    }
    func installationCancelled(_ message: String) {
        installing = false; download.isEnabled = true; check.isEnabled = true
        state.stringValue = message
    }
    private func failedDownload() {
        task = nil; image = nil; download.isEnabled = true; check.isEnabled = true; progress.isHidden = true
        state.stringValue = "다운로드 또는 파일 검증에 실패했습니다. 설치하지 않았습니다."
    }
}
