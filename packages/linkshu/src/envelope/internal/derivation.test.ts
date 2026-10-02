import { EnvelopeKey } from "../../domain/primitives";
import {
  ENVELOPE_SLOTS,
  envelopeOutputs,
  envelopeProbeOutputs,
  firstEnvelopeSecret,
} from "./derivation";

const seed = new Uint8Array(64).fill(7);
const key = EnvelopeKey.make("recurring:order-1:0");
const blinded = (outputs: ReadonlyArray<{ blindedMessage: { B_: string } }>) =>
  outputs.map((output) => output.blindedMessage.B_);

describe("envelope derivation", () => {
  it("splits the amount into ascending powers of two, one slot each", () => {
    expect(
      envelopeOutputs(seed, key, 13, "00aa").map((output) =>
        output.blindedMessage.amount.toNumber(),
      ),
    ).toEqual([1, 4, 8]);
  });

  it("derives the same blinded messages for a key whatever the keyset or amount", () => {
    const funded = blinded(envelopeOutputs(seed, key, 13, "00aa"));
    const otherFunding = blinded(envelopeOutputs(seed, key, 2, "00bb"));
    const probed = blinded(envelopeProbeOutputs(seed, key, "00cc"));

    expect(otherFunding[0]).toBe(funded[0]);
    expect(probed).toHaveLength(ENVELOPE_SLOTS);
    expect(probed.slice(0, 3)).toEqual(funded);
    expect(
      new TextDecoder().decode(
        envelopeOutputs(seed, key, 1, "00aa")[0]?.secret,
      ),
    ).toBe(firstEnvelopeSecret(seed, key));
  });

  it("derives unrelated messages for another key or seed", () => {
    const funded = blinded(envelopeOutputs(seed, key, 1, "00aa"));
    const otherKey = blinded(
      envelopeOutputs(seed, EnvelopeKey.make("recurring:order-1:1"), 1, "00aa"),
    );
    const otherSeed = blinded(
      envelopeOutputs(new Uint8Array(64).fill(8), key, 1, "00aa"),
    );

    expect(otherKey[0]).not.toBe(funded[0]);
    expect(otherSeed[0]).not.toBe(funded[0]);
  });
});
