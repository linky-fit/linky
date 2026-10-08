import CryptoKit
import Foundation

/// Beacon wire format shared with Android and the web app: packet = [version, nonce, entry...],
/// entry = h[0] || h[1] || (state ^ h[2]), h = HMAC-SHA256(beaconKey, uint32be(slot) || nonce).
enum BeaconCodec {
    static let version: UInt8 = 1
    static let stateNearby: UInt8 = 0
    static let stateBuy: UInt8 = 1
    static let stateSell: UInt8 = 2
    /// (512-byte ATT value limit - header) / entry size.
    static let maxEntries = 170
    static let pubkeyBytes = 32
    private static let headerBytes = 2
    private static let entryBytes = 3
    private static let slotSeconds: TimeInterval = 600
    private static let identityAdvPubkeyBytes = 22
    private static let identityAdvCompany: [UInt8] = [0xFD, 0xFF]
    private static let identityScanResponseCompany: [UInt8] = [0xFC, 0xFF]

    static func slot(at date: Date = Date()) -> Int64 {
        Int64((date.timeIntervalSince1970 / slotSeconds).rounded(.down))
    }

    static func entry(key: Data, slot: Int64, nonce: UInt8, state: UInt8) -> [UInt8] {
        let h = hmac(key: key, slot: slot, nonce: nonce)
        return [h[0], h[1], state ^ h[2]]
    }

    /// Keys in priority order; entries past `maxEntries` are dropped.
    static func packet(keys: [Data], slot: Int64, nonce: UInt8, state: UInt8) -> Data {
        var out: [UInt8] = [version, nonce]
        for key in keys.prefix(maxEntries) {
            out += entry(key: key, slot: slot, nonce: nonce, state: state)
        }
        return Data(out)
    }

    /// Returns contact -> state for every entry a contact's key produced in `slot` or a slot next to it.
    static func decode(_ packet: Data, keys: [String: Data], slot: Int64) -> [String: UInt8] {
        let bytes = [UInt8](packet)
        guard bytes.count >= headerBytes, bytes[0] == version, (bytes.count - headerBytes) % entryBytes == 0 else {
            return [:]
        }
        let nonce = bytes[1]
        var found: [String: UInt8] = [:]
        for candidateSlot in (slot - 1)...(slot + 1) {
            var table: [UInt16: [(contact: String, mask: UInt8)]] = [:]
            for (contact, key) in keys {
                let h = hmac(key: key, slot: candidateSlot, nonce: nonce)
                table[tag(h[0], h[1]), default: []].append((contact, h[2]))
            }
            for index in stride(from: headerBytes, to: bytes.count, by: entryBytes) {
                for candidate in table[tag(bytes[index], bytes[index + 1])] ?? [] {
                    let state = bytes[index + 2] ^ candidate.mask
                    if state <= stateSell {
                        found[candidate.contact] = state
                    }
                }
            }
        }
        return found
    }

    /// Splits an Android identity advertisement (CoreBluetooth manufacturer data, little-endian company id first)
    /// into its first part (company 0xFFFD: [version, pubkey[0..22)]) or second part (company 0xFFFC: pubkey[22..32)).
    static func identityPart(_ manufacturerData: Data) -> (first: Data?, second: Data?) {
        let bytes = [UInt8](manufacturerData)
        let company = Array(bytes.prefix(2))
        let body = Data(bytes.dropFirst(2))
        if company == identityAdvCompany, body.count == 1 + identityAdvPubkeyBytes, body.first == version {
            return (Data(body.dropFirst()), nil)
        }
        if company == identityScanResponseCompany, body.count == pubkeyBytes - identityAdvPubkeyBytes {
            return (nil, body)
        }
        return (nil, nil)
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// Returns nil unless `value` is hex of exactly `length` bytes.
    static func unhex(_ value: String?, length: Int) -> Data? {
        guard let value, value.count == length * 2 else {
            return nil
        }
        var out = Data(capacity: length)
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(index, offsetBy: 2)
            guard let byte = UInt8(value[index..<next], radix: 16) else {
                return nil
            }
            out.append(byte)
            index = next
        }
        return out
    }

    private static func hmac(key: Data, slot: Int64, nonce: UInt8) -> [UInt8] {
        let slotBytes = withUnsafeBytes(of: UInt32(truncatingIfNeeded: slot).bigEndian, Array.init)
        let mac = HMAC<SHA256>.authenticationCode(for: slotBytes + [nonce], using: SymmetricKey(data: key))
        return Array(mac)
    }

    private static func tag(_ first: UInt8, _ second: UInt8) -> UInt16 {
        UInt16(first) << 8 | UInt16(second)
    }
}
