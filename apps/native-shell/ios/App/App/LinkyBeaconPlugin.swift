import Capacitor
import CoreBluetooth
import UIKit
import UserNotifications

/// Beacon for iOS: hosts the Linky GATT service, advertises its UUID and swaps contact packets with peers over
/// short GATT connections ("handshakes"), since iOS can neither send nor filter on manufacturer data in the background.
@objc(LinkyBeaconPlugin)
final class LinkyBeaconPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralManagerDelegate,
    CBPeripheralDelegate, NotificationHandlerProtocol {
    let identifier = "LinkyBeaconPlugin"
    let jsName = "LinkyBeacon"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermissionState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTrade", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startIdentityScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopIdentityScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeStoppedByUser", returnType: CAPPluginReturnPromise)
    ]

    private static let serviceUUID = CBUUID(string: "D967055A-693F-4F5D-A9F4-4AD0CCA0FFC2")
    private static let contactsUUID = CBUUID(string: "5A42933B-89B7-4BA1-85BA-11B4655CFABB")
    private static let identityUUID = CBUUID(string: "CEDFD0D0-FDDC-434C-BAF6-820E631A49BF")
    // Hashes to bit 40 of Apple's background "overflow area", which Android scanners use to spot backgrounded iPhones.
    private static let overflowMarkerUUID = CBUUID(string: "00000000-0000-0000-0000-000000000017")
    private static let runningDefaultsKey = "linky.beacon.running"
    private static let notificationPrefix = "linky.beacon.trade."
    private static let nearbyTtl: TimeInterval = 120
    private static let handshakeThrottle: TimeInterval = 40
    private static let handshakeTimeout: TimeInterval = 10
    private static let maxHandshakes = 2
    private static let tickInterval: TimeInterval = 10

    private struct Contact {
        let pubkey: String
        let key: Data
        let priority: Double
        let name: String
    }

    private struct Sighting {
        let state: UInt8
        let lastSeen: Date
    }

    private enum Step {
        case readContacts, writeContacts, readIdentity
    }

    private struct Handshake {
        let peripheral: CBPeripheral
        var steps: [Step]
        var characteristics: [CBUUID: CBCharacteristic] = [:]
    }

    private var central: CBCentralManager?
    private var peripheralManager: CBPeripheralManager?
    private var contacts: [Contact] = []
    private var trade = BeaconCodec.stateNearby
    private var nonce = UInt8.random(in: 0...255)
    private var identity: Data?
    private var running = false
    private var identityScanActive = false
    private var scanningAll = false
    private var advertiseError: String?
    private var lastStatus: [String: Any]?
    private var lastPermission: String?
    private var advertisingRequested = false
    private var servedPackets: [UUID: Data] = [:]
    private var nearby: [String: Sighting] = [:]
    private var nearbyDirty = false
    private var notified = Set<String>()
    private var identities: [String: Date] = [:]
    private var identityParts: [UUID: (first: Data?, second: Data?)] = [:]
    private var handshakes: [UUID: Handshake] = [:]
    private var lastHandshake: [UUID: Date] = [:]
    private var tickTimer: Timer?

    override public func load() {
        bridge?.notificationRouter.localNotificationHandler = self
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(appStateChanged), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appStateChanged), name: UIApplication.willResignActiveNotification, object: nil)
        // A background relaunch by state restoration resumes the service; keys come back when the web app pushes them.
        if UserDefaults.standard.bool(forKey: Self.runningDefaultsKey) {
            running = true
            ensureManagers()
            updateTimer()
        }
    }

    // MARK: Plugin methods

    @objc func getPermissionState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.lastPermission = self.permissionState
            call.resolve(["state": self.permissionState])
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.ensureManagers()
            // An undecided Bluetooth prompt reports its answer through centralManagerDidUpdateState.
            if CBManager.authorization != .notDetermined {
                self.dispatchPermission(force: true)
            }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
            call.resolve([:])
        }
    }

    @objc func setKeys(_ call: CAPPluginCall) {
        let rows = call.getArray("keys", JSObject.self) ?? []
        DispatchQueue.main.async {
            self.contacts = rows.compactMap { row in
                guard let pubkey = (row["pubkey"] as? String)?.lowercased(),
                      BeaconCodec.unhex(pubkey, length: BeaconCodec.pubkeyBytes) != nil,
                      let key = BeaconCodec.unhex(row["beaconKeyHex"] as? String, length: 32) else {
                    return nil
                }
                let priority = (row["priority"] as? NSNumber)?.doubleValue ?? 0
                return Contact(pubkey: pubkey, key: key, priority: priority, name: row["name"] as? String ?? "")
            }.sorted { $0.priority < $1.priority }
            let known = Set(self.contacts.map(\.pubkey))
            if self.nearby.keys.contains(where: { !known.contains($0) }) {
                self.nearby = self.nearby.filter { known.contains($0.key) }
                self.dispatchNearby()
            }
            call.resolve([:])
        }
    }

    @objc func setTrade(_ call: CAPPluginCall) {
        let next: UInt8 = switch call.getString("trade") {
        case "buy": BeaconCodec.stateBuy
        case "sell": BeaconCodec.stateSell
        default: BeaconCodec.stateNearby
        }
        DispatchQueue.main.async {
            if self.trade != next {
                self.trade = next
                // A fresh nonce keeps one (slot, nonce) mask from ever covering two different states.
                self.nonce &+= 1
            }
            call.resolve([:])
        }
    }

    @objc func setIdentity(_ call: CAPPluginCall) {
        let pubkey = BeaconCodec.unhex(call.getString("pubkey"), length: BeaconCodec.pubkeyBytes)
        DispatchQueue.main.async {
            self.identity = pubkey
            call.resolve([:])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.permissionState == "granted" {
                self.running = true
                UserDefaults.standard.set(true, forKey: Self.runningDefaultsKey)
                self.ensureManagers()
                self.updatePeripheral()
                self.updateScan()
                self.updateTimer()
            }
            self.dispatchStatus(force: true)
            self.dispatchNearby()
            call.resolve([:])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.running = false
            UserDefaults.standard.removeObject(forKey: Self.runningDefaultsKey)
            self.updatePeripheral()
            self.updateScan()
            self.updateTimer()
            self.handshakes.values.forEach { self.finishHandshake($0.peripheral) }
            self.nearby.removeAll()
            self.notified.removeAll()
            self.servedPackets.removeAll()
            self.dispatchStatus(force: true)
            self.dispatchNearby()
            call.resolve([:])
        }
    }

    @objc func startIdentityScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.permissionState == "granted" {
                self.identityScanActive = true
                self.ensureManagers()
                self.updateScan()
                self.updateTimer()
            }
            call.resolve([:])
        }
    }

    @objc func stopIdentityScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.identityScanActive = false
            self.updateScan()
            self.updateTimer()
            self.identities.removeAll()
            self.identityParts.removeAll()
            self.dispatchIdentities()
            call.resolve([:])
        }
    }

    @objc func isRunning(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["running": self.running])
        }
    }

    /// iOS has no persistent notification with a Stop action, so the user never stops the beacon outside the app.
    @objc func takeStoppedByUser(_ call: CAPPluginCall) {
        call.resolve(["stopped": false])
    }

    // MARK: State

    private var permissionState: String {
        if central?.state == .unsupported {
            return "unsupported"
        }
        switch CBManager.authorization {
        case .allowedAlways: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    private var bluetoothOn: Bool {
        central?.state == .poweredOn
    }

    private var appActive: Bool {
        UIApplication.shared.applicationState == .active
    }

    private func ensureManagers() {
        if central == nil {
            central = CBCentralManager(delegate: self, queue: nil, options: [
                CBCentralManagerOptionRestoreIdentifierKey: "fit.linky.beacon.central",
                CBCentralManagerOptionShowPowerAlertKey: false
            ])
        }
        if peripheralManager == nil {
            peripheralManager = CBPeripheralManager(delegate: self, queue: nil, options: [
                CBPeripheralManagerOptionRestoreIdentifierKey: "fit.linky.beacon.peripheral",
                CBPeripheralManagerOptionShowPowerAlertKey: false
            ])
        }
    }

    private func updateTimer() {
        let wanted = running || identityScanActive
        if wanted == (tickTimer != nil) {
            return
        }
        tickTimer?.invalidate()
        tickTimer = wanted ? Timer.scheduledTimer(withTimeInterval: Self.tickInterval, repeats: true) { [weak self] _ in
            self?.tick()
        } : nil
    }

    private func tick() {
        let now = Date()
        lastHandshake = lastHandshake.filter { now.timeIntervalSince($0.value) < Self.handshakeThrottle }
        let freshNearby = nearby.filter { now.timeIntervalSince($0.value.lastSeen) < Self.nearbyTtl }
        if freshNearby.count != nearby.count || nearbyDirty {
            nearby = freshNearby
            dispatchNearby()
        }
        let freshIdentities = identities.filter { now.timeIntervalSince($0.value) < Self.nearbyTtl }
        if freshIdentities.count != identities.count {
            identities = freshIdentities
            dispatchIdentities()
        }
        updateScan()
    }

    @objc private func appStateChanged() {
        dispatchPermission()
        updateScan()
    }

    // MARK: Peripheral role

    private func updatePeripheral() {
        guard let peripheralManager, peripheralManager.state == .poweredOn else {
            return
        }
        peripheralManager.stopAdvertising()
        peripheralManager.removeAllServices()
        advertiseError = nil
        advertisingRequested = false
        guard running else {
            return
        }
        let service = CBMutableService(type: Self.serviceUUID, primary: true)
        service.characteristics = [
            CBMutableCharacteristic(
                type: Self.contactsUUID,
                properties: [.read, .write],
                value: nil,
                permissions: [.readable, .writeable]
            ),
            CBMutableCharacteristic(type: Self.identityUUID, properties: [.read], value: nil, permissions: [.readable])
        ]
        peripheralManager.add(service)
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        updatePeripheral()
        dispatchStatus()
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, willRestoreState dict: [String: Any]) {
        // Services and advertising are rebuilt from scratch once the restored manager powers on.
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error {
            advertiseError = "advertise_failed_\((error as NSError).code)"
            dispatchStatus()
            return
        }
        // Rebuilding the service while an add is pending reports didAdd twice, but advertising may start only once.
        guard !advertisingRequested else {
            return
        }
        advertisingRequested = true
        // In the background iOS moves these UUIDs to the overflow area, which only scans filtering on them can see.
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID, Self.overflowMarkerUUID]])
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        advertiseError = error.map { "advertise_failed_\(($0 as NSError).code)" }
        dispatchStatus()
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        let value: Data
        if request.characteristic.uuid == Self.contactsUUID {
            // Long reads arrive as several requests with growing offsets, so each central must see one packet throughout.
            let central = request.central.identifier
            value = request.offset == 0 ? ownPacket() : servedPackets[central] ?? ownPacket()
            servedPackets[central] = value
        } else {
            value = appActive ? identity ?? Data() : Data()
        }
        guard request.offset <= value.count else {
            peripheral.respond(to: request, withResult: .invalidOffset)
            return
        }
        request.value = value.subdata(in: request.offset..<value.count)
        peripheral.respond(to: request, withResult: .success)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        guard let first = requests.first else {
            return
        }
        // A long write arrives as one batch of prepared-write chunks, each placed at its offset.
        var packet = Data()
        for request in requests.sorted(by: { $0.offset < $1.offset }) where request.characteristic.uuid == Self.contactsUUID {
            packet = packet.prefix(request.offset) + (request.value ?? Data())
        }
        peripheral.respond(to: first, withResult: .success)
        merge(packet)
    }

    // MARK: Central role

    private func updateScan() {
        guard let central, central.state == .poweredOn else {
            return
        }
        // Restarting also resets the duplicate filter, so peers are reported again once their throttle ends.
        central.stopScan()
        scanningAll = identityScanActive && appActive
        if scanningAll {
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        } else if running {
            central.scanForPeripherals(
                withServices: [Self.serviceUUID],
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
            )
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn {
            handshakes.removeAll()
        }
        updateScan()
        dispatchPermission(force: true)
        dispatchStatus()
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        restored.forEach { central.cancelPeripheralConnection($0) }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        if identityScanActive, let manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
            collectIdentityPart(manufacturerData, from: peripheral.identifier)
        }
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
            + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
        if !scanningAll || services.contains(Self.serviceUUID) {
            startHandshake(peripheral)
        }
    }

    private func startHandshake(_ peripheral: CBPeripheral) {
        let id = peripheral.identifier
        var steps: [Step] = running ? [.readContacts, .writeContacts] : []
        if identityScanActive {
            steps.append(.readIdentity)
        }
        guard let central, !steps.isEmpty, handshakes[id] == nil, lastHandshake[id] == nil,
              handshakes.count < Self.maxHandshakes else {
            return
        }
        lastHandshake[id] = Date()
        handshakes[id] = Handshake(peripheral: peripheral, steps: steps)
        peripheral.delegate = self
        central.connect(peripheral)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.handshakeTimeout) { [weak self] in
            if self?.handshakes[id]?.peripheral === peripheral {
                self?.finishHandshake(peripheral)
            }
        }
    }

    private func finishHandshake(_ peripheral: CBPeripheral) {
        handshakes[peripheral.identifier] = nil
        central?.cancelPeripheralConnection(peripheral)
    }

    private func nextStep(_ peripheral: CBPeripheral) {
        guard var handshake = handshakes[peripheral.identifier], !handshake.steps.isEmpty else {
            finishHandshake(peripheral)
            return
        }
        let step = handshake.steps.removeFirst()
        handshakes[peripheral.identifier] = handshake
        let uuid = step == .readIdentity ? Self.identityUUID : Self.contactsUUID
        guard let characteristic = handshake.characteristics[uuid] else {
            finishHandshake(peripheral)
            return
        }
        if step == .writeContacts {
            peripheral.writeValue(ownPacket(), for: characteristic, type: .withResponse)
        } else {
            peripheral.readValue(for: characteristic)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        handshakes[peripheral.identifier] = nil
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        handshakes[peripheral.identifier] = nil
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            finishHandshake(peripheral)
            return
        }
        peripheral.discoverCharacteristics([Self.contactsUUID, Self.identityUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, var handshake = handshakes[peripheral.identifier] else {
            finishHandshake(peripheral)
            return
        }
        for characteristic in service.characteristics ?? [] {
            handshake.characteristics[characteristic.uuid] = characteristic
        }
        handshakes[peripheral.identifier] = handshake
        nextStep(peripheral)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let value = characteristic.value else {
            finishHandshake(peripheral)
            return
        }
        if characteristic.uuid == Self.contactsUUID {
            merge(value)
        } else if value.count == BeaconCodec.pubkeyBytes {
            addIdentity(value)
        }
        nextStep(peripheral)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil else {
            finishHandshake(peripheral)
            return
        }
        nextStep(peripheral)
    }

    // MARK: Contacts and identities

    private func ownPacket() -> Data {
        BeaconCodec.packet(keys: contacts.map(\.key), slot: BeaconCodec.slot(), nonce: nonce, state: trade)
    }

    private func merge(_ packet: Data) {
        guard running else {
            return
        }
        let keys = Dictionary(contacts.map { ($0.pubkey, $0.key) }, uniquingKeysWith: { first, _ in first })
        for (pubkey, state) in BeaconCodec.decode(packet, keys: keys, slot: BeaconCodec.slot()) {
            markSeen(pubkey, state: state)
        }
    }

    private func markSeen(_ pubkey: String, state: UInt8) {
        let previous = nearby.updateValue(Sighting(state: state, lastSeen: Date()), forKey: pubkey)
        if previous?.state == state {
            nearbyDirty = true
            return
        }
        dispatchNearby()
        if state != BeaconCodec.stateNearby, notified.insert(pubkey).inserted {
            notifyTrade(pubkey, state: state)
        }
    }

    // CoreBluetooth reports one manufacturer data blob per callback, so Android's two identity blocks are
    // collected across callbacks; the handshake's IDENTITY read covers peers whose second block never shows up.
    private func collectIdentityPart(_ manufacturerData: Data, from peer: UUID) {
        let part = BeaconCodec.identityPart(manufacturerData)
        guard part.first != nil || part.second != nil else {
            return
        }
        var parts = identityParts[peer] ?? (nil, nil)
        parts.first = part.first ?? parts.first
        parts.second = part.second ?? parts.second
        identityParts[peer] = parts
        if let first = parts.first, let second = parts.second {
            addIdentity(first + second)
        }
    }

    private func addIdentity(_ pubkey: Data) {
        guard identityScanActive else {
            return
        }
        if identities.updateValue(Date(), forKey: BeaconCodec.hex(pubkey)) == nil {
            dispatchIdentities()
        }
    }

    // MARK: Trade notifications

    private func notifyTrade(_ pubkey: String, state: UInt8) {
        let name = contacts.first(where: { $0.pubkey == pubkey })?.name ?? ""
        let content = UNMutableNotificationContent()
        content.title = name.isEmpty ? "Contact nearby" : name
        content.body = state == BeaconCodec.stateBuy ? "Nearby, buys BTC" : "Nearby, sells BTC"
        content.sound = .default
        content.userInfo = ["pubkey": pubkey]
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: Self.notificationPrefix + pubkey, content: content, trigger: nil)
        )
    }

    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        notification.request.identifier.hasPrefix(Self.notificationPrefix) ? [.banner, .list, .sound] : []
    }

    func didReceive(response: UNNotificationResponse) {
        let request = response.notification.request
        guard request.identifier.hasPrefix(Self.notificationPrefix),
              let pubkey = request.content.userInfo["pubkey"] as? String else {
            return
        }
        // Retained until the web app adds its listener, which covers taps that launched the app.
        notifyListeners("openConversation", data: ["pubkey": pubkey], retainUntilConsumed: true)
    }

    // MARK: Events

    private func dispatchPermission(force: Bool = false) {
        let state = permissionState
        if force || state != lastPermission {
            lastPermission = state
            notifyListeners("permission", data: ["state": state])
        }
    }

    /// Like Android, status flows only while running, plus one forced snapshot after start() and stop().
    private func dispatchStatus(force: Bool = false) {
        guard running || force else {
            return
        }
        let error: String? = switch permissionState {
        case "unsupported": "bluetooth_unavailable"
        case "granted": advertiseError
        default: "permission"
        }
        let status: [String: Any] = [
            "running": running,
            "bluetoothOn": bluetoothOn,
            "advertising": peripheralManager?.isAdvertising ?? false,
            "error": error ?? NSNull()
        ]
        if !force, let lastStatus, NSDictionary(dictionary: lastStatus).isEqual(to: status) {
            return
        }
        lastStatus = status
        notifyListeners("status", data: status)
    }

    private func dispatchNearby() {
        nearbyDirty = false
        let snapshot = nearby.map { pubkey, sighting in
            [
                "pubkey": pubkey,
                "state": sighting.state == BeaconCodec.stateBuy ? "buy" : sighting.state == BeaconCodec.stateSell ? "sell" : "nearby",
                "lastSeenMs": Int(sighting.lastSeen.timeIntervalSince1970 * 1000)
            ] as [String: Any]
        }
        notifyListeners("nearby", data: ["contacts": snapshot])
    }

    private func dispatchIdentities() {
        notifyListeners("identities", data: ["pubkeys": Array(identities.keys)])
    }
}
