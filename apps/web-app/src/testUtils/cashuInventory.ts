import { StoredOperation, StoredProof } from "@linky/linkshu";
import { Schema } from "effect";

interface StoredProofInput {
  amount?: number;
  id?: string;
  mint?: string;
  operationId?: string | null;
  secret?: string;
  state?: StoredProof["state"];
}

/** A stored proof in the shape linkshu hands the app; ids are valid Evolu ids. */
export const createStoredProofFixture = (
  input: StoredProofInput = {},
): StoredProof =>
  Schema.decodeUnknownSync(StoredProof)({
    id: input.id ?? "AAAAAAAAAAAAAAAAAAAAAA",
    mint: input.mint ?? "https://mint.example",
    unit: "sat",
    keysetId: "009a1f293253e41e",
    amount: input.amount ?? 100,
    secret: input.secret ?? `secret-${input.id ?? "a"}`,
    C: "02" + "ab".repeat(32),
    dleq: null,
    state: input.state ?? "available",
    operationId: input.operationId ?? null,
    createdAt: 1,
  });

interface StoredOperationInput {
  amount?: number;
  error?: string | null;
  id?: string;
  kind?: "send" | "receive";
  mint?: string;
  status?: StoredOperation["status"];
  tokenText?: string;
}

/** A `send` or `receive` transfer operation. */
export const createTransferFixture = (
  input: StoredOperationInput = {},
): StoredOperation =>
  Schema.decodeUnknownSync(StoredOperation)({
    id: input.id ?? "AQEBAQEBAQEBAQEBAQEBAQ",
    kind: input.kind ?? "send",
    status: input.status ?? "issued",
    mint: input.mint ?? "https://mint.example",
    unit: "sat",
    keysetId: null,
    amount: input.amount ?? 100,
    feeReserve: null,
    inputsTotal: null,
    quoteId: null,
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: 1,
    tokenText: input.tokenText ?? "cashuBtest",
    error: input.error ?? null,
  });
