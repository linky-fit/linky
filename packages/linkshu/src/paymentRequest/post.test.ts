import { PaymentRequestId } from "./nut18";
import {
  isAllowedPaymentRequestPostUrl,
  postPaymentRequestPayload,
} from "./post";

const proof = {
  id: "00ad268c4d1f5826",
  amount: 8,
  secret: "secret",
  C: "02" + "ab".repeat(32),
};
const payload = {
  id: PaymentRequestId.make("req-1"),
  memo: "coffee",
  mint: "https://mint.example",
  unit: "sat",
  proofs: [proof],
};

const recordingFetch = (respond: () => Promise<Response>) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { calls, fetch };
};

describe("isAllowedPaymentRequestPostUrl", () => {
  it("allows https targets", () => {
    expect(
      isAllowedPaymentRequestPostUrl("https://pay.example/req", {
        allowHttp: false,
      }),
    ).toBe(true);
  });

  it("allows http targets only with allowHttp", () => {
    expect(
      isAllowedPaymentRequestPostUrl("http://pay.example/req", {
        allowHttp: false,
      }),
    ).toBe(false);
    expect(
      isAllowedPaymentRequestPostUrl("http://localhost:3338/req", {
        allowHttp: true,
      }),
    ).toBe(true);
  });

  it("rejects other schemes and unparseable input", () => {
    for (const url of [
      "ftp://pay.example",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(isAllowedPaymentRequestPostUrl(url, { allowHttp: true })).toBe(
        false,
      );
    }
  });
});

describe("postPaymentRequestPayload", () => {
  it("POSTs the payload as JSON without credentials", async () => {
    const http = recordingFetch(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    const outcome = await postPaymentRequestPayload({
      url: "https://pay.example/req",
      payload,
      fetch: http.fetch,
    });

    expect(outcome).toEqual({ _tag: "Delivered" });
    expect(http.calls).toHaveLength(1);
    const [call] = http.calls;
    expect(call?.url).toBe("https://pay.example/req");
    expect(call?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      mint: "https://mint.example",
      unit: "sat",
      proofs: [proof],
      id: "req-1",
      memo: "coffee",
    });
  });

  it("leaves out an empty id and memo", async () => {
    const http = recordingFetch(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );

    await postPaymentRequestPayload({
      url: "https://pay.example/req",
      payload: { ...payload, id: null, memo: "" },
      fetch: http.fetch,
    });

    expect(JSON.parse(String(http.calls[0]?.init?.body))).toEqual({
      mint: "https://mint.example",
      unit: "sat",
      proofs: [proof],
    });
  });

  it("sends nothing to an http url unless allowHttp", async () => {
    const http = recordingFetch(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    expect(
      await postPaymentRequestPayload({
        url: "http://pay.example/req",
        payload,
        fetch: http.fetch,
      }),
    ).toEqual({ _tag: "InsecureUrl" });
    expect(http.calls).toEqual([]);

    expect(
      await postPaymentRequestPayload({
        url: "http://localhost:3338/req",
        payload,
        allowHttp: true,
        fetch: http.fetch,
      }),
    ).toEqual({ _tag: "Delivered" });
  });

  it("reports a non-2xx answer and a failed request", async () => {
    expect(
      await postPaymentRequestPayload({
        url: "https://pay.example/req",
        payload,
        fetch: recordingFetch(() =>
          Promise.resolve(new Response(null, { status: 502 })),
        ).fetch,
      }),
    ).toEqual({ _tag: "HttpError", status: 502 });

    expect(
      await postPaymentRequestPayload({
        url: "https://pay.example/req",
        payload,
        fetch: recordingFetch(() =>
          Promise.reject(new TypeError("Failed to fetch")),
        ).fetch,
      }),
    ).toEqual({ _tag: "NetworkError", detail: "Failed to fetch" });
  });
});
