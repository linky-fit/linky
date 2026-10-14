const env = import.meta.env;

export const siteConfig = {
  webAppUrl: env.VITE_WEB_APP_URL || "https://app.fazole.fit",
  linkyUrl: "https://linky.fit",
  githubUrl: "https://github.com/linky-fit/linky",
} as const;
