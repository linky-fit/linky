import Capacitor
import CoreNFC
import Foundation

@objc(LinkyNfcPlugin)
final class LinkyNfcPlugin: CAPPlugin, CAPBridgedPlugin, NFCNDEFReaderSessionDelegate {
    let identifier = "LinkyNfcPlugin"
    let jsName = "LinkyNfc"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "areSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingDeepLinkUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeUri", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelWrite", returnType: CAPPluginReturnPromise)
    ]

    private static weak var activePlugin: LinkyNfcPlugin?
    private static var pendingDeepLinkUrl: String?

    private var cancelledByApp = false
    private var pendingCall: CAPPluginCall?
    private var pendingUrl: URL?
    private var readerSession: NFCNDEFReaderSession?

    override public func load() {
        Self.activePlugin = self
    }

    static func acceptDeepLink(_ url: URL) -> Bool {
        guard normalizedUrl(from: url.absoluteString) != nil else {
            return false
        }

        let value = url.absoluteString
        pendingDeepLinkUrl = value
        activePlugin?.notifyListeners("deepLink", data: [
            "url": value
        ])
        return true
    }

    @objc func areSupported(_ call: CAPPluginCall) {
        call.resolve([
            "supported": NFCNDEFReaderSession.readingAvailable
        ])
    }

    @objc func consumePendingDeepLinkUrl(_ call: CAPPluginCall) {
        let value = Self.pendingDeepLinkUrl
        Self.pendingDeepLinkUrl = nil

        if let value {
            call.resolve([
                "url": value
            ])
            return
        }

        call.resolve()
    }

    @objc func writeUri(_ call: CAPPluginCall) {
        guard pendingCall == nil, readerSession == nil else {
            call.resolve([
                "status": "busy"
            ])
            return
        }

        guard NFCNDEFReaderSession.readingAvailable else {
            call.resolve([
                "status": "unsupported"
            ])
            return
        }

        guard let normalized = Self.normalizedUrl(from: call.getString("url")) else {
            call.resolve([
                "message": "Unsupported NFC payload.",
                "status": "error"
            ])
            return
        }

        cancelledByApp = false
        pendingCall = call
        pendingUrl = normalized

        let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
        session.alertMessage = "Hold your iPhone near an NFC tag."
        readerSession = session
        session.begin()
    }

    @objc func cancelWrite(_ call: CAPPluginCall) {
        cancelActiveSession()
        call.resolve()
    }

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {
        // CoreNFC presents its own system sheet, so the web app stays on the current screen.
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        // This callback is not used for writes, but must be implemented for the delegate.
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard session === readerSession else {
            return
        }

        guard tags.count == 1 else {
            session.alertMessage = "More than one NFC tag was detected. Try again with a single tag."
            session.restartPolling()
            return
        }

        guard let url = pendingUrl,
              let record = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else {
            completePendingWrite(status: "error", message: "Unsupported NFC payload.")
            return
        }

        let message = NFCNDEFMessage(records: [record])
        let messageLength = message.length
        let tag = tags[0]

        session.connect(to: tag) { [weak self] error in
            guard let self else {
                return
            }

            if let error {
                self.completePendingWrite(status: "error", message: error.localizedDescription)
                return
            }

            tag.queryNDEFStatus { status, capacity, statusError in
                if let statusError {
                    self.completePendingWrite(status: "error", message: statusError.localizedDescription)
                    return
                }

                switch status {
                case .notSupported:
                    self.completePendingWrite(status: "error", message: "NFC tag does not support NDEF.")
                case .readOnly:
                    self.completePendingWrite(status: "error", message: "NFC tag is read-only.")
                case .readWrite:
                    if Int(capacity) > 0 && Int(capacity) < messageLength {
                        self.completePendingWrite(status: "error", message: "NFC tag is too small.")
                        return
                    }

                    tag.writeNDEF(message) { writeError in
                        if let writeError {
                            self.completePendingWrite(status: "error", message: writeError.localizedDescription)
                            return
                        }

                        self.completePendingWrite(
                            status: "success",
                            message: nil,
                            alertMessage: "NFC tag written successfully."
                        )
                    }
                @unknown default:
                    self.completePendingWrite(status: "error", message: "Unknown NFC tag status.")
                }
            }
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        guard session === readerSession else {
            return
        }

        let nsError = error as NSError
        let userCancelled = nsError.domain == NFCReaderError.errorDomain
            && nsError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue

        if pendingCall == nil {
            clearPendingState()
            return
        }

        if cancelledByApp || userCancelled {
            completePendingWrite(status: "cancelled", message: nil)
            return
        }

        completePendingWrite(status: "error", message: error.localizedDescription)
    }

    private func cancelActiveSession() {
        guard let session = readerSession else {
            return
        }

        cancelledByApp = true
        session.invalidate()
    }

    private func completePendingWrite(
        status: String,
        message: String?,
        alertMessage: String? = nil
    ) {
        let call = pendingCall
        let session = readerSession

        clearPendingState()

        if let session {
            if let alertMessage {
                session.alertMessage = alertMessage
            }

            session.invalidate()
        }

        var payload: [String: Any] = [
            "status": status
        ]
        if let message {
            payload["message"] = message
        }

        call?.resolve(payload)
    }

    private func clearPendingState() {
        cancelledByApp = false
        pendingCall = nil
        pendingUrl = nil
        readerSession = nil
    }

    private static func normalizedUrl(from rawValue: String?) -> URL? {
        guard let rawValue else {
            return nil
        }

        let normalized = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            return nil
        }

        let lowercased = normalized.lowercased()
        guard ["nostr://", "cashu://", "nostrconnect://"].contains(where: lowercased.hasPrefix) else {
            return nil
        }

        return URL(string: normalized)
    }
}
