import {
  getFirstQueryValue,
  getPublicOrigin,
  type ApiRequest,
  type ApiResponse,
} from "./_npubcash.js";
import { loadSharedProfile, renderProfilePage } from "./_profilePage.js";
import { safeFetch } from "./_safeFetch.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const id = getFirstQueryValue(req.query?.id) ?? "";
  const origin = getPublicOrigin(req);
  const [profile, template] = await Promise.all([
    loadSharedProfile(id),
    // The static `/p/` page carries the hashed asset names of this deployment.
    safeFetch(new URL("/p/", origin)).then(
      (page) => (page.status === 200 ? page.text : null),
      () => null,
    ),
  ]);
  if (!template) {
    res.status(502).send("Profile page unavailable");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    profile
      ? "public, s-maxage=600, stale-while-revalidate=86400"
      : "public, s-maxage=60",
  );
  res
    .status(profile ? 200 : 404)
    .send(
      renderProfilePage(
        template,
        profile,
        `${origin}/p/${encodeURIComponent(id)}`,
      ),
    );
}
