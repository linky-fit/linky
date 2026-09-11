import CoreBluetooth

@main
struct BluetoothServiceSelectionTests {
    static func main() {
        let serviceUUID = CBUUID(string: "F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C")
        let meshUUID = CBUUID(string: "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D")
        let identityUUID = CBUUID(string: "75B7A4D1-6620-4B5C-92C3-4EB8D918D097")
        func characteristic(_ uuid: CBUUID, _ properties: CBCharacteristicProperties = [.notify, .write]) -> CBMutableCharacteristic {
            CBMutableCharacteristic(type: uuid, properties: properties, value: nil, permissions: [.writeable])
        }
        func service(_ characteristics: [CBCharacteristic]) -> CBMutableService {
            let service = CBMutableService(type: serviceUUID, primary: true)
            service.characteristics = characteristics
            return service
        }
        func select(_ services: [CBService]) -> LinkyBluetoothService? {
            LinkyBluetoothService.select(from: services, meshUUID: meshUUID, identityUUID: identityUUID)
        }

        let bitchatMesh = characteristic(meshUUID)
        let bitchat = service([bitchatMesh])
        let linkyMesh = characteristic(meshUUID)
        let linkyIdentity = characteristic(identityUUID, [.notify, .writeWithoutResponse])
        let linky = service([linkyMesh, linkyIdentity])

        for services in [[bitchat, linky], [linky, bitchat]] {
            let selected = select(services)
            precondition(selected?.mesh === linkyMesh, "Must prefer Linky's service regardless of discovery order")
            precondition(selected?.identity === linkyIdentity, "Identity must belong to the selected mesh service")
        }
        precondition(select([bitchat])?.mesh === bitchatMesh, "BitChat-only peers must remain supported")
        precondition(select([bitchat])?.identity == nil)
        precondition(select([]) == nil)
        let identityOnly = service([characteristic(identityUUID)])
        precondition(select([bitchat, identityOnly])?.identity == nil, "Never combine characteristics across services")
        let unusable = service([characteristic(meshUUID, [.read]), characteristic(identityUUID)])
        precondition(select([unusable, bitchat])?.mesh === bitchatMesh)
        let readOnlyIdentity = service([characteristic(meshUUID), characteristic(identityUUID, [.notify])])
        precondition(select([readOnlyIdentity])?.identity == nil, "Identity exchange requires writes and notifications")
        print("Bluetooth service selection: 10 checks passed")
    }
}
