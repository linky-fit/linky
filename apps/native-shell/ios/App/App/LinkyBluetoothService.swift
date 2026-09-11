import CoreBluetooth

struct LinkyBluetoothService {
    let mesh: CBCharacteristic
    let identity: CBCharacteristic?

    static func select(from services: [CBService], meshUUID: CBUUID, identityUUID: CBUUID) -> Self? {
        let candidates = services.compactMap { service -> Self? in
            let characteristics = (service.characteristics ?? []).filter {
                $0.properties.contains(.notify)
                    && ($0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse))
            }
            guard let mesh = characteristics.first(where: { $0.uuid == meshUUID }) else { return nil }
            return Self(mesh: mesh, identity: characteristics.first(where: { $0.uuid == identityUUID }))
        }
        return candidates.first(where: { $0.identity != nil }) ?? candidates.first
    }
}
