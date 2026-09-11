import { writeFile } from "node:fs/promises";
import { createMeshSession } from "../../src/bluetooth/mesh";

const destination = process.argv[2];
if (!destination) throw new Error("Pass an output file");
const packets: string[] = [];
const session = createMeshSession({
  signingKey: new Uint8Array(32).fill(11),
  noiseKey: new Uint8Array(32).fill(12),
  nickname: "Linky unicode žluťoučký",
  onMessage: () => {},
  onPeer: () => {},
  send: (_id, bytes) => {
    packets.push(Buffer.from(bytes).toString("hex"));
  },
});
try {
  session.connect("swift", 512);
  await session.sendMessage("Hello BitChat, from Linky 👋");
  await session.sendMessage("x".repeat(99));
  await session.sendMessage("😀".repeat(24));
  await writeFile(destination, packets.join("\n"));
} finally {
  session.dispose();
}
