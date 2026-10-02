import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import { decryptPiccData, encryptPiccData, sunMac, verifySun } from "./sun";

// Test vectors from the boltcard specification (docs/TEST_VECTORS.md).
const keys = {
  k1: hexToBytes("0c3b25d92b38ae443229dd59ad34b85d"),
  k2: hexToBytes("b45775776cb224c75bcde7ca3704e933"),
};
const uid = hexToBytes("04996c6a926980");
const vectors = [
  { p: "4E2E289D945A66BB13377A728884E867", c: "E19CCB1FED8892CE", counter: 3 },
  { p: "00F48C4F8E386DED06BCDC78FA92E2FE", c: "66B4826EA4C155B4", counter: 5 },
  { p: "0DBF3C59B59B0638D60B5842A997D4D1", c: "CC61660C020B4D96", counter: 7 },
];

describe("SUN", () => {
  test.each(vectors)("decrypts and verifies counter $counter", (vector) => {
    const p = hexToBytes(vector.p);
    const c = hexToBytes(vector.c);
    const data = verifySun(keys, uid, p, c);
    expect(data?.counter).toBe(vector.counter);
    expect(bytesToHex(data?.uid ?? new Uint8Array())).toBe(bytesToHex(uid));
    expect(bytesToHex(sunMac(keys.k2, { uid, counter: vector.counter }))).toBe(
      vector.c.toLowerCase(),
    );
  });

  test("round-trips PICC data through encryption", () => {
    const random = hexToBytes("0102030405");
    const p = encryptPiccData(keys.k1, { uid, counter: 0x0a0b0c }, random);
    expect(decryptPiccData(keys.k1, p)?.counter).toBe(0x0a0b0c);
  });

  test("rejects a MAC from another counter", () => {
    const [first, second] = vectors;
    expect(
      verifySun(keys, uid, hexToBytes(first!.p), hexToBytes(second!.c)),
    ).toBeNull();
  });

  test("rejects another card's UID", () => {
    const [first] = vectors;
    expect(
      verifySun(
        keys,
        hexToBytes("04000000000000"),
        hexToBytes(first!.p),
        hexToBytes(first!.c),
      ),
    ).toBeNull();
  });

  test("rejects p that is not one block or has a wrong tag", () => {
    expect(decryptPiccData(keys.k1, new Uint8Array(15))).toBeNull();
    expect(decryptPiccData(keys.k1, new Uint8Array(16))).toBeNull();
  });

  test("refuses a counter past 3 bytes", () => {
    expect(() => sunMac(keys.k2, { uid, counter: 0x1_00_00_00 })).toThrow(
      RangeError,
    );
  });
});
