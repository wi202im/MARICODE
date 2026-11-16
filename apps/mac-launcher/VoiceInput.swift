import AppKit
import Speech
import AVFoundation

// Raw audio stays in the device recognizer; no audio files, cloud fallback or chat sending.
final class VoiceInput {
    private var id: String?
    private var tapInstalled = false
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var deadline: Timer?
    private var finishTimer: Timer?
    private var emit: (([String: String]) -> Void)?

    func start(_ id: String, emit: @escaping ([String: String]) -> Void) {
        guard self.id == nil else { emit(["id": id, "type": "error", "message": "음성 입력이 이미 진행 중입니다."]); return }
        self.id = id; self.emit = emit
        SFSpeechRecognizer.requestAuthorization { [weak self] authorization in
            DispatchQueue.main.async {
                guard let self, self.id == id else { return }
                guard authorization == .authorized else { self.fail("시스템 설정에서 Maricode의 음성 인식 권한을 허용해 주세요."); return }
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.id == id else { return }
                        guard allowed else { self.fail("시스템 설정에서 Maricode의 마이크 권한을 허용해 주세요."); return }
                        guard NSApp.isActive else { self.fail("앱으로 돌아온 뒤 음성 입력을 다시 시작해 주세요."); return }
                        self.listen(id)
                    }
                }
            }
        }
    }
    private func listen(_ id: String) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ko-KR")), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            fail("이 Mac에서 한국어 기기 내 음성 인식을 사용할 수 없습니다. macOS 키보드의 받아쓰기를 이용하세요."); return
        }
        let engine = AVAudioEngine(), request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true; request.shouldReportPartialResults = true
        self.engine = engine; self.request = request; self.recognizer = recognizer
        let input = engine.inputNode, format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { fail("사용할 수 있는 마이크가 없습니다."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapInstalled = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.id == id else { return }
                if let result {
                    self.emit?(["id": id, "type": "result", "text": result.bestTranscription.formattedString])
                    if result.isFinal { self.finish(); return }
                }
                if error != nil { self.fail("음성 인식이 중단됐습니다. 마이크와 한국어 인식 지원을 확인한 뒤 다시 시작해 주세요.") }
            }
        }
        do {
            engine.prepare(); try engine.start(); emit?(["id": id, "type": "ready"])
            deadline = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in self?.stop(id) }
        } catch { fail("마이크를 시작하지 못했습니다. 다른 앱의 사용 여부와 권한을 확인하세요.") }
    }
    func stop(_ id: String) {
        guard self.id == id, finishTimer == nil else { return }
        // Stop capture now; allow the recognizer a bounded interval to finish its last words.
        guard let engine else { cancel(); return }
        engine.stop(); request?.endAudio(); deadline?.invalidate(); deadline = nil
        finishTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in self?.finish() }
    }
    func cancelIfRecording() { if engine != nil { cancel() } }
    func cancel(_ expected: String? = nil) {
        if let expected, expected != id { return }
        let old = id, callback = emit; cleanup()
        if let old { callback?(["id": old, "type": "error", "message": "음성 입력을 취소했습니다."]) }
    }
    private func fail(_ message: String) {
        let old = id, callback = emit; cleanup()
        if let old { callback?(["id": old, "type": "error", "message": message]) }
    }
    private func finish() {
        let old = id, callback = emit; cleanup()
        if let old { callback?(["id": old, "type": "end"]) }
    }
    private func cleanup() {
        id = nil; emit = nil; deadline?.invalidate(); deadline = nil; finishTimer?.invalidate(); finishTimer = nil
        engine?.stop()
        // A tap is installed only after a valid input format was found.
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); task?.cancel(); task = nil; request = nil; engine = nil; recognizer = nil
    }
}
