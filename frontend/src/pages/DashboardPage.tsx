import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import cloud from "d3-cloud";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, Database, Landmark, Newspaper, Sparkles, Star, TrendingUp } from "lucide-react";
import { Pie, PieChart, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { Link } from "react-router-dom";
import ArticleCard from "../components/ArticleCard";
import ArticleGrid from "../components/ArticleGrid";
import { api } from "../lib/api";
import { Button, Card, GhostButton } from "../components/ui";

const colors = ["#0e7490", "#15803d", "#ca8a04", "#dc2626"];

type ChartPoint = {
  name: string;
  value: number;
};

type KeywordPoint = {
  name: string;
  count: number;
};

type CloudWord = {
  text: string;
  count: number;
  size: number;
  rotate: number;
  color: string;
  x?: number;
  y?: number;
};

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

function DistributionTooltip({ active, payload, total }: { active?: boolean; payload?: Array<{ payload: ChartPoint; value: number; color?: string }>; total: number }) {
  const item = payload?.[0];
  if (!active || !item) return null;
  const value = Number(item.value || 0);
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="min-w-40 rounded-xl border border-border bg-card/95 p-3 text-card-foreground shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
        <span className="text-sm font-semibold">{item.payload.name}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">기사 수</div>
          <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        </div>
        <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{percent}%</div>
      </div>
    </div>
  );
}

function BokShortcutButton({ to, label, description, tone }: { to: string; label: string; description: string; tone: "domestic" | "ai" }) {
  return (
    <Link
      to={to}
      className={[
        "group relative flex items-center justify-between rounded-lg border p-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-md",
        tone === "ai"
          ? "border-violet-200 bg-violet-50 text-violet-900 hover:border-violet-400 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-100"
          : "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
      ].join(" ")}
    >
      <span className="flex items-center gap-2">
        {tone === "ai" ? <Sparkles size={16} /> : <Landmark size={16} />}
        {label}
      </span>
      <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
      <span className="pointer-events-none absolute left-3 right-3 top-[calc(100%+0.5rem)] z-20 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium leading-5 text-card-foreground opacity-0 shadow-xl transition group-hover:opacity-100">
        {description}
      </span>
    </Link>
  );
}

function WordCloud({ keywords }: { keywords: KeywordPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [layoutWords, setLayoutWords] = useState<CloudWord[]>([]);
  const items = useMemo(
    () =>
      [...keywords]
        .filter((keyword, index, array) => array.findIndex((item) => item.name === keyword.name) === index)
        .sort((left, right) => right.count - left.count)
        .slice(0, 72),
    [keywords]
  );
  const max = Math.max(...items.map((item) => item.count), 1);
  const min = Math.min(...items.map((item) => item.count), max);
  const palette = ["#0e7490", "#0369a1", "#155e75", "#047857", "#0f766e", "#1d4ed8", "#7c3aed", "#b45309", "#be123c"];
  const height = 330;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!items.length) {
      setLayoutWords([]);
      return;
    }

    const words: CloudWord[] = items.map((keyword, index) => {
      const ratio = max === min ? 0.55 : (keyword.count - min) / (max - min);
      return {
        text: keyword.name,
        count: keyword.count,
        size: Math.round(13 + ratio * 38),
        rotate: index % 11 === 0 && keyword.name.length <= 5 ? 90 : index % 9 === 0 && keyword.name.length <= 5 ? -90 : 0,
        color: palette[index % palette.length]
      };
    });

    let stopped = false;
    const layout = cloud<CloudWord>()
      .size([width, height])
      .words(words)
      .padding((word) => (word.size > 36 ? 3 : 2))
      .rotate((word) => word.rotate)
      .font("Inter, Pretendard, system-ui, sans-serif")
      .fontWeight((word) => (word.size > 38 ? 900 : word.size > 25 ? 800 : 700))
      .fontSize((word) => word.size)
      .spiral("archimedean")
      .random(() => 0.5)
      .on("end", (computed) => {
        if (!stopped) setLayoutWords(computed);
      });
    layout.start();
    return () => {
      stopped = true;
      layout.stop();
    };
  }, [height, items, max, min, width]);

  if (!items.length) {
    return <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">표시할 키워드가 아직 없습니다.</div>;
  }

  return (
    <div ref={containerRef} className="overflow-hidden rounded-xl border border-border bg-[linear-gradient(135deg,rgba(236,254,255,0.95),rgba(255,255,255,0.94)_45%,rgba(240,253,250,0.9))] p-4 shadow-inner dark:bg-[linear-gradient(135deg,rgba(8,47,73,0.5),rgba(15,23,42,0.96)_45%,rgba(20,83,45,0.35))]">
      <div className="relative overflow-hidden rounded-lg bg-white/60 dark:bg-slate-950/20" style={{ height }}>
        {layoutWords.map((keyword) => {
          return (
            <Link
              key={keyword.text}
              to={`/search?q=${encodeURIComponent(keyword.text)}`}
              title={`${keyword.text}: ${keyword.count} articles`}
              className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-md px-1 leading-none transition hover:z-20 hover:scale-110 hover:bg-background/95 hover:text-primary hover:shadow-lg"
              style={{
                color: keyword.color,
                fontSize: `${keyword.size}px`,
                fontWeight: keyword.size > 38 ? 900 : keyword.size > 25 ? 800 : 700,
                transform: `translate(${keyword.x ?? 0}px, ${keyword.y ?? 0}px) translate(-50%, -50%) rotate(${keyword.rotate}deg)`,
                transformOrigin: "center",
                opacity: 0.86 + Math.min(keyword.size / 120, 0.14)
              }}
            >
              {keyword.text}
            </Link>
          );
        })}
        {!layoutWords.length && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">워드클라우드 배치 중...</div>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 60_000, refetchOnWindowFocus: true });
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
  const chartTotal = data.chart.reduce((sum, item) => sum + item.value, 0);

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

      <Card className="p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              <Landmark size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">한국은행 관련 기사</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                국내 기사 안의 한국은행 태그 필터와 AI 기반 BOK 연관 기사 분류를 목적에 맞게 나눠서 확인할 수 있습니다.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <BokShortcutButton
              to="/domestic?categories=bok"
              label="국내 한국은행 필터"
              description="국내 경제 기사 중 한국은행 태그만 켠 상태로 이동합니다. RSS/규칙 기반 태그 흐름을 빠르게 볼 때 좋습니다."
              tone="domestic"
            />
            <BokShortcutButton
              to="/bok"
              label="AI 기반 BOK 연관 기사 분류"
              description="AI와 규칙 기반 평가로 BOK 연관성이 50% 이상인 기사만 모아보는 전용 화면입니다."
              tone="ai"
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
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
                <Tooltip content={<DistributionTooltip total={chartTotal} />} cursor={false} wrapperStyle={{ outline: "none" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {data.chart.map((item, index) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                  <span className="truncate text-muted-foreground">{item.name}</span>
                </span>
                <span className="font-semibold text-foreground">{item.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
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
          <Card className="p-4">
            <h2 className="mb-3 text-lg font-semibold">워드 클라우드</h2>
            <WordCloud keywords={data.keywords} />
          </Card>
        </div>
      </div>

      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">최신 기사</h2>
          <ArticleGrid articles={data.latest} />
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">중요 기사</h2>
          {data.important.map((article) => (
            <ArticleCard key={article.id} article={article} compact />
          ))}
        </div>
      </section>
    </div>
  );
}
