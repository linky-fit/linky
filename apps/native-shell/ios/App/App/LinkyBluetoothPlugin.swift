import Capacitor
import CoreBluetooth
import UIKit

@objc(LinkyBluetoothPlugin)
final class LinkyBluetoothPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate,
    CBPeripheralManagerDelegate, CBPeripheralDelegate {
    let identifier = "LinkyBluetoothPlugin"
    let jsName = "LinkyBluetooth"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise)
    ]

    private static let serviceUUID = CBUUID(string: "F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C")
    private static let meshUUID = CBUUID(string: "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D")
    private static let identityUUID = CBUUID(string: "75B7A4D1-6620-4B5C-92C3-4EB8D918D097")
    private static let maxPeers = 32
    private static let maxQueue = 256

    private final class Client {
        let id = UUID().uuidString
        let peripheral: CBPeripheral
        var mesh: CBCharacteristic?
        var identity: CBCharacteristic?
        var pendingServices = Set<ObjectIdentifier>()
        var discoveredServices: [CBService] = []
        var announced = false
        var identitySubscriptionPending = false
        var incoming: [(characteristic: CBUUID, data: Data)] = []
        var writing: Outgoing?
        var queue: [Outgoing] = []
        let created = Date()

        init(_ peripheral: CBPeripheral) { self.peripheral = peripheral }

        var maxPacketSize: Int {
            [mesh, identity].compactMap { $0 }.map {
                peripheral.maximumWriteValueLength(for: $0.properties.contains(.writeWithoutResponse)
                    ? .withoutResponse : .withResponse)
            }.min() ?? 20
        }
    }

    private final class Subscriber {
        let id = UUID().uuidString
        let central: CBCentral
        var mesh = false
        var identity = false

        init(_ central: CBCentral) { self.central = central }
    }

    private struct Outgoing {
        let peerId: String
        let characteristic: CBCharacteristic
        let data: Data
        let call: CAPPluginCall
        let created = Date()
    }

    private var centralManager: CBCentralManager?
    private var peripheralManager: CBPeripheralManager?
    private var mesh: CBMutableCharacteristic?
    private var identity: CBMutableCharacteristic?
    private var service: CBMutableService?
    private var clients: [UUID: Client] = [:]
    private var subscribers: [UUID: Subscriber] = [:]
    private var notifications: [Outgoing] = []
    private var stateCalls: [CAPPluginCall] = []
    private var requested = false
    private var active = false
    private var maintenance: Timer?

    override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foregrounded),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        maintenance?.invalidate()
    }

    private var permission: String {
        switch CBManager.authorization {
        case .allowedAlways: return "granted"
        case .notDetermined: return "prompt"
        case .denied, .restricted: return "denied"
        @unknown default: return "denied"
        }
    }

    private var state: JSObject {
        ["supported": centralManager?.state != .unsupported && peripheralManager?.state != .unsupported,
         "permission": permission,
         "powered": centralManager?.state == .poweredOn && peripheralManager?.state == .poweredOn,
         "active": active]
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.permission == "granted" {
                self.ensureManagers()
                self.waitForState(call)
            } else {
                call.resolve(self.state)
            }
        }
    }

    @objc override func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.ensureManagers()
            self.waitForState(call)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .background else {
                call.reject("Bluetooth chat requires Linky in the foreground.")
                return
            }
            self.requested = true
            self.ensureManagers()
            self.updateActivity()
            self.waitForState(call)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.requested = false
            self.stopRadios()
            self.emitState()
            call.resolve(self.state)
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.active,
                  let peerId = call.getString("peerId"),
                  let lane = call.getString("lane"), lane == "mesh" || lane == "identity",
                  let encoded = call.getString("data"), encoded.utf8.count <= 684,
                  let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 512 else {
                call.reject("Invalid Bluetooth packet or inactive transport.")
                return
            }
            let queued = self.notifications.count + self.clients.values.reduce(0) {
                $0 + $1.queue.count + ($1.writing == nil ? 0 : 1)
            }
            guard queued < Self.maxQueue else {
                call.reject("Bluetooth send queue is full.")
                return
            }
            if let client = self.clients.values.first(where: { $0.id == peerId }), client.announced,
               let characteristic = lane == "mesh" ? client.mesh : client.identity,
               characteristic.isNotifying, data.count <= client.maxPacketSize {
                client.queue.append(Outgoing(peerId: peerId, characteristic: characteristic, data: data, call: call))
                self.drain(client)
            } else if let subscriber = self.subscribers.values.first(where: { $0.id == peerId }),
                      lane == "mesh" ? subscriber.mesh : subscriber.identity,
                      let characteristic = lane == "mesh" ? self.mesh : self.identity,
                      data.count <= subscriber.central.maximumUpdateValueLength {
                self.notifications.append(Outgoing(peerId: peerId, characteristic: characteristic, data: data, call: call))
                self.drainNotifications()
            } else {
                call.reject("Bluetooth peer or characteristic unavailable, or packet exceeds its limit.")
            }
        }
    }

    private func ensureManagers() {
        if centralManager == nil {
            centralManager = CBCentralManager(delegate: self, queue: .main,
                options: [CBCentralManagerOptionShowPowerAlertKey: false])
            peripheralManager = CBPeripheralManager(delegate: self, queue: .main,
                options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
        }
    }

    private func waitForState(_ call: CAPPluginCall) {
        guard stateCalls.count < 16 else {
            call.reject("Bluetooth state request already pending.")
            return
        }
        stateCalls.append(call)
        resolveStateCalls()
    }

    private func resolveStateCalls() {
        let unsupported = centralManager?.state == .unsupported || peripheralManager?.state == .unsupported
        guard unsupported || (permission != "prompt"
            && centralManager?.state != .unknown && centralManager?.state != .resetting
            && peripheralManager?.state != .unknown && peripheralManager?.state != .resetting) else { return }
        let calls = stateCalls
        stateCalls.removeAll()
        calls.forEach { $0.resolve(state) }
    }

    private func emitState() {
        notifyListeners("state", data: state)
        resolveStateCalls()
    }

    private func fail(_ message: String) { notifyListeners("error", data: ["message": message]) }

    @objc private func backgrounded() {
        requested = false
        stopRadios()
        emitState()
    }

    @objc private func foregrounded() { emitState() }

    private func updateActivity() {
        guard requested, permission == "granted", UIApplication.shared.applicationState != .background,
              centralManager?.state == .poweredOn, peripheralManager?.state == .poweredOn else {
            if active { requested = false }
            stopRadios()
            emitState()
            return
        }
        guard !active else { emitState(); return }
        active = true
        let properties: CBCharacteristicProperties = [.notify, .write, .writeWithoutResponse, .read]
        mesh = CBMutableCharacteristic(type: Self.meshUUID, properties: properties, value: nil,
            permissions: [.readable, .writeable])
        identity = CBMutableCharacteristic(type: Self.identityUUID, properties: properties, value: nil,
            permissions: [.readable, .writeable])
        let newService = CBMutableService(type: Self.serviceUUID, primary: true)
        newService.characteristics = [mesh, identity].compactMap { $0 }
        service = newService
        peripheralManager?.add(newService)
        centralManager?.scanForPeripherals(withServices: [Self.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        maintenance = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.expirePending()
        }
        emitState()
    }

    private func stopRadios() {
        active = false
        maintenance?.invalidate()
        maintenance = nil
        if centralManager?.state == .poweredOn { centralManager?.stopScan() }
        if peripheralManager?.state == .poweredOn {
            peripheralManager?.stopAdvertising()
            peripheralManager?.removeAllServices()
        }
        for client in Array(clients.values) { remove(client) }
        for subscriber in subscribers.values where subscriber.mesh { emit(subscriber, connected: false) }
        subscribers.removeAll()
        notifications.forEach { $0.call.reject("Bluetooth stopped.") }
        notifications.removeAll()
        service = nil
        mesh = nil
        identity = nil
    }

    private func expirePending() {
        let deadline = Date().addingTimeInterval(-20)
        for client in Array(clients.values) {
            if (!client.announced && client.created < deadline)
                || (client.writing?.created ?? Date()) < deadline
                || (client.queue.first?.created ?? Date()) < deadline {
                remove(client)
            }
        }
        let expired = notifications.filter { $0.created < deadline }
        notifications.removeAll { $0.created < deadline }
        expired.forEach { $0.call.reject("Bluetooth send timed out.") }
    }

    private func emit(_ client: Client, connected: Bool) {
        notifyListeners("peer", data: ["id": client.id, "connected": connected,
            "identity": client.identity?.isNotifying == true, "maxPacketSize": min(512, client.maxPacketSize)])
    }

    private func emit(_ subscriber: Subscriber, connected: Bool) {
        notifyListeners("peer", data: ["id": subscriber.id, "connected": connected,
            "identity": subscriber.identity, "maxPacketSize": min(512, subscriber.central.maximumUpdateValueLength)])
    }

    private func packet(_ peerId: String, characteristic: CBUUID, data: Data) {
        guard active, !data.isEmpty, data.count <= 512,
              characteristic == Self.meshUUID || characteristic == Self.identityUUID else { return }
        notifyListeners("packet", data: ["peerId": peerId,
            "lane": characteristic == Self.meshUUID ? "mesh" : "identity", "data": data.base64EncodedString()])
    }

    private func remove(_ client: Client) {
        clients.removeValue(forKey: client.peripheral.identifier)
        client.peripheral.delegate = nil
        if centralManager?.state == .poweredOn { centralManager?.cancelPeripheralConnection(client.peripheral) }
        if client.announced { emit(client, connected: false) }
        client.writing?.call.reject("Bluetooth peer disconnected.")
        client.queue.forEach { $0.call.reject("Bluetooth peer disconnected.") }
    }

    private func drain(_ client: Client) {
        while client.writing == nil, let next = client.queue.first {
            let withoutResponse = next.characteristic.properties.contains(.writeWithoutResponse)
            if withoutResponse && !client.peripheral.canSendWriteWithoutResponse { return }
            client.queue.removeFirst()
            if !withoutResponse { client.writing = next }
            client.peripheral.writeValue(next.data, for: next.characteristic,
                type: withoutResponse ? .withoutResponse : .withResponse)
            if withoutResponse { next.call.resolve() }
        }
    }

    private func drainNotifications() {
        guard let peripheralManager, active else { return }
        while let next = notifications.first {
            guard let subscriber = subscribers.values.first(where: { $0.id == next.peerId }),
                  let characteristic = next.characteristic.uuid == Self.meshUUID ? mesh : identity else {
                notifications.removeFirst().call.reject("Bluetooth peer disconnected.")
                continue
            }
            guard peripheralManager.updateValue(next.data, for: characteristic,
                onSubscribedCentrals: [subscriber.central]) else { return }
            notifications.removeFirst().call.resolve()
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) { updateActivity() }
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) { updateActivity() }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        guard active, service === self.service else { return }
        if let error {
            requested = false
            stopRadios()
            emitState()
            fail(error.localizedDescription)
            return
        }
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID]])
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        guard active, let error else { return }
        requested = false
        stopRadios()
        emitState()
        fail(error.localizedDescription)
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard active, clients[peripheral.identifier] == nil,
              clients.count + subscribers.count < Self.maxPeers else { return }
        let client = Client(peripheral)
        clients[peripheral.identifier] = client
        peripheral.delegate = self
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard active, clients[peripheral.identifier] != nil else {
            central.cancelPeripheralConnection(peripheral)
            return
        }
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if let client = clients[peripheral.identifier] { remove(client) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if let client = clients[peripheral.identifier] { remove(client) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let client = clients[peripheral.identifier] else { return }
        let services = (peripheral.services ?? []).filter { $0.uuid == Self.serviceUUID }
        guard error == nil, !services.isEmpty else {
            remove(client)
            return
        }
        client.discoveredServices.removeAll()
        client.pendingServices = Set(services.map(ObjectIdentifier.init))
        for service in services {
            peripheral.discoverCharacteristics([Self.meshUUID, Self.identityUUID], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let client = clients[peripheral.identifier],
              client.pendingServices.remove(ObjectIdentifier(service)) != nil else { return }
        if error == nil { client.discoveredServices.append(service) }
        guard client.pendingServices.isEmpty else { return }
        guard let selected = LinkyBluetoothService.select(from: client.discoveredServices,
            meshUUID: Self.meshUUID, identityUUID: Self.identityUUID) else { remove(client); return }
        client.mesh = selected.mesh
        client.identity = selected.identity
        client.discoveredServices.removeAll()
        client.identitySubscriptionPending = client.identity != nil
        peripheral.setNotifyValue(true, for: selected.mesh)
        if let identity = client.identity { peripheral.setNotifyValue(true, for: identity) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?) {
        guard let client = clients[peripheral.identifier] else { return }
        if characteristic.uuid == Self.meshUUID && (error != nil || !characteristic.isNotifying) {
            remove(client)
            return
        }
        if characteristic.uuid == Self.identityUUID { client.identitySubscriptionPending = false }
        if client.mesh?.isNotifying == true && !client.identitySubscriptionPending {
            client.announced = true
            emit(client, connected: true)
            for incoming in client.incoming {
                packet(client.id, characteristic: incoming.characteristic, data: incoming.data)
            }
            client.incoming.removeAll()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let client = clients[peripheral.identifier],
              let data = characteristic.value, !data.isEmpty, data.count <= 512 else { return }
        if !client.announced {
            if client.incoming.count < 16 { client.incoming.append((characteristic.uuid, data)) }
            return
        }
        packet(client.id, characteristic: characteristic.uuid, data: data)
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        if let client = clients[peripheral.identifier] { drain(client) }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let client = clients[peripheral.identifier], let writing = client.writing else { return }
        client.writing = nil
        if let error { writing.call.reject(error.localizedDescription) } else { writing.call.resolve() }
        drain(client)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
        didSubscribeTo characteristic: CBCharacteristic) {
        guard active, characteristic.uuid == Self.meshUUID || characteristic.uuid == Self.identityUUID else { return }
        guard subscribers[central.identifier] != nil || clients.count + subscribers.count < Self.maxPeers else { return }
        let subscriber = subscribers[central.identifier] ?? Subscriber(central)
        subscribers[central.identifier] = subscriber
        if characteristic.uuid == Self.meshUUID { subscriber.mesh = true }
        if characteristic.uuid == Self.identityUUID { subscriber.identity = true }
        if subscriber.mesh { emit(subscriber, connected: true) }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
        didUnsubscribeFrom characteristic: CBCharacteristic) {
        guard let subscriber = subscribers[central.identifier] else { return }
        if characteristic.uuid == Self.meshUUID {
            emit(subscriber, connected: false)
            subscriber.mesh = false
        }
        if characteristic.uuid == Self.identityUUID { subscriber.identity = false }
        if subscriber.mesh { emit(subscriber, connected: true) }
        if !subscriber.mesh && !subscriber.identity { subscribers.removeValue(forKey: central.identifier) }
        let dropped = notifications.filter { $0.peerId == subscriber.id && $0.characteristic.uuid == characteristic.uuid }
        notifications.removeAll { $0.peerId == subscriber.id && $0.characteristic.uuid == characteristic.uuid }
        dropped.forEach { $0.call.reject("Bluetooth subscription ended.") }
        drainNotifications()
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) { drainNotifications() }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        guard let first = requests.first else { return }
        for request in requests {
            guard active, request.offset == 0,
                  let subscriber = subscribers[request.central.identifier], subscriber.mesh,
                  request.characteristic.uuid == Self.meshUUID
                    || (request.characteristic.uuid == Self.identityUUID && subscriber.identity),
                  let data = request.value, !data.isEmpty, data.count <= 512 else {
                peripheral.respond(to: first, withResult: .unlikelyError)
                return
            }
        }
        for request in requests {
            if let subscriber = subscribers[request.central.identifier], let data = request.value {
                packet(subscriber.id, characteristic: request.characteristic.uuid, data: data)
            }
        }
        peripheral.respond(to: first, withResult: .success)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        guard active, request.characteristic.uuid == Self.meshUUID || request.characteristic.uuid == Self.identityUUID else {
            peripheral.respond(to: request, withResult: .readNotPermitted)
            return
        }
        guard request.offset == 0 else { peripheral.respond(to: request, withResult: .invalidOffset); return }
        request.value = Data()
        peripheral.respond(to: request, withResult: .success)
    }
}
