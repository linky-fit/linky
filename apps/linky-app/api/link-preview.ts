import { fetchLinkPreview } from "../server/linkPreview";

interface RequestLike {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
  };
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  try {
    const preview = await fetchLinkPreview(String(raw ?? "").trim());
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.status(200).json(preview);
  } catch {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    res.status(422).json({ error: "Preview unavailable" });
  }
}
