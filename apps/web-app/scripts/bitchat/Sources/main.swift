// Generates independent fixtures and verifies Linky output with upstream BitFoundation.
import Foundation
import CryptoKit
import BitFoundation
let signingKey = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
let noiseKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: 9, count: 32))
let noisePublic = noiseKey.publicKey.rawRepresentation
let signingPublic = signingKey.publicKey.rawRepresentation
let sender = Data(SHA256.hash(data: noisePublic).prefix(8))
func hex(_ value: Data) -> String { value.map { String(format:"%02x", $0) }.joined() }
func emit(_ name: String, type: UInt8, payload: Data, version: UInt8 = 1, route: [Data]? = nil, timestamp: UInt64 = 1700000000000) {
 var packet = BitchatPacket(type:type,senderID:sender,recipientID:nil,timestamp:timestamp,payload:payload,signature:nil,ttl:7,version:version,route:route)
 packet.signature = try! signingKey.signature(for: packet.toBinaryDataForSigning()!)
 print(name+"="+hex(packet.toBinaryData(padding:false)!))
}
print("SIGNING="+hex(signingPublic)); print("NOISE="+hex(noisePublic)); print("SENDER="+hex(sender))
var announce = Data([1,10]); announce.append(Data("Swift peer".utf8)); announce.append(Data([2,32])); announce.append(noisePublic); announce.append(Data([3,32])); announce.append(signingPublic)
emit("ANNOUNCE",type:1,payload:announce)
emit("MESSAGE",type:2,payload:Data("Hello Linky 👋".utf8), timestamp:1700000000001)
let longText = "This is a fairly normal message with enough characters to compress. Perhaps we should compare several sentences and repeat the earlier normal message with enough characters to compress."
emit("COMPRESSED",type:2,payload:Data(longText.utf8),timestamp:1700000000002)
emit("ROUTED_V2",type:2,payload:Data("route testing".utf8),version:2,route:[Data(repeating:3,count:8)],timestamp:1700000000003)
var original = BitchatPacket(type:2,senderID:sender,recipientID:nil,timestamp:1700000000002,payload:Data(longText.utf8),signature:nil,ttl:7)
original.signature = try! signingKey.signature(for: original.toBinaryDataForSigning()!)
let full = original.toBinaryData(padding:false)!
let total = (full.count+63)/64
for index in 0..<total {
 var payload = Data(repeating:0x11,count:8)
 payload.append(UInt8(index>>8));payload.append(UInt8(index&255));payload.append(UInt8(total>>8));payload.append(UInt8(total&255));payload.append(2)
 payload.append(full[(index*64)..<min((index+1)*64,full.count)])
 let fragment = BitchatPacket(type:32,senderID:sender,recipientID:nil,timestamp:1700000000002,payload:payload,signature:nil,ttl:7)
 print("FRAGMENT_\(index)="+hex(fragment.toBinaryData(padding:false)!))
}
let linkyLines = try String(contentsOfFile:CommandLine.arguments[1],encoding:.utf8).split(separator:"\n")
let linkyKey = try Curve25519.Signing.PrivateKey(rawRepresentation:Data(repeating:11,count:32)).publicKey
for line in linkyLines {
 let hex = String(line)
 let bytes = Data(stride(from:0,to:hex.count,by:2).map { index -> UInt8 in
  let start = hex.index(hex.startIndex,offsetBy:index)
  let end = hex.index(start,offsetBy:2)
  return UInt8(hex[start..<end],radix:16)!
 })
 let packet = BitchatPacket.from(bytes)!
 guard let signature = packet.signature, let signingBytes = packet.toBinaryDataForSigning(), linkyKey.isValidSignature(signature,for:signingBytes) else { fatalError("LINKY SIGNATURE FAILED") }
 print("VERIFIED LINKY TYPE \(packet.type) PAYLOAD \(packet.payload.count) BYTES")
}
