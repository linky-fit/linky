import Foundation

private struct Vectors: Decodable {
    struct Vector: Decodable {
        let beaconKeyHex: String
        let slot: Int64
        let nonce: UInt8
        let state: UInt8
        let entryHex: String
    }

    let vectors: [Vector]
}

@main
enum CheckBeaconCodec {
    static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url)).vectors
        var failures: [String] = []
        func check(_ condition: Bool, _ message: String) {
            if !condition { failures.append(message) }
        }

        for vector in vectors {
            let key = BeaconCodec.unhex(vector.beaconKeyHex, length: 32)!
            let entry = BeaconCodec.entry(key: key, slot: vector.slot, nonce: vector.nonce, state: vector.state)
            check(BeaconCodec.hex(Data(entry)) == vector.entryHex, "entry \(vector.slot)/\(vector.nonce)/\(vector.state)")

            let packet = Data([BeaconCodec.version, vector.nonce] + entry)
            for slot in (vector.slot - 1)...(vector.slot + 1) {
                let decoded = BeaconCodec.decode(packet, keys: ["c": key], slot: slot)
                check(decoded == ["c": vector.state], "decode \(vector.entryHex) at slot \(slot)")
            }
            check(BeaconCodec.decode(packet, keys: ["c": key], slot: vector.slot + 2).isEmpty, "stale slot \(vector.entryHex)")
        }

        let keys = (1...200).map { Data(repeating: UInt8($0), count: 32) }
        let packet = BeaconCodec.packet(keys: keys, slot: 42, nonce: 7, state: BeaconCodec.stateSell)
        check(packet.count == 512, "packet capped at 512 bytes, got \(packet.count)")
        let table = Dictionary(uniqueKeysWithValues: keys.enumerated().map { ("c\($0.offset)", $0.element) })
        let decoded = BeaconCodec.decode(packet, keys: table, slot: 42)
        check(decoded["c0"] == BeaconCodec.stateSell && decoded["c169"] == BeaconCodec.stateSell, "round trip")
        check(decoded["c170"] == nil, "entries past the cap are dropped")

        var invalid = [UInt8](BeaconCodec.packet(keys: [keys[0]], slot: 42, nonce: 7, state: 0))
        invalid[4] ^= 3
        check(BeaconCodec.decode(Data(invalid), keys: ["c": keys[0]], slot: 42).isEmpty, "state above 2 is ignored")
        check(BeaconCodec.decode(Data([2, 7]), keys: ["c": keys[0]], slot: 42).isEmpty, "unknown version is ignored")

        let pubkey = Data((0..<32).map { UInt8($0) })
        let first = BeaconCodec.identityPart(Data([0xFD, 0xFF, 1]) + pubkey.prefix(22)).first
        let second = BeaconCodec.identityPart(Data([0xFC, 0xFF]) + pubkey.suffix(10)).second
        check(first.map { $0 + (second ?? Data()) } == pubkey, "identity parts")

        if failures.isEmpty {
            print("BeaconCodec: \(vectors.count) vectors and codec checks passed")
        } else {
            failures.forEach { print("FAIL \($0)") }
            exit(1)
        }
    }
}
