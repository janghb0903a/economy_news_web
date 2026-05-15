import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, HelpCircle, MousePointer2, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ArticleGrid from "../components/ArticleGrid";
import FilterBar from "../components/FilterBar";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { Article } from "../lib/types";

const domesticCategoryOptions = [
  ["markets", "증시"],
  ["rates_bonds", "금리·채권"],
  ["fx", "환율"],
  ["real_estate_debt", "부동산·부채"],
  ["industry_export", "산업·수출"],
  ["banking_finance", "금융"],
  ["inflation_consumption", "물가·소비"],
  ["bok", "한국은행"]
] as const;

const globalSourceOptions = [
  ["google", "Google News"],
  ["yahoo", "Yahoo Finance"]
] as const;

const bokThresholdPercent = 50;
const allDomesticCategoryValues = domesticCategoryOptions.map(([value]) => value).join(",");

export default function ArticlesPage({ mode }: { mode: "domestic" | "global" | "bok" }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { relatedId } = useParams();
  const relatedArticleIdFromPath = relatedId && Number.isFinite(Number(relatedId)) ? Number(relatedId) : null;
  const defaults = useMemo<Record<string, string>>(() => {
    if (mode === "bok") return { bok_only: "true", region: "", q: "", category: "", categories: "", global_focus: "", source_group: "", source_groups: "", ai_only: "", important_only: "", read: "", dedupe_similar: "true" };
    if (mode === "global") return { bok_only: "", region: "global", q: "", category: "", categories: "", global_focus: "true", source_group: "", source_groups: "google", ai_only: "", important_only: "", read: "", dedupe_similar: "true" };
    return { bok_only: "", region: "domestic", q: "", category: "", categories: allDomesticCategoryValues, global_focus: "", source_group: "", source_groups: "", ai_only: "", important_only: "", read: "", dedupe_similar: "true" };
  }, [mode]);
  const filtersFromUrl = useMemo(() => {
    const next = { ...defaults };
    Object.keys(defaults).forEach((key) => {
      if (searchParams.has(key)) next[key] = searchParams.get(key) || "";
    });
    return next;
  }, [defaults, location.search]);
  const [filters, setFilters] = useState<Record<string, string>>(filtersFromUrl);
  const [submitted, setSubmitted] = useState<Record<string, string>>(filtersFromUrl);
  const [relatedArticle, setRelatedArticle] = useState<Article | null>(null);
  const [dropMessage, setDropMessage] = useState("");
  const [isArticleDragging, setIsArticleDragging] = useState(false);
  const [trashDragOver, setTrashDragOver] = useState(false);
  const [undoRemove, setUndoRemove] = useState<{ removedId: number; targetId: number; relatedId: number } | null>(null);
  const [finalRemoveId, setFinalRemoveId] = useState<number | null>(null);
  const [domesticCategoryDraft, setDomesticCategoryDraft] = useState(filtersFromUrl.categories);
  const relatedArticleId = relatedArticle?.id ?? relatedArticleIdFromPath;
  const relatedManageMode = Boolean(relatedArticleId);
  const articleParams = relatedArticleId
    ? { related_to: relatedArticleId, limit: 100 }
    : { ...submitted, categories: mode === "domestic" && submitted.categories === allDomesticCategoryValues ? "" : submitted.categories, limit: 60 };
  const queryKey = ["articles", mode, submitted, relatedArticleId || null];
  const { data, isLoading } = useQuery({ queryKey, queryFn: () => api.articles(articleParams) });

  const mergeDuplicate = useMutation({
    mutationFn: ({ draggedId, targetId }: { draggedId: number; targetId: number }) => api.mergeDuplicateGroup(draggedId, targetId),
    onSuccess: () => {
      setDropMessage("중복 기사로 묶었습니다. 관련 기사 보기에서 대표 기사를 바꿀 수 있습니다.");
      queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (error) => setDropMessage(`중복 묶기 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`)
  });

  const setRepresentative = useMutation({
    mutationFn: (articleId: number) => api.setDuplicateRepresentative(articleId),
    onSuccess: () => {
      setDropMessage("대표 기사를 변경했습니다.");
      queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (error) => setDropMessage(`대표 변경 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`)
  });

  const removeDuplicate = useMutation({
    mutationFn: (articleId: number) => api.removeDuplicateGroup(articleId),
    onSuccess: (result) => {
      setDropMessage("중복 그룹에서 해제했습니다.");
      setTrashDragOver(false);
      setIsArticleDragging(false);
      const targetId = result.representative_id || result.remaining_article_ids[0];
      setUndoRemove(result.can_undo && targetId && relatedArticleId ? { removedId: result.removed_article_id, targetId, relatedId: relatedArticleId } : null);
      setFinalRemoveId(null);
      if (!result.can_undo) closeRelatedArticles();
      queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (error) => {
      setTrashDragOver(false);
      setIsArticleDragging(false);
      setFinalRemoveId(null);
      setDropMessage(`그룹 해제 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  });

  const undoRemoveDuplicate = useMutation({
    mutationFn: ({ removedId, targetId }: { removedId: number; targetId: number }) => api.mergeDuplicateGroup(removedId, targetId),
    onSuccess: () => {
      setDropMessage("그룹 해제를 되돌렸습니다.");
      setUndoRemove(null);
      queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (error) => setDropMessage(`되돌리기 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`)
  });

  useEffect(() => {
    setFilters(filtersFromUrl);
    setSubmitted(filtersFromUrl);
    setDomesticCategoryDraft(filtersFromUrl.categories);
    if (!relatedArticleIdFromPath) setRelatedArticle(null);
    setDropMessage("");
    setIsArticleDragging(false);
    setTrashDragOver(false);
    if (!relatedArticleIdFromPath) setUndoRemove(null);
    if (!relatedArticleIdFromPath) setFinalRemoveId(null);
  }, [filtersFromUrl, relatedArticleIdFromPath]);

  useEffect(() => {
    if (!dropMessage) return;
    const timer = window.setTimeout(() => setDropMessage(""), 1000);
    return () => window.clearTimeout(timer);
  }, [dropMessage]);

  const title = mode === "domestic" ? "국내 경제 뉴스" : mode === "global" ? "해외 경제 뉴스" : "한국은행 관련 기사";
  const description =
    mode === "domestic"
      ? "국내 경제 기사만 보여줍니다."
      : mode === "global"
        ? "기본은 Google News만 보여주며, Yahoo Finance는 필요할 때 켤 수 있습니다."
        : "";

  const basePath = `/${mode}`;

  const filterSearchSuffix = (next: Record<string, string>) => {
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value && value !== defaults[key]) params.set(key, value);
    });
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  const applyFilterState = (next: Record<string, string>) => {
    setFilters(next);
    setSubmitted(next);
    setRelatedArticle(null);
    navigate(`${basePath}${filterSearchSuffix(next)}`, { replace: !relatedArticleId });
  };

  const applyQuickFilter = (key: string, value: string) => {
    const next = { ...filters, [key]: value };
    applyFilterState(next);
  };

  const toggleCsvFilter = (key: string, value: string, allValues: readonly string[]) => {
    const selected = new Set((filters[key] || "").split(",").filter((item) => item && item !== "__none__"));
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
    const nextValue = allValues.filter((item) => selected.has(item)).join(",");
    applyQuickFilter(key, nextValue || "__none__");
  };

  const toggleDomesticCategoryDraft = (value: string) => {
    const selected = new Set(domesticCategoryDraft.split(",").filter((item) => item && item !== "__none__"));
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
    const nextValue = domesticCategoryOptions.map(([item]) => item).filter((item) => selected.has(item)).join(",");
    setDomesticCategoryDraft(nextValue || "__none__");
  };

  const applyDomesticCategories = () => {
    applyFilterState({ ...filters, categories: domesticCategoryDraft });
  };

  const toggleAiOnly = () => {
    const nextValue = filters.ai_only === "true" ? "" : "true";
    applyQuickFilter("ai_only", nextValue);
  };

  const toggleImportantOnly = () => {
    const nextValue = filters.important_only === "true" ? "" : "true";
    applyQuickFilter("important_only", nextValue);
  };

  const toggleDedupeSimilar = () => {
    const nextValue = filters.dedupe_similar === "true" ? "" : "true";
    applyQuickFilter("dedupe_similar", nextValue);
  };

  const quickButtonClass = (active: boolean) =>
    cn("h-9 rounded-md border border-border px-3 text-sm font-medium", active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground");
  const aiOnly = filters.ai_only === "true";
  const importantOnly = filters.important_only === "true";
  const dedupeSimilar = filters.dedupe_similar === "true";
  const domesticCategoryDirty = mode === "domestic" && domesticCategoryDraft !== filters.categories;
  const selectedDomesticCategoryCount = domesticCategoryDraft.split(",").filter((item) => item && item !== "__none__").length;
  const appliedDomesticCategoryCount = filters.categories.split(",").filter((item) => item && item !== "__none__").length;

  const handleArticleDrop = (draggedArticleId: number, targetArticle: Article) => {
    if (draggedArticleId === targetArticle.id) return;
    mergeDuplicate.mutate({ draggedId: draggedArticleId, targetId: targetArticle.id });
  };

  const handleRepresentativeClick = (article: Article) => {
    if (!relatedArticleId || article.is_related_representative) return;
    setRepresentative.mutate(article.id);
  };

  const openRelatedArticles = (article: Article) => {
    setRelatedArticle(article);
    navigate(`${basePath}/related/${article.id}${filterSearchSuffix(submitted)}`);
  };

  const closeRelatedArticles = () => {
    setRelatedArticle(null);
    setUndoRemove(null);
    setFinalRemoveId(null);
    navigate(`${basePath}${filterSearchSuffix(submitted)}`);
  };

  const removeFromGroup = (articleId: number) => {
    removeDuplicate.mutate(articleId);
  };

  const handleTrashDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = Number(event.dataTransfer.getData("text/plain"));
    setTrashDragOver(false);
    setIsArticleDragging(false);
    if (!Number.isFinite(draggedId)) return;
    const groupCount = data?.items?.length || 0;
    if (groupCount <= 2) {
      setFinalRemoveId(draggedId);
      return;
    }
    removeFromGroup(draggedId);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {mode === "bok" && (
            <span className="inline-flex h-7 items-center rounded-full border border-violet-200 bg-violet-100 px-2.5 text-xs font-bold text-violet-800 shadow-sm dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200">
              AI
            </span>
          )}
          <DuplicateHelpTooltip />
        </div>
        {mode === "bok" ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            <span className="font-semibold text-violet-700 dark:text-violet-300">AI</span>와{" "}
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">규칙 기반 평가</span>로{" "}
            <span className="font-semibold text-foreground">한국은행 연관성이 {bokThresholdPercent}% 이상</span>인 기사들을 모아놓은 페이지입니다.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {!relatedManageMode && (
        <FilterBar
          values={filters}
          onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
          onSubmit={() => {
            applyFilterState(filters);
          }}
        />
      )}
      {!relatedManageMode && (
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 overflow-hidden rounded-md border border-border bg-card p-0.5">
          {[
            ["", "전체"],
            ["true", "읽음"],
            ["false", "안읽음"]
          ].map(([value, label]) => (
            <button
              key={value || "all-read"}
              type="button"
              onClick={() => applyQuickFilter("read", value)}
              className={cn(
                "inline-flex min-w-16 items-center justify-center rounded px-3 text-sm font-semibold transition",
                filters.read === value
                  ? value === "true"
                    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                    : value === "false"
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                      : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleAiOnly}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
            aiOnly
              ? "border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", aiOnly ? "bg-violet-600" : "bg-muted-foreground/40")} />
          AI 적용
        </button>
        <button
          type="button"
          onClick={toggleImportantOnly}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
            importantOnly
              ? "border-sky-500 bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="중요도 80% 이상 기사만 표시합니다."
        >
          <span className={cn("h-2 w-2 rounded-full", importantOnly ? "bg-sky-600" : "bg-muted-foreground/40")} />
          중요
        </button>
        <button
          type="button"
          onClick={toggleDedupeSimilar}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
            dedupeSimilar
              ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", dedupeSimilar ? "bg-amber-600" : "bg-muted-foreground/40")} />
          중복 기사 제거
        </button>
        <span className="text-xs text-muted-foreground">
          {importantOnly
            ? "중요도 80% 이상 기사만 표시합니다."
            : dedupeSimilar
              ? "유사 기사 묶음은 대표 기사만 표시합니다."
              : aiOnly
                ? "AI 분석 결과가 저장된 기사만 표시합니다."
                : "전체 기사를 표시합니다."}
        </span>
      </div>
      )}
      {!relatedManageMode && mode === "domestic" && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <SlidersHorizontal size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold">국내 기사 태그 필터</div>
                <div className="text-xs text-muted-foreground">
                  현재 {appliedDomesticCategoryCount}개 적용 · 선택 {selectedDomesticCategoryCount}개
                  {domesticCategoryDirty ? " · 적용 전에는 목록이 이전 조건으로 보입니다." : " · 모든 변경이 목록에 반영되어 있습니다."}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={applyDomesticCategories}
              disabled={!domesticCategoryDirty}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
                domesticCategoryDirty
                  ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              )}
            >
              <Check size={16} /> 적용
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {domesticCategoryOptions.map(([value, label]) => {
              const draftActive = domesticCategoryDraft.split(",").includes(value);
              const appliedActive = filters.categories.split(",").includes(value);
              const willApply = draftActive && !appliedActive;
              const willRemove = !draftActive && appliedActive;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleDomesticCategoryDraft(value)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition",
                    appliedActive && draftActive
                      ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                      : willApply
                        ? "border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900"
                        : willRemove
                          ? "border-dashed border-muted-foreground/50 bg-muted/40 text-muted-foreground line-through"
                          : "border-border bg-background text-muted-foreground hover:border-lime-400 hover:text-foreground"
                  )}
                  title={
                    appliedActive && draftActive
                      ? "현재 목록에 적용 중"
                      : willApply
                        ? "적용 버튼을 누르면 목록에 추가됩니다"
                        : willRemove
                          ? "적용 버튼을 누르면 목록에서 제외됩니다"
                          : "현재 목록에 적용되지 않음"
                  }
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      appliedActive && draftActive ? "bg-primary" : willApply ? "bg-amber-500" : willRemove ? "bg-muted-foreground/50" : "bg-muted-foreground/35"
                    )}
                  />
                  {label}
                  {willApply && <span className="text-[10px] font-bold">추가 예정</span>}
                  {willRemove && <span className="text-[10px] font-bold no-underline">해제 예정</span>}
                </button>
              );
            })}
          </div>
          {domesticCategoryDirty && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              아직 적용 전입니다. 오른쪽의 <span className="font-bold">적용</span> 버튼을 눌러야 현재 선택한 태그 기준으로 기사가 다시 표시됩니다.
            </div>
          )}
        </div>
      )}
      {!relatedManageMode && mode === "global" && (
        <div className="flex flex-wrap gap-2">
          {globalSourceOptions.map(([value, label]) => (
            <button key={value} className={quickButtonClass((filters.source_groups || "").split(",").includes(value))} onClick={() => toggleCsvFilter("source_groups", value, globalSourceOptions.map(([item]) => item))}>
              {label}
            </button>
          ))}
        </div>
      )}
      {false && mode === "domestic" && (
        <div className="flex flex-wrap gap-2">
          {[
            ["", "전체"],
            ["markets", "증시"],
            ["rates_bonds", "금리·채권"],
            ["fx", "환율"],
            ["real_estate_debt", "부동산·부채"],
            ["industry_export", "산업·수출"],
            ["banking_finance", "금융"],
            ["inflation_consumption", "물가·소비"],
            ["bok", "한국은행"]
          ].map(([value, label]) => (
            <button key={value || "all"} className={quickButtonClass(filters.category === value)} onClick={() => applyQuickFilter("category", value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {false && mode === "global" && (
        <div className="flex flex-wrap gap-2">
          {[
            ["google", "Google News"],
            ["yahoo", "Yahoo Finance"],
            ["", "전체"]
          ].map(([value, label]) => (
            <button key={value || "all"} className={quickButtonClass(filters.source_group === value)} onClick={() => applyQuickFilter("source_group", value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {dropMessage && (
        <div className="animate-[toast-fade_1s_ease-in-out_forwards] rounded-md border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {dropMessage}
        </div>
      )}
      {relatedArticleId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div>
            <div className="font-semibold">관련 기사만 보기</div>
            <div className="mt-1 line-clamp-1 text-xs opacity-80">{relatedArticle?.title || `기준 기사 #${relatedArticleId}`}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!undoRemove || undoRemove.relatedId !== relatedArticleId || undoRemoveDuplicate.isPending}
              onClick={() => undoRemove && undoRemoveDuplicate.mutate({ removedId: undoRemove.removedId, targetId: undoRemove.targetId })}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-semibold transition",
                undoRemove && undoRemove.relatedId === relatedArticleId
                  ? "border-lime-300 bg-lime-100 text-lime-900 hover:bg-lime-200 dark:border-lime-800 dark:bg-lime-950 dark:text-lime-100 dark:hover:bg-lime-900"
                  : "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60"
              )}
              title={undoRemove && undoRemove.relatedId === relatedArticleId ? "방금 해제한 중복 그룹을 다시 묶습니다." : "현재 화면에서 해제한 기록이 있을 때만 사용할 수 있습니다."}
            >
              <RotateCcw size={14} /> 되돌리기
            </button>
            <button
              type="button"
              onClick={closeRelatedArticles}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted dark:border-amber-800"
            >
              <ArrowLeft size={14} /> 뒤로
            </button>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="text-muted-foreground">불러오는 중...</div>
      ) : (
        <ArticleGrid
          articles={data?.items || []}
          empty="조건에 맞는 기사가 없습니다."
          onRelatedClick={openRelatedArticles}
          onArticleDrop={handleArticleDrop}
          onRepresentativeClick={handleRepresentativeClick}
          onArticleDragStateChange={setIsArticleDragging}
          relatedManageMode={Boolean(relatedArticleId)}
        />
      )}
      {relatedArticleId && (
        <DuplicateTrashDropZone
          active={isArticleDragging}
          over={trashDragOver}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setTrashDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTrashDragOver(false);
          }}
          onDrop={handleTrashDrop}
        />
      )}
      {finalRemoveId !== null && (
        <FinalUngroupConfirmModal
          onCancel={() => setFinalRemoveId(null)}
          onConfirm={() => removeFromGroup(finalRemoveId)}
          loading={removeDuplicate.isPending}
        />
      )}
    </div>
  );
}

function FinalUngroupConfirmModal({ onCancel, onConfirm, loading }: { onCancel: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <Trash2 size={22} />
        </div>
        <h2 className="mt-4 text-xl font-bold">중복 그룹을 완전히 해제할까요?</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          현재 그룹에는 기사 2개만 남아 있습니다. 이 작업을 적용하면 중복 기사 그룹이 완전히 해제되고, 이 화면에서 되돌릴 수 없습니다.
          필요하면 나중에 카드를 다시 드래그해서 중복 기사를 새로 설정해야 합니다.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60">
            취소
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className="h-10 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60">
            {loading ? "해제 중" : "확인하고 해제"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateTrashDropZone({
  active,
  over,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  active: boolean;
  over: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2">
      <div className="group/trash relative flex flex-col items-center">
        <div
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            "flex h-14 min-w-56 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold shadow-2xl backdrop-blur transition duration-200",
            active
              ? "border-rose-400 bg-rose-100 text-rose-900 scale-105 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100"
              : "border-border bg-card/90 text-muted-foreground opacity-70",
            over && "scale-110 border-rose-500 bg-rose-200 text-rose-950 ring-4 ring-rose-300/50 dark:bg-rose-900 dark:text-rose-50 dark:ring-rose-800/60"
          )}
          aria-label="중복 그룹에서 해제"
        >
          <Trash2 size={19} className={cn(active && "animate-pulse", over && "text-rose-700 dark:text-rose-100")} />
          {over ? "여기에 놓으면 그룹 해제" : active ? "드래그해서 그룹 해제" : "중복 그룹 해제"}
        </div>
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-[120] w-80 -translate-x-1/2 translate-y-2 rounded-lg border border-border bg-card p-4 text-sm opacity-0 shadow-2xl transition duration-200 group-hover/trash:translate-y-0 group-hover/trash:opacity-100">
          <div className="font-semibold text-foreground">중복 그룹에서 빼기</div>
          <div className="relative mt-3 h-24 overflow-hidden rounded-lg border border-border bg-muted/50">
            <div className="absolute left-5 top-5 h-14 w-24 animate-[trash-card_4s_ease-in-out_infinite] rounded-md border border-amber-300 bg-card p-2 shadow-sm">
              <div className="h-2 w-14 rounded bg-foreground/40" />
              <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
              <div className="mt-1 h-2 w-12 rounded bg-muted-foreground/25" />
            </div>
            <div className="absolute right-8 top-8 flex h-11 w-11 animate-[trash-bin_4s_ease-in-out_infinite] items-center justify-center rounded-full border border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
              <Trash2 size={20} />
            </div>
            <div className="absolute left-14 top-[58px] animate-[trash-cursor_4s_ease-in-out_infinite] text-foreground drop-shadow-sm">
              <MousePointer2 size={23} strokeWidth={2.2} />
            </div>
          </div>
          <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
            <div><span className="font-semibold text-foreground">카드 드래그</span> 후 하단 휴지통에 놓으면 묶음에서 빠집니다.</div>
            <div><span className="font-semibold text-lime-700 dark:text-lime-300">대표 기사</span>를 빼면 남은 기사 중 가장 먼저 발간된 기사가 대표가 됩니다.</div>
            <div><span className="font-semibold text-foreground">1개만 남으면</span> 중복 그룹은 자동 해제됩니다.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DuplicateHelpTooltip() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative z-[90] inline-flex" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="중복 기사 관리 안내"
        aria-expanded={open}
      >
        <HelpCircle size={16} />
      </button>
      <div
        className={cn(
          "absolute left-0 top-10 z-[120] w-80 rounded-lg border border-border bg-card p-4 text-sm shadow-2xl transition",
          open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"
        )}
      >
        <div className="font-semibold text-foreground">중복 기사 관리</div>
        <div className="relative mt-3 h-24 overflow-hidden rounded-lg border border-border bg-muted/50">
          <div className="absolute left-4 top-5 h-14 w-24 animate-[duplicate-left_4s_ease-in-out_infinite] rounded-md border border-amber-300 bg-card p-2 shadow-sm">
            <div className="h-2 w-14 rounded bg-foreground/40" />
            <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
            <div className="mt-1 h-2 w-12 rounded bg-muted-foreground/25" />
          </div>
          <div className="absolute right-4 top-5 h-14 w-24 rounded-md border border-amber-300 bg-card p-2 shadow-sm">
            <div className="h-2 w-16 rounded bg-foreground/40" />
            <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
            <div className="mt-1 h-2 w-10 rounded bg-muted-foreground/25" />
          </div>
          <div className="absolute left-12 top-[58px] animate-[duplicate-cursor_4s_ease-in-out_infinite] text-foreground drop-shadow-sm">
            <MousePointer2 size={23} strokeWidth={2.2} />
          </div>
          <div className="absolute right-12 top-3 flex h-7 w-7 animate-[duplicate-pulse_4s_ease-in-out_infinite] items-center justify-center rounded-full bg-lime-100 text-lime-700 opacity-0 dark:bg-lime-950 dark:text-lime-200">
            ✓
          </div>
        </div>
        <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <div><span className="font-semibold text-foreground">드래그</span> 카드를 다른 카드 위에 놓으면 중복 기사로 묶입니다.</div>
          <div><span className="font-semibold text-lime-700 dark:text-lime-300">대표</span> 연두색 테두리 기사가 목록에 남습니다.</div>
          <div><span className="font-semibold text-foreground">변경</span> 관련 기사 화면에서 다른 카드를 클릭하면 대표가 바뀝니다.</div>
        </div>
      </div>
    </div>
  );
}
