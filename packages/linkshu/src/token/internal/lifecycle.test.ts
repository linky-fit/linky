import { Effect, Exit } from "effect";
import { TokenText } from "../../domain/primitives";
import { inMemoryTokenStore } from "../../ports/inMemoryTokenStore";
import { TokenStore } from "../../ports/TokenStore";
import { recordingInspector } from "../../testing/inspector";
import {
  findRowByTokenText,
  insertRowInState,
  isLegalTransition,
  transitionRow,
} from "./lifecycle";

const original = TokenText.make("cashuAoriginal");
const reSigned = TokenText.make("cashuBresigned");

describe("isLegalTransition", () => {
  it("allows the documented lifecycle moves and rejects the rest", () => {
    expect(isLegalTransition("pending", "accepted")).toBe(true);
    expect(isLegalTransition("pending", "error")).toBe(true);
    expect(isLegalTransition("accepted", "issued")).toBe(true);
    expect(isLegalTransition("error", "accepted")).toBe(true);
    expect(isLegalTransition("accepted", "pending")).toBe(false);
    expect(isLegalTransition("error", "issued")).toBe(false);
    expect(isLegalTransition("externalized", "issued")).toBe(false);
  });
});

describe("insertRowInState / transitionRow", () => {
  it("persists transitions, clears error outside `error`, and emits events", async () => {
    const { events, service: inspector } = recordingInspector();

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* TokenStore;
        const row = yield* insertRowInState(store, inspector, {
          originalTokenText: original,
          tokenText: original,
          state: "pending",
          reason: "receive",
        });
        yield* transitionRow(store, inspector, row, "error", "receive", {
          error: '{"_tag":"MintRejected"}',
        });
        const errored = (yield* store.loadAll)[0];
        yield* transitionRow(store, inspector, errored, "accepted", "retry", {
          tokenText: reSigned,
        });
        return { row, rows: yield* store.loadAll };
      }).pipe(Effect.provide(inMemoryTokenStore)),
    );

    assert(Exit.isSuccess(exit));
    const stored = exit.value.rows[0];
    expect(stored.state).toBe("accepted");
    expect(stored.error).toBeNull();
    expect(stored.tokenText).toBe(reSigned);
    expect(stored.originalTokenText).toBe(original);

    expect(events).toEqual([
      expect.objectContaining({ from: null, to: "pending", reason: "receive" }),
      expect.objectContaining({
        from: "pending",
        to: "error",
        reason: "receive",
      }),
      expect.objectContaining({
        from: "error",
        to: "accepted",
        reason: "retry",
      }),
    ]);
  });

  it("fails illegal transitions with InvalidTokenTransition", async () => {
    const { service: inspector } = recordingInspector();

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* TokenStore;
        const row = yield* insertRowInState(store, inspector, {
          originalTokenText: original,
          tokenText: original,
          state: "accepted",
          reason: "test",
        });
        return yield* Effect.flip(
          transitionRow(store, inspector, row, "pending", "test"),
        );
      }).pipe(Effect.provide(inMemoryTokenStore)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toMatchObject({
      _tag: "InvalidTokenTransition",
      from: "accepted",
      to: "pending",
    });
  });
});

describe("findRowByTokenText", () => {
  it("matches the original encoding and the current one", async () => {
    const { service: inspector } = recordingInspector();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const store = yield* TokenStore;
        const row = yield* insertRowInState(store, inspector, {
          originalTokenText: original,
          tokenText: reSigned,
          state: "accepted",
          reason: "test",
        });
        const rows = yield* store.loadAll;
        return {
          byOriginal: findRowByTokenText(rows, original)?.id,
          byCurrent: findRowByTokenText(rows, reSigned)?.id,
          miss: findRowByTokenText(rows, TokenText.make("cashuAmiss")),
          rowId: row.id,
        };
      }).pipe(Effect.provide(inMemoryTokenStore)),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.byOriginal).toBe(exit.value.rowId);
    expect(exit.value.byCurrent).toBe(exit.value.rowId);
    expect(exit.value.miss).toBeNull();
  });
});
