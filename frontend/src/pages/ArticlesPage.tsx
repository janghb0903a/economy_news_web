import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ArticleGrid from "../components/ArticleGrid";
import FilterBar from "../components/FilterBar";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { Article } from "../lib/types";

export default function ArticlesPage({ mode }: { mode: "domestic" | "global" | "bok" }) {
  const defaults = useMemo(() => {
    if (mode === "bok") return { bok_only: "true", region: "", q: "", category: "", global_focus: "", source_group: "", ai_only: "", dedupe_similar: "true" };
    if (mode === "global") return { bok_only: "", region: "global", q: "", category: "", global_focus: "true", source_group: "google", ai_only: "", dedupe_similar: "true" };
    return { bok_only: "", region: "domestic", q: "", category: "", global_focus: "", source_group: "", ai_only: "", dedupe_similar: "true" };
  }, [mode]);
  const [filters, setFilters] = useState<Record<string, string>>(defaults);
  const [submitted, setSubmitted] = useState<Record<string, string>>(defaults);
  const [relatedArticle, setRelatedArticle] = useState<Article | null>(null);
  const articleParams = relatedArticle ? { related_to: relatedArticle.id, limit: 100 } : { ...submitted, limit: 60 };
  const { data, isLoading } = useQuery({ queryKey: ["articles", mode, submitted, relatedArticle?.id || null], queryFn: () => api.articles(articleParams) });

  useEffect(() => {
    setFilters(defaults);
    setSubmitted(defaults);
    setRelatedArticle(null);
  }, [defaults]);

  const title = mode === "domestic" ? "국내 경제 뉴스" : mode === "global" ? "해외 경제 뉴스" : "한국은행 관련 기사";
  const description =
    mode === "domestic"
        ? "국내 경제 기사만 보여줍니다."
      : mode === "global"
        ? "기본은 Google News 해외 경제 기사이며, 날짜가 불안정한 Yahoo Finance는 별도로 볼 수 있습니다."
        : "한국은행 관련 기사만 보여줍니다.";
  const applyQuickFilter = (key: string, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setSubmitted(next);
    setRelatedArticle(null);
  };
  const toggleAiOnly = () => {
    const nextValue = filters.ai_only === "true" ? "" : "true";
    applyQuickFilter("ai_only", nextValue);
  };
  const toggleDedupeSimilar = () => {
    const nextValue = filters.dedupe_similar === "true" ? "" : "true";
    applyQuickFilter("dedupe_similar", nextValue);
  };
  const quickButtonClass = (active: boolean) =>
    cn("h-9 rounded-md border border-border px-3 text-sm font-medium", active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground");
  const aiOnly = filters.ai_only === "true";
  const dedupeSimilar = filters.dedupe_similar === "true";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <FilterBar
        values={filters}
        onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
        onSubmit={() => {
          setSubmitted(filters);
          setRelatedArticle(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
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
          AI 적용 기사만
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
          {dedupeSimilar ? "유사 기사 묶음은 가장 먼저 발간된 기사만 표시합니다." : aiOnly ? "AI 분석 결과가 저장된 기사만 표시합니다." : "전체 기사를 표시합니다."}
        </span>
      </div>
      {mode === "domestic" && (
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
      {mode === "global" && (
        <div className="flex flex-wrap gap-2">
          {[
            ["google", "Google News"],
            ["yahoo", "Yahoo Finance"],
            ["", "전체"]
          ].map(([value, label]) => (
            <button
              key={value || "all"}
              className={quickButtonClass(filters.source_group === value)}
              onClick={() => applyQuickFilter("source_group", value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {relatedArticle && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div>
            <div className="font-semibold">관련 기사만 보기</div>
            <div className="mt-1 line-clamp-1 text-xs opacity-80">{relatedArticle.title}</div>
          </div>
          <button
            type="button"
            onClick={() => setRelatedArticle(null)}
            className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted dark:border-amber-800"
          >
            뒤로
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="text-muted-foreground">불러오는 중...</div>
      ) : (
        <ArticleGrid articles={data?.items || []} empty="조건에 맞는 기사가 없습니다." onRelatedClick={setRelatedArticle} />
      )}
    </div>
  );
}
