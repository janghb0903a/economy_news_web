import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, Database, Landmark, Newspaper, Star, TrendingUp } from "lucide-react";
import { Pie, PieChart, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { Link } from "react-router-dom";
import ArticleCard from "../components/ArticleCard";
import ArticleGrid from "../components/ArticleGrid";
import { api } from "../lib/api";
import { Button, Card, GhostButton } from "../components/ui";

const colors = ["#0e7490", "#15803d", "#ca8a04", "#dc2626"];

function Metric({ label, value, icon: Icon, to }: { label: string; value: number; icon: typeof Newspaper; to: string }) {
  return (
    <Link to={to}>
      <Card className="p-4 transition hover:border-primary/60 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-semibold">{value.toLocaleString()}</div>
        </div>
        <Icon className="text-primary" size={24} />
      </div>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const addIngestLog = (message: string) => {
    const time = new Intl.DateTimeFormat("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    setIngestLogs((current) => [`${time} ${message}`, ...current].slice(0, 12));
  };
  const ingest = useMutation({
    mutationFn: api.ingest,
    onMutate: () => {
      setIngestLogs([]);
      addIngestLog("뉴스 수집 요청 시작");
    },
    onSuccess: (result) => {
      addIngestLog("뉴스 수집 완료. 화면을 갱신합니다.");
      result.results.forEach((item) => {
        const row = item as { source?: string; fetched?: number; new?: number; error?: string | null };
        addIngestLog(`${row.source || "source"}: 수집 ${row.fetched ?? 0}건, 신규 ${row.new ?? 0}건${row.error ? `, 오류 ${row.error}` : ""}`);
      });
      queryClient.invalidateQueries();
    },
    onError: (error) => addIngestLog(`뉴스 수집 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`)
  });

  useEffect(() => {
    if (!data || !("Notification" in window) || Notification.permission !== "granted") return;
    const seen = new Set(JSON.parse(localStorage.getItem("notifiedArticles") || "[]") as number[]);
    const candidates = [...data.important, ...data.bok_preview].filter((article) => article.importance_score >= 0.8 || article.bok_relevance_score >= 0.8);
    for (const article of candidates) {
      if (seen.has(article.id)) continue;
      new Notification(article.title, { body: article.source_name });
      seen.add(article.id);
    }
    localStorage.setItem("notifiedArticles", JSON.stringify([...seen].slice(-200)));
  }, [data]);

  const requestNotifications = async () => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  };

  if (isLoading || !data) return <div className="p-6 text-muted-foreground">불러오는 중...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">메인 대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">국내외 경제 뉴스와 한국은행 관련 흐름을 한 곳에서 봅니다.</p>
        </div>
        <div className="flex gap-2">
          <GhostButton onClick={requestNotifications}>
            <Bell size={16} /> 알림 권한
          </GhostButton>
          <Button onClick={() => ingest.mutate()} disabled={ingest.isPending}>
            <Database size={16} /> 지금 수집
          </Button>
        </div>
      </div>
      {(ingest.isPending || ingestLogs.length > 0) && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">수집 로그</h2>
            {ingest.isPending && <span className="text-xs text-muted-foreground">진행 중...</span>}
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            {ingestLogs.map((log) => (
              <div key={log}>{log}</div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="오늘 기사" value={data.today_count} icon={Newspaper} to="/search" />
        <Metric label="국내 경제" value={data.domestic_count} icon={TrendingUp} to="/domestic" />
        <Metric label="해외 경제" value={data.global_count} icon={TrendingUp} to="/global" />
        <Metric label="한국은행" value={data.bok_count} icon={Landmark} to="/bok" />
        <Metric label="중요 기사" value={data.important_count} icon={Star} to="/search?important_only=true" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">최신 기사</h2>
          <ArticleGrid articles={data.latest} />
        </section>
        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-lg font-semibold">분포</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.chart} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                    {data.chart.map((entry, index) => (
                      <Cell key={entry.name} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-lg font-semibold">주요 키워드</h2>
            <div className="flex flex-wrap gap-2">
              {data.keywords.map((keyword) => (
                <Link key={keyword.name} to={`/search?q=${encodeURIComponent(keyword.name)}`} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-primary/10 hover:text-primary">
                  {keyword.name} {keyword.count}
                </Link>
              ))}
            </div>
          </Card>
        </aside>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">중요 기사</h2>
          {data.important.map((article) => (
            <ArticleCard key={article.id} article={article} compact />
          ))}
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">한국은행 미리보기</h2>
          {data.bok_preview.map((article) => (
            <ArticleCard key={article.id} article={article} compact />
          ))}
        </div>
      </section>
    </div>
  );
}
