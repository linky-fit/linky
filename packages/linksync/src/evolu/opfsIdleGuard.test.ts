import { SimpleName, type SqliteDriver, type SqliteQuery } from "@evolu/common";
import { guardOpfsIdle } from "./opfsIdleGuard";

const fakeDriver = () => {
  const queries: SqliteQuery[] = [];
  const driver: SqliteDriver = {
    exec: (query) => {
      queries.push(query);
      return { rows: [], changes: 0 };
    },
    export: () => new Uint8Array(),
    [Symbol.dispose]: () => {},
  };
  return { driver, queries };
};

const name = SimpleName.orThrow("Evolu");

describe("guardOpfsIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the database file every few minutes", async () => {
    const fake = fakeDriver();
    const driver = await guardOpfsIdle(async () => fake.driver)(name);

    vi.advanceTimersByTime(4 * 60_000 - 1);
    expect(fake.queries).toEqual([]);
    vi.advanceTimersByTime(8 * 60_000 + 1);
    expect(fake.queries.map((query) => query.sql)).toEqual([
      "select 1 from evolu_config limit 1;",
      "select 1 from evolu_config limit 1;",
      "select 1 from evolu_config limit 1;",
    ]);
    expect(driver).toBe(fake.driver);
  });

  it("leaves an in-memory database alone", async () => {
    const fake = fakeDriver();
    await guardOpfsIdle(async () => fake.driver)(name, { memory: true });

    vi.advanceTimersByTime(60 * 60_000);
    expect(fake.queries).toEqual([]);
  });
});
