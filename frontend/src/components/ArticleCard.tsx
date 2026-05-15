import { Bookmark, ExternalLink, Gauge, Landmark, Layers, MousePointer2, Sparkles, Star } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { Article } from "../lib/types";
import { categoryLabel, cn, formatDate, isMostlyEnglish, percent } from "../lib/utils";
import { Badge, Card } from "./ui";

type Props = {
  article: Article;
  compact?: boolean;
  onRelatedClick?: (article: Article) => void;
  onArticleDrop?: (draggedArticleId: number, targetArticle: Article) => void;
  onRepresentativeClick?: (article: Article) => void;
  onArticleDragStateChange?: (dragging: boolean) => void;
  relatedManageMode?: boolean;
};

export default function ArticleCard({ article, compact, onRelatedClick, onArticleDrop, onRepresentativeClick, onArticleDragStateChange, relatedManageMode = false }: Props) {
  const navigate = useNavigate();
  const translatedTitle = article.translated_title?.trim();
  const showTranslatedTitle = Boolean(translatedTitle && isMostlyEnglish(article.title));
  const displayTitle = showTranslatedTitle ? translatedTitle : article.title;
  const hasSimilarArticles = article.similar_article_count > 0;
  const showRepresentative = article.is_related_representative && article.related_group_size > 1;
  const draggable = Boolean(onArticleDrop);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropPulse, setDropPulse] = useState(false);
  const dragStartedRef = useRef(false);

  const stopCardAction = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", String(article.id));
    event.dataTransfer.effectAllowed = "move";
    dragStartedRef.current = true;
    setIsDragging(true);
    onArticleDragStateChange?.(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setIsDragOver(false);
    onArticleDragStateChange?.(false);
    window.setTimeout(() => {
      dragStartedRef.current = false;
    }, 120);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onArticleDrop) return;
    event.preventDefault();
    const draggedId = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(draggedId) || draggedId === article.id) return;
    event.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onArticleDrop) return;
    event.preventDefault();
    setIsDragging(false);
    setIsDragOver(false);
    const draggedId = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(draggedId) || draggedId === article.id) return;
    setDropPulse(true);
    window.setTimeout(() => setDropPulse(false), 900);
    onArticleDrop(draggedId, article);
  };

  const handleCardClick = () => {
    if (dragStartedRef.current) return;
    if (relatedManageMode) {
      onRepresentativeClick?.(article);
      return;
    }
    navigate(`/articles/${article.id}`);
  };

  return (
    <Card
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      onDragEnter={draggable ? handleDragOver : undefined}
      onDragOver={draggable ? handleDragOver : undefined}
      onDragLeave={draggable ? handleDragLeave : undefined}
      onDrop={draggable ? handleDrop : undefined}
      onClick={handleCardClick}
      className={cn(
        "relative overflow-visible transition duration-200 hover:-translate-y-0.5 hover:border-lime-400 hover:shadow-md hover:shadow-lime-500/10 dark:hover:border-lime-600 dark:hover:shadow-lime-950/30",
        draggable ? "cursor-pointer active:cursor-grabbing" : "cursor-pointer",
        isDragging && "scale-[0.985] border-primary/70 opacity-60 ring-2 ring-primary/30",
        isDragOver && "border-lime-400 bg-lime-50/60 ring-2 ring-lime-300 dark:border-lime-700 dark:bg-lime-950/20 dark:ring-lime-900",
        dropPulse && "border-lime-500 ring-2 ring-lime-400",
        hasSimilarArticles && "border-amber-300 dark:border-amber-800",
        relatedManageMode && "cursor-pointer border-amber-300 ring-1 ring-amber-200 hover:bg-muted/40 dark:border-amber-800 dark:ring-amber-900",
        relatedManageMode && showRepresentative && "group/representative overflow-visible border-lime-400 ring-2 ring-lime-300 dark:border-lime-700 dark:ring-lime-900"
      )}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/50 text-sm font-semibold text-primary backdrop-blur-[1px]">
          드래그 중
        </div>
      )}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-lime-100/70 text-sm font-semibold text-lime-800 backdrop-blur-[1px] dark:bg-lime-950/50 dark:text-lime-200">
          여기에 놓으면 중복 기사로 묶입니다
        </div>
      )}
      {dropPulse && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-lime-100/80 text-sm font-semibold text-lime-800 backdrop-blur-[1px] dark:bg-lime-950/60 dark:text-lime-200">
          중복 묶음 완료
        </div>
      )}
      {relatedManageMode && showRepresentative && <RepresentativeHelp />}
      {article.is_read && (
        <div
          className="pointer-events-none absolute -left-px -top-2 z-10 flex h-9 w-[4.6rem] items-start justify-center bg-emerald-100 pt-1.5 text-[11px] font-bold text-emerald-800 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900"
          style={{ clipPath: "polygon(0 0, 100% 0, 78% 56%, 100% 100%, 0 100%)" }}
          title="읽은 기사"
        >
          읽음
        </div>
      )}
      <div className={cn("space-y-3 p-4", article.is_read && "pt-10")}>
        <div className="flex items-start justify-between gap-3">
          <Link to={`/articles/${article.id}`} onClick={stopCardAction} className="line-clamp-2 text-base font-semibold hover:text-primary" title={article.title}>
            {displayTitle}
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {article.is_ai_analyzed && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-100 px-2 py-1 text-xs font-bold text-violet-800 shadow-sm dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200"
                title="AI 분석이 적용된 기사입니다."
              >
                <Sparkles size={12} /> AI
              </span>
            )}
            {showRepresentative && (
              <span className="inline-flex items-center gap-1 rounded-md bg-lime-100 px-2 py-1 text-xs font-semibold text-lime-800 dark:bg-lime-950 dark:text-lime-200">
                <Star size={12} /> 대표
              </span>
            )}
            {article.is_saved && <Bookmark className="fill-primary text-primary" size={17} />}
          </div>
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
          {hasSimilarArticles && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRelatedClick?.(article);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
              title="관련 기사만 보기"
            >
              <Layers size={12} /> 관련 기사 {article.similar_article_count}개
            </button>
          )}
          <Link to={`/search?category=${encodeURIComponent(article.category)}`} onClick={stopCardAction}>
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
        <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" href={article.url} target="_blank" rel="noopener noreferrer" onClick={stopCardAction}>
          원문 <ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}

function RepresentativeHelp() {
  return (
    <div className="pointer-events-none absolute right-3 top-11 z-30 w-72 translate-y-1 rounded-lg border border-border bg-card p-4 text-sm opacity-0 shadow-2xl transition duration-200 group-hover/representative:translate-y-0 group-hover/representative:opacity-100">
      <div className="font-semibold text-foreground">대표 기사 변경</div>
      <div className="relative mt-3 h-24 overflow-hidden rounded-lg border border-border bg-muted/50">
        <div className="absolute left-4 top-5 h-14 w-24 animate-[representative-candidate_4s_ease-in-out_infinite] rounded-md border-2 bg-card p-2 shadow-sm">
          <div className="h-2 w-14 rounded bg-foreground/40" />
          <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
          <div className="mt-1 h-2 w-12 rounded bg-muted-foreground/25" />
        </div>
        <div className="absolute right-4 top-5 h-14 w-24 animate-[representative-current_4s_ease-in-out_infinite] rounded-md border-2 bg-card p-2 shadow-sm">
          <div className="h-2 w-16 rounded bg-foreground/40" />
          <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
          <div className="mt-1 h-2 w-10 rounded bg-muted-foreground/25" />
        </div>
        <div className="absolute left-16 top-14 animate-[representative-cursor_4s_ease-in-out_infinite] text-foreground drop-shadow-sm">
          <MousePointer2 size={22} strokeWidth={2.2} />
        </div>
        <div className="absolute left-[86px] top-7 flex h-6 w-6 animate-[representative-check_4s_ease-in-out_infinite] items-center justify-center rounded-full bg-lime-100 text-xs font-bold text-lime-700 opacity-0 dark:bg-lime-950 dark:text-lime-200">
          ✓
        </div>
      </div>
      <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
        <div><span className="font-semibold text-amber-700 dark:text-amber-300">주황색 카드</span>를 클릭하면 대표 기사로 바뀝니다.</div>
        <div><span className="font-semibold text-lime-700 dark:text-lime-300">연두색 카드</span>가 중복 제거 시 목록에 남습니다.</div>
      </div>
    </div>
  );
}
