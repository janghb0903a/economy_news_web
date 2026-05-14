import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ArticleGrid from "../components/ArticleGrid";
import { api } from "../lib/api";
import { GhostButton, Input, Select } from "../components/ui";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const initialFilters = {
    q: searchParams.get("q") || "",
    region: searchParams.get("region") || "",
    category: searchParams.get("category") || "",
    source: searchParams.get("source") || "",
    bok_only: searchParams.get("bok_only") || "",
    important_only: searchParams.get("important_only") || "",
    saved_only: searchParams.get("saved_only") || "",
    read: searchParams.get("read") || "",
    from_date: searchParams.get("from_date") || "",
    to_date: searchParams.get("to_date") || ""
  };
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [submitted, setSubmitted] = useState(filters);
  const { data, isLoading } = useQuery({ queryKey: ["search", submitted], queryFn: () => api.articles({ ...submitted, limit: 80 }) });
  const set = (key: string, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">전체 기사 검색</h1>
        <p className="mt-1 text-sm text-muted-foreground">SQLite FTS5 기반 검색과 상세 필터를 함께 사용합니다.</p>
      </div>
      <div className="sticky top-[65px] z-30 rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Input placeholder="검색어" value={filters.q} onChange={(e) => set("q", e.target.value)} />
          <Input placeholder="언론사" value={filters.source} onChange={(e) => set("source", e.target.value)} />
          <Input type="date" value={filters.from_date} onChange={(e) => set("from_date", e.target.value)} />
          <Input type="date" value={filters.to_date} onChange={(e) => set("to_date", e.target.value)} />
          <Select value={filters.region} onChange={(e) => set("region", e.target.value)}>
            <option value="">지역 전체</option>
            <option value="domestic">국내</option>
            <option value="global">해외</option>
          </Select>
          <Select value={filters.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">카테고리 전체</option>
            <option value="domestic_economy">국내 경제</option>
            <option value="global_economy">해외 경제</option>
            <option value="bok">한국은행</option>
            <option value="other">기타</option>
          </Select>
          <Select value={filters.bok_only} onChange={(e) => set("bok_only", e.target.value)}>
            <option value="">BOK 전체</option>
            <option value="true">BOK 관련</option>
          </Select>
          <Select value={filters.important_only} onChange={(e) => set("important_only", e.target.value)}>
            <option value="">중요도 전체</option>
            <option value="true">중요 기사</option>
          </Select>
          <Select value={filters.saved_only} onChange={(e) => set("saved_only", e.target.value)}>
            <option value="">저장 전체</option>
            <option value="true">저장됨</option>
          </Select>
          <Select value={filters.read} onChange={(e) => set("read", e.target.value)}>
            <option value="">읽음 전체</option>
            <option value="true">읽음</option>
            <option value="false">안 읽음</option>
          </Select>
          <GhostButton className="md:col-span-2 xl:col-span-1" onClick={() => setSubmitted(filters)}>
            검색
          </GhostButton>
        </div>
      </div>
      <div className="text-sm text-muted-foreground">{data?.total ?? 0}건</div>
      {isLoading ? <div className="text-muted-foreground">검색 중...</div> : <ArticleGrid articles={data?.items || []} empty="검색 결과가 없습니다." />}
    </div>
  );
}
