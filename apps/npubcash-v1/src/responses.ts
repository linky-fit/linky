export const json = (status: number, body: unknown): Response =>
  Response.json(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });

export const failure = (status: number, message: string): Response =>
  json(status, { error: true, message });

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
