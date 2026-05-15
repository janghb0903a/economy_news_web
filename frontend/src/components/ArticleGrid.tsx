import type { Article } from "../lib/types";
import ArticleCard from "./ArticleCard";

export default function ArticleGrid({
  articles,
  empty = "기사가 없습니다.",
  onRelatedClick,
  onArticleDrop,
  onRepresentativeClick,
  onArticleDragStateChange,
  relatedManageMode = false
}: {
  articles: Article[];
  empty?: string;
  onRelatedClick?: (article: Article) => void;
  onArticleDrop?: (draggedArticleId: number, targetArticle: Article) => void;
  onRepresentativeClick?: (article: Article) => void;
  onArticleDragStateChange?: (dragging: boolean) => void;
  relatedManageMode?: boolean;
}) {
  if (!articles.length) {
    return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {articles.map((article) => (
        <ArticleCard
          key={article.id}
          article={article}
          onRelatedClick={onRelatedClick}
          onArticleDrop={onArticleDrop}
          onRepresentativeClick={onRepresentativeClick}
          onArticleDragStateChange={onArticleDragStateChange}
          relatedManageMode={relatedManageMode}
        />
      ))}
    </div>
  );
}
