// For `bun run journey latency` and `time`: delays and logs the browser's requests to the mints, and
// times a tap until something shows. playwright-cli calls this file as one expression.
async (page, { mints, delayMs, tap, until }) => {
  const context = page.context();
  // The route and its log live on the browser context, so they last until the browser closes.
  if (!context.journeyMint) {
    const state = (context.journeyMint = { delayMs: 0, requests: [] });
    await context.route(
      (url) => mints.includes(url.origin) && url.pathname.startsWith("/v1/"),
      async (route) => {
        const request = route.request();
        // playwright-cli runs this without Node's globals, so no URL and no setTimeout.
        const path = request.url().replace(/^\w+:\/\/[^/]+/, "").split("?")[0];
        const entry = { at: Date.now(), method: request.method(), path };
        state.requests.push(entry);
        await page.waitForTimeout(state.delayMs);
        const response = await route.fetch().catch(() => null);
        entry.ms = Date.now() - entry.at;
        entry.status = response?.status() ?? null;
        await (response ? route.fulfill({ response }) : route.abort());
      },
    );
  }
  const state = context.journeyMint;
  if (delayMs !== undefined) state.delayMs = delayMs;
  if (!tap) return { mintDelayMs: state.delayMs };

  const from = Date.now();
  await tap.click();
  // waitFor re-checks on a back-off of up to 500 ms, which rounds a short payment up to the next step.
  while (!(await until.isVisible())) {
    if (Date.now() - from > 120_000) throw new Error("the awaited element never showed");
  }
  const ms = Date.now() - from;
  return {
    ms,
    mintDelayMs: state.delayMs,
    // A request without `ms` was still running when the wait ended.
    mintRequests: state.requests
      .filter(({ at }) => at >= from)
      .map(({ at, ...request }) => ({ atMs: at - from, ...request })),
  };
}
