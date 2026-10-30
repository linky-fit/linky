import { Result } from "effect";
import {
  readBankAccounts,
  readBankHistoryPage,
  type BankAccount,
  type BankHistoryRange,
  type BankTransfer,
} from "../domain";

/** Why a call to the bank failed: it refused the token, it or the relay did not answer, or it refused the request. */
export type MonetaFailure = "unauthorized" | "unreachable" | "rejected";

/**
 * MONETA's business API, reached through the app's own origin because the
 * bank answers no browser directly: `api/moneta.ts` relays on Vercel, the
 * dev server proxies. The token travels only in the request's header.
 */
export interface MonetaApi {
  /** The accounts the token sees. */
  readonly accounts: (
    token: string,
  ) => Promise<Result.Result<readonly BankAccount[], MonetaFailure>>;
  /** The incoming transfers of the account within the range, every page read. */
  readonly transactions: (
    token: string,
    accountId: string,
    range: BankHistoryRange,
  ) => Promise<Result.Result<readonly BankTransfer[], MonetaFailure>>;
}

export const MONETA_API_PATH = "/api/moneta";
const TIMEOUT_MS = 12_000;
const PAGE_SIZE = 100;
/** Enough for a day of a busy terminal; older payments are no longer watched. */
const MAX_PAGES = 5;

export const createMonetaApi = (
  fetchFn: typeof fetch = fetch,
  basePath: string = MONETA_API_PATH,
): MonetaApi => {
  const get = async (
    path: string,
    token: string,
    query: Record<string, string> = {},
  ): Promise<Result.Result<unknown, MonetaFailure>> => {
    const search = new URLSearchParams(query).toString();
    let response: Response;
    try {
      response = await fetchFn(
        `${basePath}/${path}${search === "" ? "" : `?${search}`}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch {
      return Result.fail("unreachable");
    }
    if (response.status === 401 || response.status === 403) {
      return Result.fail("unauthorized");
    }
    if (response.status === 429 || response.status >= 500) {
      return Result.fail("unreachable");
    }
    if (!response.ok) return Result.fail("rejected");
    try {
      return Result.succeed<unknown>(await response.json());
    } catch {
      return Result.fail("rejected");
    }
  };

  return {
    accounts: async (token) =>
      Result.map(await get("accounts", token), readBankAccounts),
    transactions: async (token, accountId, range) => {
      const transfers: BankTransfer[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await get(
          `accounts/${encodeURIComponent(accountId)}/transactions`,
          token,
          { ...range, page: String(page), size: String(PAGE_SIZE) },
        );
        if (Result.isFailure(result)) return Result.fail(result.failure);
        const read = readBankHistoryPage(result.success);
        transfers.push(...read.transfers);
        if (page + 1 >= read.pageCount) break;
      }
      return Result.succeed(transfers);
    },
  };
};
