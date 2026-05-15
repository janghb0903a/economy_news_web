import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Building2, CheckCircle2, Clock3, LineChart, Loader2, Newspaper, Search, ShieldAlert, Sparkles, TrendingUp, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { CompanyAnalysis, CompanyAnalysisArticle, CompanyAnalysisJob, CompanyQuote } from "../lib/types";
import { Badge, Button, Card, Input, Select } from "../components/ui";
import { cn, formatDate, percent } from "../lib/utils";

const sentimentLabel = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립"
};

const sentimentClass = {
  positive: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  negative: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  neutral: "bg-muted text-muted-foreground"
};

const statusMeta = {
  queued: { label: "대기", icon: Clock3, className: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200" },
  running: { label: "진행 중", icon: Loader2, className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  completed: { label: "완료", icon: CheckCircle2, className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  failed: { label: "실패", icon: XCircle, className: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" }
};

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function changeClass(value: number | null | undefined) {
  if ((value || 0) > 0) return "text-emerald-600 dark:text-emerald-300";
  if ((value || 0) < 0) return "text-rose-600 dark:text-rose-300";
  return "text-muted-foreground";
}

function logTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function QuoteCard({ quote, title }: { quote: CompanyQuote; title: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {quote.symbol} · {quote.date} {quote.time}
          </div>
        </div>
        <Badge className={cn((quote.change_pct || 0) >= 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200")}>
          {(quote.change_pct || 0) >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {formatNumber(quote.change_pct)}%
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">종가</div>
          <div className="font-semibold">{formatNumber(quote.close, 3)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">거래량</div>
          <div className="font-semibold">{formatNumber(quote.volume, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">고가</div>
          <div className="font-semibold">{formatNumber(quote.high, 3)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">저가</div>
          <div className="font-semibold">{formatNumber(quote.low, 3)}</div>
        </div>
      </div>
    </div>
  );
}

function FactorList({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "negative" | "neutral" }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Badge className={sentimentClass[tone]}>{title}</Badge>
      </div>
      <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
        {items.slice(0, 5).map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ArticleRow({ article }: { article: CompanyAnalysisArticle }) {
  return (
    <Link to={`/articles/${article.id}`} className="block rounded-md border border-border p-3 transition hover:border-primary/60 hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={sentimentClass[article.sentiment]}>{sentimentLabel[article.sentiment]}</Badge>
        <Badge>{article.source_name}</Badge>
        <Badge>{formatDate(article.published_at)}</Badge>
        {article.importance_score >= 0.7 ? <Badge className="bg-primary/10 text-primary">중요 {percent(article.importance_score)}</Badge> : null}
      </div>
      <div className="mt-2 line-clamp-2 font-semibold">{article.title}</div>
      <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{article.summary || article.original_title}</div>
      <div className="mt-3 flex flex-wrap gap-1">
        {[...article.positive_keywords, ...article.negative_keywords].slice(0, 5).map((keyword) => (
          <span key={keyword} className="text-xs text-muted-foreground">#{keyword}</span>
        ))}
      </div>
    </Link>
  );
}

function AnalysisProgress({ job }: { job: CompanyAnalysisJob }) {
  const meta = statusMeta[job.status] || statusMeta.queued;
  const Icon = meta.icon;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">진행 로그</h2>
          <p className="mt-1 text-sm text-muted-foreground">기업 분석이 어느 단계까지 진행됐는지 실시간으로 확인합니다.</p>
        </div>
        <Badge className={meta.className}>
          <Icon size={14} className={job.status === "running" ? "animate-spin" : ""} />
          {meta.label}
        </Badge>
      </div>
      <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-md border border-border bg-muted/30 p-3">
        {job.logs.map((log, index) => (
          <div key={`${log.time}-${index}`} className="grid gap-2 text-sm sm:grid-cols-[86px_1fr]">
            <span className="font-mono text-xs text-muted-foreground">{logTime(log.time)}</span>
            <span>{log.message}</span>
          </div>
        ))}
      </div>
      {job.error ? <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{job.error}</div> : null}
    </Card>
  );
}

function AnalysisResult({ data }: { data: CompanyAnalysis }) {
  const sentimentTotal = Math.max(1, data.sentiment.positive_count + data.sentiment.negative_count + data.sentiment.neutral_count);
  const positiveWidth = `${(data.sentiment.positive_count / sentimentTotal) * 100}%`;
  const negativeWidth = `${(data.sentiment.negative_count / sentimentTotal) * 100}%`;
  const neutralWidth = `${(data.sentiment.neutral_count / sentimentTotal) * 100}%`;
  const topPositive = data.articles.filter((article) => article.sentiment === "positive").slice(0, 6);
  const topNegative = data.articles.filter((article) => article.sentiment === "negative").slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge><Building2 size={12} /> {data.resolved_name}</Badge>
                <Badge>{data.market === "KR" ? "한국" : data.market === "US" ? "미국" : "자동"}</Badge>
                <Badge className={data.memo.ai_available ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}>
                  <Sparkles size={12} /> {data.memo.ai_available ? "AI 분석" : "규칙 기반"}
                </Badge>
              </div>
              <h2 className="mt-3 text-2xl font-semibold">{data.company_name} 분석</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.memo.overall_view}</p>
            </div>
            <div className="rounded-md bg-muted px-4 py-3 text-right">
              <div className="text-xs text-muted-foreground">기사 신호</div>
              <div className="mt-1 text-lg font-semibold">{data.sentiment.label}</div>
            </div>
          </div>
          {data.memo.message ? <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{data.memo.message}</div> : null}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>긍정 {data.sentiment.positive_count}</span>
              <span>중립 {data.sentiment.neutral_count}</span>
              <span>부정 {data.sentiment.negative_count}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              <div className="bg-emerald-500" style={{ width: positiveWidth }} />
              <div className="bg-slate-400" style={{ width: neutralWidth }} />
              <div className="bg-rose-500" style={{ width: negativeWidth }} />
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-border p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldAlert size={17} className="text-primary" /> 투자 관점 한마디</div>
            <p className="text-sm leading-6 text-muted-foreground">{data.memo.investment_view}</p>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">주가와 동종업 비교</h3>
              <p className="mt-1 text-xs text-muted-foreground">계정 없는 시세 조회 fallback 기반입니다. 가져오지 못해도 기사 분석은 계속 표시됩니다.</p>
            </div>
            <LineChart className="text-primary" size={20} />
          </div>
          {data.stock.quote ? (
            <QuoteCard quote={data.stock.quote} title={data.stock.company_name} />
          ) : (
            <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">{data.stock.message}</div>
          )}
          {data.stock.peers.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">동종업 평균 변동률</span>
                <span className={cn("font-semibold", changeClass(data.stock.peer_average_change_pct))}>{formatNumber(data.stock.peer_average_change_pct)}%</span>
              </div>
              <div className="grid gap-2">
                {data.stock.peers.map((peer) => (
                  <div key={peer.symbol} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
                    <span>{peer.symbol}</span>
                    <span className={cn("font-medium", changeClass(peer.change_pct))}>{formatNumber(peer.change_pct)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FactorList title="긍정 요인" items={data.memo.positive_factors} tone="positive" />
        <FactorList title="부정 요인" items={data.memo.negative_factors} tone="negative" />
        <FactorList title="확인 포인트" items={data.memo.watch_points} tone="neutral" />
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 font-semibold"><TrendingUp size={17} className="text-primary" /> 경제 분위기 속 해석</div>
        <p className="text-sm leading-6 text-muted-foreground">{data.memo.economic_context}</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><Newspaper size={17} className="text-emerald-600" /> 긍정 기사</h3>
          <div className="space-y-3">
            {topPositive.length > 0 ? topPositive.map((article) => <ArticleRow key={article.id} article={article} />) : <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">긍정으로 분류된 관련 기사가 아직 없습니다.</div>}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><Newspaper size={17} className="text-rose-600" /> 부정 기사</h3>
          <div className="space-y-3">
            {topNegative.length > 0 ? topNegative.map((article) => <ArticleRow key={article.id} article={article} />) : <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">부정으로 분류된 관련 기사가 아직 없습니다.</div>}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">전체 관련 기사</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {data.articles.slice(0, 12).map((article) => <ArticleRow key={article.id} article={article} />)}
        </div>
      </Card>
    </div>
  );
}

export default function CompanyAnalysisPage() {
  const [companyName, setCompanyName] = useState("");
  const [market, setMarket] = useState("KR");
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CompanyAnalysis | null>(null);
  const [accessWarning, setAccessWarning] = useState("");
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const aiProvider = settings?.ai_provider || "disabled";
  const companyAnalysisBlocked = settings ? aiProvider === "disabled" || !settings.enable_ai_boost : false;
  const blockReason =
    aiProvider === "disabled"
      ? "AI 기능이 비활성화되어 기업 분석을 사용할 수 없습니다."
      : "AI Boost 기능 비활성화로 기업 분석을 사용할 수 없습니다.";

  const startMutation = useMutation({
    mutationFn: () => api.startCompanyAnalysis({ company_name: companyName.trim(), market }),
    onSuccess: (data) => {
      setJobId(data.job_id);
      setLastResult(null);
    }
  });

  const jobQuery = useQuery({
    queryKey: ["company-analysis-job", jobId],
    queryFn: () => api.companyAnalysisJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as CompanyAnalysisJob | undefined;
      return data?.status === "completed" || data?.status === "failed" ? false : 1000;
    }
  });

  useEffect(() => {
    if (jobQuery.data?.status === "completed" && jobQuery.data.result) {
      setLastResult(jobQuery.data.result);
    }
  }, [jobQuery.data]);

  const isRunning = startMutation.isPending || jobQuery.data?.status === "queued" || jobQuery.data?.status === "running";
  const canSubmit = useMemo(() => companyName.trim().length >= 2 && !isRunning, [companyName, isRunning]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setAccessWarning("");
    if (companyAnalysisBlocked) {
      setAccessWarning(blockReason);
      return;
    }
    if (canSubmit) startMutation.mutate();
  }

  const currentError = startMutation.isError ? (startMutation.error as Error).message : jobQuery.data?.error;
  const result = jobQuery.data?.result || lastResult;

  if (companyAnalysisBlocked) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">기업 분석</h1>
          <p className="mt-1 text-sm text-muted-foreground">기업 분석은 AI와 AI Boost가 모두 켜져 있을 때 사용할 수 있습니다.</p>
        </div>

        <Card className="border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100">
                <ShieldAlert size={22} />
              </div>
              <h2 className="text-xl font-semibold">{blockReason}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6">
                기사 상세의 AI 분석 버튼은 건별 실행 기능이라 계속 사용할 수 있습니다. 기업 분석은 여러 기사와 시세 정보를 묶어 해석하는 무거운 작업이라 AI 기능과 AI Boost를 모두 켠 경우에만 열어둡니다.
              </p>
            </div>
            <Link
              to="/settings"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              설정으로 이동
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">기업 분석</h1>
        <p className="mt-1 text-sm text-muted-foreground">수집된 기사와 주가 정보를 함께 보고, 기업에 대한 긍정·부정 신호와 투자 관점 메모를 확인합니다.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[180px_1fr_auto]">
          <Select value={market} onChange={(event) => setMarket(event.target.value)}>
            <option value="KR">한국 기업</option>
            <option value="US">미국 기업</option>
            <option value="AUTO">자동</option>
          </Select>
          <Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="기업명 입력: 예) 삼성전자, Apple, Nvidia" />
          <Button disabled={!canSubmit}>
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {isRunning ? "분석 중" : "분석"}
          </Button>
        </form>
        {accessWarning && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {accessWarning} 설정의 AI 탭에서 AI Boost를 활성화하면 기업 분석을 사용할 수 있습니다. 유료 API를 연결한 경우 비용이 발생할 수 있습니다.
          </div>
        )}
        <div className="mt-3 text-xs leading-5 text-muted-foreground">
          종목 코드는 입력하지 않아도 됩니다. 알려진 기업명은 자동 매핑하며, 매핑되지 않는 기업은 기사 분석부터 보여줍니다.
        </div>
      </Card>

      {jobQuery.data ? <AnalysisProgress job={jobQuery.data} /> : null}

      {currentError ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          기업 분석 중 오류가 발생했습니다: {currentError}
        </Card>
      ) : null}

      {result ? <AnalysisResult data={result} /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Newspaper size={17} className="text-primary" /> 기사 신호</div>
            <p className="text-sm leading-6 text-muted-foreground">기업명과 관련된 수집 기사에서 긍정, 부정, 중립 신호를 먼저 분류합니다.</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold"><LineChart size={17} className="text-primary" /> 주가 비교</div>
            <p className="text-sm leading-6 text-muted-foreground">가능한 경우 주가, 거래량, 동종업 변동률을 함께 보여줍니다.</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Sparkles size={17} className="text-primary" /> AI 메모</div>
            <p className="text-sm leading-6 text-muted-foreground">LLM이 연결되어 있으면 기사와 시세를 바탕으로 투자 관점 코멘트를 생성합니다.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
