export const createHttpHandler =
  (buildCommitSha: string) =>
  (request: Request): Response => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health")
      return Response.json({ ok: true });
    if (request.method === "GET" && pathname === "/")
      return new Response(`${buildCommitSha}\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    return Response.json({ error: "not_found" }, { status: 404 });
  };
