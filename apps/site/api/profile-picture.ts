import { getFirstQueryValue, type ApiRequest } from "./_npubcash.js";
import { loadProfilePicture } from "./_profilePage.js";

interface PictureResponse {
  status: (code: number) => { send: (body: string | Buffer) => void };
  setHeader: (name: string, value: string) => void;
}

export default async function handler(req: ApiRequest, res: PictureResponse) {
  const picture = await loadProfilePicture(
    getFirstQueryValue(req.query?.id) ?? "",
  );
  if (!picture) {
    res.status(404).send("Profile picture not found");
    return;
  }

  res.setHeader("Content-Type", picture.contentType);
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=600, stale-while-revalidate=86400",
  );
  res.status(200).send(picture.bytes);
}
