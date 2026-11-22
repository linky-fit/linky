// Stands in for MONETA's business API in the journey stack: one account, and the transfers
// `bun run journey bank pay` books into it.
const API = "/api/v4/vip/aisp/my";
/** 2000145399/0600; set it as the shop's account so the terminal finds it here. */
const ACCOUNT = {
  id: "journey",
  identification: { iban: "CZ3506000000002000145399" },
};
const transfers: object[] = [];

Bun.serve({
  port: 80,
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/transfers") {
      const { amountCzk, vs } = (await request.json()) as {
        amountCzk: number;
        vs: string;
      };
      transfers.push({
        entryReference: crypto.randomUUID(),
        amount: { value: amountCzk, currency: "CZK" },
        creditDebitIndicator: "CRDT",
        status: "BOOK",
        entryDetails: {
          transactionDetails: {
            remittanceInformation: {
              structured: {
                creditorReferenceInformation: { reference: [`VS:${vs}`] },
              },
            },
          },
        },
      });
      return Response.json({ booked: transfers.length });
    }
    if (pathname === `${API}/accounts`)
      return Response.json({ accounts: [ACCOUNT] });
    if (pathname === `${API}/accounts/${ACCOUNT.id}/transactions`)
      return Response.json({ pageCount: 1, transactions: transfers });
    return new Response("Not found", { status: 404 });
  },
});
