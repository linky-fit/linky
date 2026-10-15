import { describe, expect, it } from "vitest";
import { announceLogin, onLoginElsewhere } from "./api";

const pubkey = "ab".repeat(32);

const received = (publish: () => void): Promise<string[]> => {
  const keys: string[] = [];
  const stop = onLoginElsewhere((key) => keys.push(key));
  publish();
  return new Promise((resolve) =>
    setTimeout(() => {
      stop();
      resolve(keys);
    }, 50),
  );
};

describe("login finished in another tab", () => {
  it("reaches a tab that is still waiting", async () => {
    expect(await received(() => announceLogin(pubkey))).toEqual([pubkey]);
  });

  it("ignores anything that is not a public key", async () => {
    const channel = new BroadcastChannel("linky.demo_auth.login");
    const keys = await received(() => channel.postMessage("not-a-key"));
    channel.close();
    expect(keys).toEqual([]);
  });
});
