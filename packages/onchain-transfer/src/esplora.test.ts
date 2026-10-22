import { Effect } from "effect";
import {
  depositStatus,
  makeEsploraClient,
  paysAddress,
  type EsploraFetch,
  type EsploraTransaction,
} from "./esplora";

const address = "bcrt1pdeposit";
const other = "bcrt1pother";
const sender = "bcrt1qsender";

const tx = (
  txid: string,
  outputs: ReadonlyArray<readonly [string | null, number]>,
  blockHeight: number | null,
): EsploraTransaction => ({
  txid,
  vout: outputs.map(([to, value]) =>
    to === null ? { value } : { scriptpubkey_address: to, value },
  ),
  status:
    blockHeight === null
      ? { confirmed: false }
      : { confirmed: true, block_height: blockHeight },
});

describe("paysAddress", () => {
  it("sums the outputs paying the address", () => {
    expect(
      paysAddress(
        tx(
          "a",
          [
            [address, 1_000],
            [other, 5_000],
            [null, 7],
            [address, 500],
          ],
          null,
        ),
        address,
      ),
    ).toBe(1_500);
    expect(paysAddress(tx("b", [[other, 5_000]], null), address)).toBe(0);
  });

  it("matches an uppercase bech32 address against Esplora's lowercase one", () => {
    expect(
      paysAddress(tx("a", [[address, 1_000]], null), address.toUpperCase()),
    ).toBe(1_000);
    expect(
      depositStatus({
        address: address.toUpperCase(),
        transactions: [tx("a", [[address, 1_000]], 105)],
        tipHeight: 105,
      }).receivedSat,
    ).toBe(1_000);
  });
});

describe("depositStatus", () => {
  it("reports nothing for an address no transaction pays", () => {
    expect(
      depositStatus({
        address,
        transactions: [tx("a", [[other, 1]], 100)],
        tipHeight: 105,
      }),
    ).toEqual({ receivedSat: 0, confirmations: 0, txids: [] });
  });

  it("counts a transaction in the tip block as one confirmation", () => {
    expect(
      depositStatus({
        address,
        transactions: [tx("a", [[address, 100_000]], 105)],
        tipHeight: 105,
      }),
    ).toEqual({ receivedSat: 100_000, confirmations: 1, txids: ["a"] });
  });

  it("sums several deposits and takes the least confirmed", () => {
    expect(
      depositStatus({
        address,
        transactions: [
          tx("a", [[address, 60_000]], 100),
          tx("b", [[address, 40_000]], 104),
          tx("c", [[other, 9]], 90),
        ],
        tipHeight: 105,
      }),
    ).toEqual({ receivedSat: 100_000, confirmations: 2, txids: ["a", "b"] });
  });

  it("is unconfirmed while any deposit is in the mempool", () => {
    expect(
      depositStatus({
        address,
        transactions: [
          tx("a", [[address, 60_000]], 100),
          tx("b", [[address, 40_000]], null),
        ],
        tipHeight: 105,
      }),
    ).toEqual({ receivedSat: 100_000, confirmations: 0, txids: ["a", "b"] });
  });
});

const fakeFetch = (
  routes: Record<string, { readonly status?: number; readonly body: string }>,
): { readonly fetch: EsploraFetch; readonly urls: string[] } => {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url) => {
      urls.push(url);
      const route = routes[url];
      if (route === undefined) return Promise.reject(new Error("offline"));
      const status = route.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(route.body),
      });
    },
  };
};

const esploraTx = {
  txid: "a".repeat(64),
  version: 2,
  vin: [
    {
      txid: "b".repeat(64),
      vout: 0,
      prevout: { scriptpubkey: "0014", scriptpubkey_address: sender, value: 1 },
    },
    { txid: "0".repeat(64), vout: 0, is_coinbase: true, prevout: null },
  ],
  vout: [
    { scriptpubkey: "5120", scriptpubkey_address: address, value: 100_000 },
    { scriptpubkey: "6a", value: 0 },
  ],
  status: { confirmed: true, block_height: 101, block_hash: "00" },
};

describe("makeEsploraClient", () => {
  const base = "http://localhost:3002";

  it("reads an address's transactions, the tip height and one transaction, with the addresses it spends from", async () => {
    const { fetch, urls } = fakeFetch({
      [`${base}/address/${address}/txs`]: { body: JSON.stringify([esploraTx]) },
      [`${base}/blocks/tip/height`]: { body: "102" },
      [`${base}/tx/${esploraTx.txid}`]: { body: JSON.stringify(esploraTx) },
    });
    const client = makeEsploraClient({ baseUrl: `${base}/`, fetch });
    const expected = {
      ...tx(
        esploraTx.txid,
        [
          [address, 100_000],
          [null, 0],
        ],
        101,
      ),
      vin: [{ prevout: { scriptpubkey_address: sender } }, { prevout: null }],
    };

    await expect(
      Effect.runPromise(client.addressTransactions(address)),
    ).resolves.toEqual([expected]);
    await expect(Effect.runPromise(client.tipHeight())).resolves.toBe(102);
    await expect(
      Effect.runPromise(client.transaction(esploraTx.txid)),
    ).resolves.toEqual(expected);
    expect(urls).toEqual([
      `${base}/address/${address}/txs`,
      `${base}/blocks/tip/height`,
      `${base}/tx/${esploraTx.txid}`,
    ]);
  });

  const failure = (
    route: { readonly status?: number; readonly body: string } | null,
  ) => {
    const url = `${base}/blocks/tip/height`;
    const { fetch } = fakeFetch(route === null ? {} : { [url]: route });
    return Effect.runPromise(
      Effect.flip(makeEsploraClient({ baseUrl: base, fetch }).tipHeight()),
    );
  };

  it("fails with EsploraError when the request fails", async () => {
    await expect(failure(null)).resolves.toMatchObject({
      _tag: "EsploraError",
      message: "Error: offline",
    });
  });

  it("fails with EsploraError and the status for a non-2xx answer", async () => {
    await expect(
      failure({ status: 404, body: "Not found" }),
    ).resolves.toMatchObject({
      _tag: "EsploraError",
      status: 404,
      message: "Not found",
    });
  });

  it("fails with EsploraError for an answer that does not decode", async () => {
    const error = await failure({ body: "tip" });
    expect(error._tag).toBe("EsploraError");
    expect(error.status).toBeUndefined();
  });
});
