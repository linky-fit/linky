import { renderSitePage } from "../renderSitePage";
import { articleSlug } from "./article";
import ArticlePage from "./ArticlePage";
import { articles } from "./articles";

const slug = articleSlug(window.location.pathname);
const article = articles.find((candidate) => candidate.slug === slug);
if (!article) throw new Error(`No blog article at ${window.location.pathname}`);

renderSitePage(<ArticlePage article={article} />);
