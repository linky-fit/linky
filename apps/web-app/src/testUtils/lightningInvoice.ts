import { bech32 } from "@scure/base";

export const invoiceTimestamp = 1_750_000_000;

const words = (value: number, size = 0): number[] => {
  const result: number[] = [];
  do {
    result.unshift(value % 32);
    value = Math.floor(value / 32);
  } while (value > 0);
  while (result.length < size) result.unshift(0);
  return result;
};

export const makeLightningInvoice = (amount = "20u", expiry = 3600): string => {
  const hash = bech32.toWords(new Uint8Array(32).fill(1));
  const description = bech32.toWords(
    new TextEncoder().encode("Username purchase"),
  );
  const expiration = words(expiry);
  return bech32.encode(
    `lnbc${amount}`,
    [
      ...words(invoiceTimestamp, 7),
      1,
      ...words(hash.length, 2),
      ...hash,
      13,
      ...words(description.length, 2),
      ...description,
      6,
      ...words(expiration.length, 2),
      ...expiration,
      ...new Array<number>(104).fill(0),
    ],
    5000,
  );
};
