import { Bookmark, ExternalLink, Gauge, Landmark, Layers, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { Article } from "../lib/types";
import { categoryLabel, cn, formatDate, isMostlyEnglish, percent } from "../lib/utils";
import { Badge, Card } from "./ui";

type Props = {
  article: Article;
  compact?: boolean;
  onRelatedClick?: (article: Article) => void;
};

export default function ArticleCard({ article, compact, onRelatedClick }: Props) {
  const translatedTitle = article.translated_title?.trim();
  const showTranslatedTitle = Boolean(translatedTitle && isMostlyEnglish(article.title));
  const displayTitle = showTranslatedTitle ? translatedTitle : article.title;
  const hasSimilarArticles = article.similar_article_count > 0;

  return (
    <Card className={cn(article.importance_score >= 0.8 && "border-primary/60", hasSimilarArticles && "border-amber-300 dark:border-amber-800")}>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/articles/${article.id}`} className="line-clamp-2 text-base font-semibold hover:text-primary" title={article.title}>
            {displayTitle}
          </Link>
          {article.is_saved && <Bookmark className="shrink-0 fill-primary text-primary" size={17} />}
        </div>
        {showTranslatedTitle && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-primary">번역 제목</div>
            <div className="line-clamp-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">원문 제목:</span> {article.title}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{article.source_name}</Badge>
          <Badge>{formatDate(article.published_at)}</Badge>
          {article.is_bok_related && (
            <Badge className="bg-accent text-accent-foreground">
              <Landmark size={12} /> BOK {percent(article.bok_relevance_score)}
            </Badge>
          )}
          {article.importance_score >= 0.7 && (
            <Badge className="bg-primary/10 text-primary">
              <Sparkles size={12} /> 중요 {percent(article.importance_score)}
            </Badge>
          )}
          {article.is_ai_analyzed && (
            <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              <Sparkles size={12} /> AI 적용
            </Badge>
          )}
          {hasSimilarArticles && (
            <button
              type="button"
              onClick={() => onRelatedClick?.(article)}
              className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
              title="관련 기사만 보기"
            >
              <Layers size={12} /> 관련 기사 {article.similar_article_count}건
            </button>
          )}
          <Link to={`/search?category=${encodeURIComponent(article.category)}`}>
            <Badge className="hover:bg-primary/10 hover:text-primary">
              <Gauge size={12} /> {categoryLabel(article.category)}
            </Badge>
          </Link>
        </div>
        {!compact && article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {article.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="text-xs text-muted-foreground">
                #{tag}
              </span>
            ))}
          </div>
        )}
        <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" href={article.url} target="_blank" rel="noopener noreferrer">
          원문 <ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}
