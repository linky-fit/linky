type Env = Record<string, string | undefined>;

/** The origin serving this build: the branch URL on Vercel previews, the production domain otherwise. */
export const deploymentOrigin = (env: Env) =>
  `https://${
    (env.VERCEL_ENV === "preview"
      ? env.VERCEL_BRANCH_URL
      : env.VERCEL_PROJECT_PRODUCTION_URL) ?? "linky.fit"
  }`;

/** Chat apps skip relative preview images, so `og:image` paths get the deployment's origin. */
export const absolutePreviewImages = (html: string, origin: string) =>
  html.replace(/(property="og:image"\s+content=")\//gu, `$1${origin}/`);
