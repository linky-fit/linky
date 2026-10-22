import { Effect, Schema } from "effect";
import { sameBitcoinAddress } from "./bitcoin";
import { NonNegativeInt } from "./schema";

/** The fields of an Esplora transaction the transfer needs; the rest is ignored. */
export const EsploraTransaction = Schema.Struct({
  txid: Schema.String,
  /** The outputs it spends; a coinbase input has no `prevout`. */
  vin: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        prevout: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              scriptpubkey_address: Schema.optionalKey(Schema.String),
            }),
          ),
        ),
      }),
    ),
  ),
  vout: Schema.Array(
    Schema.Struct({
      scriptpubkey_address: Schema.optionalKey(Schema.String),
      value: NonNegativeInt,
    }),
  ),
  status: Schema.Struct({
    confirmed: Schema.Boolean,
    block_height: Schema.optionalKey(NonNegativeInt),
  }),
});
export type EsploraTransaction = typeof EsploraTransaction.Type;

export class EsploraError extends Schema.TaggedError<EsploraError>()(
  "EsploraError",
  {
    url: Schema.String,
    /** The HTTP status for a non-2xx answer. */
    status: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

/** The subset of `fetch` the client calls; pass `globalThis.fetch` or a fake. */
export type EsploraFetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

export interface EsploraClient {
  /** `GET /address/:address/txs`: the newest mempool and confirmed transactions. */
  readonly addressTransactions: (
    address: string,
  ) => Effect.Effect<ReadonlyArray<EsploraTransaction>, EsploraError>;
  /** `GET /blocks/tip/height`. */
  readonly tipHeight: () => Effect.Effect<number, EsploraError>;
  /** `GET /tx/:txid`. */
  readonly transaction: (
    txid: string,
  ) => Effect.Effect<EsploraTransaction, EsploraError>;
}

const AddressTransactionsJson = Schema.fromJsonString(
  Schema.Array(EsploraTransaction),
);
const TipHeightJson = Schema.fromJsonString(NonNegativeInt);
const TransactionJson = Schema.fromJsonString(EsploraTransaction);

/** An Esplora HTTP API client (mempool.space, Blockstream, electrs). */
export const makeEsploraClient = (options: {
  /** The API root, e.g. `https://mempool.space/api`. */
  readonly baseUrl: string;
  readonly fetch: EsploraFetch;
}): EsploraClient => {
  const root = options.baseUrl.replace(/\/+$/, "");
  const get = <A>(
    path: string,
    schema: Schema.Codec<A, string>,
  ): Effect.Effect<A, EsploraError> => {
    const url = `${root}${path}`;
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => options.fetch(url),
        catch: (cause) => new EsploraError({ url, message: String(cause) }),
      });
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new EsploraError({ url, message: String(cause) }),
      });
      if (!response.ok) {
        return yield* new EsploraError({
          url,
          status: response.status,
          message: body.slice(0, 200),
        });
      }
      return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(
          (error) => new EsploraError({ url, message: error.message }),
        ),
      );
    });
  };
  return {
    addressTransactions: (address) =>
      get(
        `/address/${encodeURIComponent(address)}/txs`,
        AddressTransactionsJson,
      ),
    tipHeight: () => get("/blocks/tip/height", TipHeightJson),
    transaction: (txid) =>
      get(`/tx/${encodeURIComponent(txid)}`, TransactionJson),
  };
};

/** Sats `tx` sends to `address`, summed over its outputs; a bech32 address matches in either case. */
export const paysAddress = (tx: EsploraTransaction, address: string): number =>
  tx.vout.reduce(
    (sum, output) =>
      output.scriptpubkey_address !== undefined &&
      sameBitcoinAddress(output.scriptpubkey_address, address)
        ? sum + output.value
        : sum,
    0,
  );

const confirmationsOf = (tx: EsploraTransaction, tipHeight: number): number =>
  tx.status.confirmed && tx.status.block_height !== undefined
    ? Math.max(0, tipHeight - tx.status.block_height + 1)
    : 0;

export interface DepositStatus {
  /** Sats every transaction paying the address sends to it. */
  readonly receivedSat: number;
  /** The least confirmed of those transactions' confirmations; 0 while any is unconfirmed or none exists. */
  readonly confirmations: number;
  readonly txids: ReadonlyArray<string>;
}

/** What the transactions paying `address` add up to. */
export const depositStatus = (args: {
  readonly address: string;
  readonly transactions: ReadonlyArray<EsploraTransaction>;
  readonly tipHeight: number;
}): DepositStatus => {
  const paying = args.transactions.filter(
    (tx) => paysAddress(tx, args.address) > 0,
  );
  return {
    receivedSat: paying.reduce(
      (sum, tx) => sum + paysAddress(tx, args.address),
      0,
    ),
    confirmations:
      paying.length === 0
        ? 0
        : Math.min(...paying.map((tx) => confirmationsOf(tx, args.tipHeight))),
    txids: paying.map((tx) => tx.txid),
  };
};
