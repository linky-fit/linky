// Lets Android devices reach Metro and the docker-compose.dev.yml services on this machine's localhost.
// Reverses every connected device, or only ANDROID_SERIAL when set.
import { $ } from "bun";

const ports = [8081, 7777, 4001, 3338, 3339, 8787];

const connectedSerials = async (): Promise<string[]> =>
  (await $`adb devices`.text())
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const [serial, state] = line.trim().split("\t");
      return serial && state === "device" ? [serial] : [];
    });

const serials = process.env.ANDROID_SERIAL
  ? [process.env.ANDROID_SERIAL]
  : await connectedSerials();

for (const serial of serials) {
  for (const port of ports)
    await $`adb -s ${serial} reverse tcp:${port} tcp:${port}`.quiet();
  console.log(`${serial}: reversed ${ports.join(", ")}`);
}
