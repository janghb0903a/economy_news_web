import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, Check, ExternalLink, Landmark, Plus, Sparkles, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { conciseText, formatDate, isMostlyEnglish, percent } from "../lib/utils";
import { Badge, Button, Card, GhostButton, Input } from "../components/ui";

export default function ArticleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tag, setTag] = useState("");
  const [aiLogs, setAiLogs] = useState<string[]>([]);
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [aiStartedAt, setAiStartedAt] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["article", id], queryFn: () => api.article(id!), enabled: Boolean(id) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["article", id] });
  const addAiLog = (message: string) => {
    const time = new Intl.DateTimeFormat("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    setAiLogs((current) => [`${time} ${message}`, ...current].slice(0, 8));
  };
  const save = useMutation({ mutationFn: () => api.save(id!), onSuccess: refresh });
  const read = useMutation({ mutationFn: () => api.markRead(id!), onSuccess: refresh });
  const markBok = useMutation({ mutationFn: () => api.markBok(id!), onSuccess: refresh });
  const analyze = useMutation({
    mutationFn: () => api.analyze(id!),
    onMutate: () => {
      setAiStartedAt(Date.now());
      setAiElapsedSeconds(0);
      setAiLogs([]);
      addAiLog(`우선 AI 분석 요청 시작 (${settings?.ai_provider || "provider 확인 중"})`);
      addAiLog("선택한 기사를 일반 후처리보다 먼저 처리합니다.");
      addAiLog("원문 본문이 부족하면 본문 보강 후 AI 분석을 바로 진행합니다.");
    },
    onSuccess: () => {
      addAiLog("AI 분석 완료. 결과를 저장하고 화면을 갱신합니다.");
      refresh();
    },
    onError: (error) => {
      addAiLog(`AI 분석 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    },
    onSettled: () => {
      setAiStartedAt(null);
    }
  });
  const addTag = useMutation({
    mutationFn: () => api.addTag(id!, tag),
    onSuccess: () => {
      setTag("");
      refresh();
    }
  });
  const deleteTag = useMutation({
    mutationFn: (value: string) => api.deleteTag(id!, value),
    onSuccess: refresh
  });

  useEffect(() => {
    if (!aiStartedAt) return;
    const timer = window.setInterval(() => {
      setAiElapsedSeconds(Math.max(0, Math.floor((Date.now() - aiStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [aiStartedAt]);

  if (isLoading || !data) return <div className="text-muted-foreground">불러오는 중...</div>;

  const summary = conciseText(data.ai?.summary || data.summary || data.content, 520);
  const translatedTitle = data.translated_title?.trim() || data.ai?.translated_title?.trim();
  const showTranslatedTitle = Boolean(translatedTitle && isMostlyEnglish(data.title));
  const displayTitle = showTranslatedTitle ? translatedTitle : data.title;
  const visibleTags = data.tags.filter((tag) => tag && tag.toLowerCase() !== "unknown");
  const marketImpact = Object.entries(data.ai?.market_impact || {}).filter(([, value]) => value && value !== "unknown");
  const aiDisabled = settings?.ai_provider === "disabled";
  const llmUnavailableMessage = "현재 LLM 연동이 되어 있지 않아 AI 마사징 결과는 확인이 불가합니다. 크롤링, 기사 목록, 검색, 경제지표 API 데이터는 정상적으로 사용할 수 있습니다.";

  return (
    <article className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-3">
        <GhostButton onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> 뒤로
        </GhostButton>
        <div className="flex flex-wrap gap-2">
          <Badge>{data.source_name}</Badge>
          <Badge>{formatDate(data.published_at)}</Badge>
          {data.is_bok_related && <Badge className="bg-accent text-accent-foreground">BOK {percent(data.bok_relevance_score)}</Badge>}
          {data.importance_score >= 0.7 && <Badge className="bg-primary/10 text-primary">중요 {percent(data.importance_score)}</Badge>}
        </div>
        <div className="space-y-2">
          {showTranslatedTitle && <div className="text-xs font-semibold uppercase tracking-wide text-primary">번역 제목</div>}
          <h1 className="text-3xl font-semibold leading-tight" title={data.title}>
            {displayTitle}
          </h1>
          {showTranslatedTitle && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">원문 제목:</span> {data.title}
            </div>
          )}
          {!showTranslatedTitle && isMostlyEnglish(data.title) && (
            <p className="text-xs text-muted-foreground">번역 제목은 AI 분석 또는 설정의 해외 제목 번역 후 표시됩니다.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => read.mutate()}>
            <Check size={16} /> 읽음
          </Button>
          <GhostButton onClick={() => save.mutate()}>
            <Bookmark size={16} /> {data.is_saved ? "저장 해제" : "저장"}
          </GhostButton>
          <GhostButton onClick={() => markBok.mutate()}>
            <Landmark size={16} /> BOK 표시
          </GhostButton>
          <GhostButton
            onClick={() => {
              if (aiDisabled) {
                setAiLogs([]);
                addAiLog(llmUnavailableMessage);
                return;
              }
              analyze.mutate();
            }}
            disabled={analyze.isPending}
          >
            <Sparkles size={16} /> {analyze.isPending ? "AI 분석 중" : "AI 분석"}
          </GhostButton>
          <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium" href={data.url} target="_blank" rel="noopener noreferrer">
            원문 <ExternalLink size={15} />
          </a>
        </div>
        {(aiLogs.length > 0 || analyze.isPending) && (
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">AI 분석 로그</div>
              <div className="text-xs text-muted-foreground">
                provider: {settings?.ai_provider || "확인 중"}
                {analyze.isPending ? ` · ${aiElapsedSeconds}s 경과` : ""}
              </div>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {analyze.isPending && <div>응답 대기 중입니다. 로컬 LLM은 모델과 PC 성능에 따라 시간이 걸릴 수 있습니다.</div>}
              {aiLogs.map((log) => (
                <div key={log}>{log}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {aiDisabled && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="font-semibold">AI 기능 비활성화 상태</div>
          <p className="mt-1 leading-6">{llmUnavailableMessage}</p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-2 text-lg font-semibold">요약</h2>
        <p className="leading-7 text-muted-foreground">{summary || "요약이 아직 없습니다."}</p>
        {data.ai?.bullet_points?.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {data.ai.bullet_points.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 text-lg font-semibold">한국은행 관련도</h2>
          <div className="text-3xl font-semibold">{percent(data.bok_relevance_score)}</div>
          <p className="mt-2 text-sm text-muted-foreground">{data.ai?.bok_reason || "규칙 기반 키워드 매칭 결과입니다."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.bok_keywords.concat(data.bok_keyword_groups).map((keyword) => (
              <Badge key={keyword}>{keyword}</Badge>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 text-lg font-semibold">태그와 영향</h2>
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((tag) => (
              <Badge key={tag} className="gap-1 pr-1">
                #{tag}
                <button className="rounded-sm p-0.5 hover:bg-background" onClick={() => deleteTag.mutate(tag)} aria-label={`${tag} 태그 삭제`}>
                  <X size={12} />
                </button>
              </Badge>
            ))}
            {!visibleTags.length && <span className="text-sm text-muted-foreground">태그가 아직 없습니다.</span>}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (tag.trim()) addTag.mutate();
            }}
          >
            <Input placeholder="태그 추가" value={tag} onChange={(event) => setTag(event.target.value)} />
            <GhostButton type="submit" disabled={!tag.trim() || addTag.isPending}>
              <Plus size={15} /> 추가
            </GhostButton>
          </form>
          {marketImpact.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {marketImpact.map(([key, value]) => (
                <div key={key} className="rounded-md bg-muted p-2">
                  {key}: {value}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">시장 영향 분석 전입니다.</p>
          )}
        </Card>
      </div>
    </article>
  );
}
