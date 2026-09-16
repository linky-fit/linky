import { Schema } from "effect";
import { RelayUrl } from "./primitives";

describe("RelayUrl", () => {
  it.each([
    "wss://relay.example/path",
    "ws://localhost:7777",
    "ws://127.0.0.1:7777",
    "ws://[::1]:7777",
  ])("accepts %s", (url) => {
    expect(Schema.is(RelayUrl)(url)).toBe(true);
  });
  it.each([
    "ws://relay.example",
    "https://relay.example",
    "relay.example",
    "ws://localhost.evil.test",
    "ws://192.168.1.1",
    "wss://user:secret@relay.example",
    "wss://relay.example/#fragment",
  ])("rejects %s", (url) => {
    expect(Schema.is(RelayUrl)(url)).toBe(false);
  });
});
