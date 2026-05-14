import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Database, ListChecks, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Settings } from "../lib/types";
import { Button, Card, GhostButton, Input, Select } from "../components/ui";
import { cn, formatDate } from "../lib/utils";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const { data: recentIngestLogs = [] } = useQuery({ queryKey: ["ingestLogs"], queryFn: api.ingestLogs });
  const { data: postprocessStatus } = useQuery({ queryKey: ["postprocessStatus"], queryFn: api.postprocessStatus, refetchInterval: 3000 });
  const { data: ingestSchedule } = useQuery({ queryKey: ["ingestSchedule"], queryFn: api.ingestSchedule, refetchInterval: 15000 });
  const [settingsDraft, setSettingsDraft] = useState<Partial<Settings>>({});
  const [clock, setClock] = useState(() => Date.now());
  const [newSource, setNewSource] = useState({ name: "", url: "", region: "domestic", category: "economy", language: "ko", enabled: true });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [showPostprocessLogs, setShowPostprocessLogs] = useState(false);
  const [selectedPostprocessLogId, setSelectedPostprocessLogId] = useState<number | null>(null);
  const updateSettings = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(["settings"], nextSettings);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["postprocessStatus"] });
      queryClient.invalidateQueries({ queryKey: ["ingestSchedule"] });
    }
  });
  const createSource = useMutation({ mutationFn: api.createSource, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }) });
  const deleteSource = useMutation({ mutationFn: api.deleteSource, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }) });
  const runPostprocess = useMutation({
    mutationFn: api.runPostprocess,
    onSuccess: () => {
      setShowPostprocessLogs(true);
      queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
      queryClient.invalidateQueries({ queryKey: ["postprocessStatus"] });
    }
  });
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
      addIngestLog("뉴스 수집 완료");
      result.results.forEach((item) => {
        const row = item as { source?: string; fetched?: number; new?: number; error?: string | null };
        addIngestLog(`${row.source || "source"}: 수집 ${row.fetched ?? 0}건, 신규 ${row.new ?? 0}건${row.error ? `, 오류 ${row.error}` : ""}`);
      });
      queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (error) => addIngestLog(`뉴스 수집 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`)
  });

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    createSource.mutate(newSource, {
      onSuccess: () => setNewSource({ name: "", url: "", region: "domestic", category: "economy", language: "ko", enabled: true })
    });
  };

  useEffect(() => {
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    if (settings) setSettingsDraft(settings);
  }, [settings]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const draft = {
    ai_provider: settingsDraft.ai_provider ?? settings?.ai_provider ?? "disabled",
    ai_model: settingsDraft.ai_model ?? settings?.ai_model ?? "",
    news_fetch_interval_minutes: settingsDraft.news_fetch_interval_minutes ?? settings?.news_fetch_interval_minutes ?? 10,
    article_retention_days: settingsDraft.article_retention_days ?? settings?.article_retention_days ?? 180,
    report_retention_days: settingsDraft.report_retention_days ?? settings?.report_retention_days ?? 30,
    report_final_time: settingsDraft.report_final_time ?? settings?.report_final_time ?? "18:00",
    enable_browser_notifications: settingsDraft.enable_browser_notifications ?? settings?.enable_browser_notifications ?? true,
    enable_ai_summary_postprocess: settingsDraft.enable_ai_summary_postprocess ?? settings?.enable_ai_summary_postprocess ?? false,
    enable_title_translation_postprocess: settingsDraft.enable_title_translation_postprocess ?? settings?.enable_title_translation_postprocess ?? false
  };
  const postprocessProgress =
    postprocessStatus && postprocessStatus.total > 0 ? Math.min(100, Math.round((postprocessStatus.processed / postprocessStatus.total) * 100)) : 0;
  const postprocessActive = runPostprocess.isPending || postprocessStatus?.running;
  const nextIngestAt = ingestSchedule?.next_run_at ? new Date(ingestSchedule.next_run_at).getTime() : null;
  const nextIngestRemainMs = nextIngestAt ? Math.max(0, nextIngestAt - clock) : null;
  const nextIngestRemainText = nextIngestRemainMs === null ? "계산 중" : formatDuration(nextIngestRemainMs);

  const setDraft = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
    updateSettings.mutate({ [key]: value } as Partial<Settings>);
  };
  const setSettingsPatch = (patch: Partial<Settings>) => {
    setSettingsDraft((current) => ({ ...current, ...patch }));
    updateSettings.mutate(patch);
  };

  const askNotification = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      new Notification("Economy News 알림이 켜졌습니다.", { body: "중요 기사나 한국은행 관련 후보를 알려드립니다." });
    }
  };

  const notificationText =
    notificationPermission === "granted"
      ? "허용됨: 중요 기사나 BOK 후보가 있을 때 브라우저가 열려 있으면 알림을 표시합니다."
      : notificationPermission === "denied"
        ? "차단됨: 브라우저 주소창의 사이트 설정에서 알림 권한을 다시 허용해야 합니다."
        : notificationPermission === "default"
          ? "아직 선택하지 않음: 버튼을 누르면 브라우저 권한 창이 뜹니다."
          : "이 브라우저는 알림 API를 지원하지 않습니다.";

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">설정</h1>
            <p className="mt-1 text-sm text-muted-foreground">뉴스 소스, AI provider, 알림과 데이터 수집을 관리합니다.</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
            {updateSettings.isPending ? "변경 사항 반영 중..." : "변경 즉시 반영"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">AI provider</h2>
          <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">AI 기능</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  비활성화해도 크롤링, 검색, 경제지표 API 데이터는 정상 동작합니다. 다만 AI 마사징이 필요한 요약/번역/해석은 LLM 연동 전까지 결과 확인이 불가합니다.
                </div>
              </div>
              <button
                type="button"
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                  draft.ai_provider !== "disabled"
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
                onClick={() => {
                  if (draft.ai_provider === "disabled") {
                    setSettingsPatch({ ai_provider: "ollama", ai_model: draft.ai_model || "gemma4" });
                  } else {
                    setSettingsPatch({ ai_provider: "disabled" });
                  }
                }}
              >
                {draft.ai_provider !== "disabled" && <Check size={15} />}
                {draft.ai_provider !== "disabled" ? "활성화" : "비활성화"}
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              value={draft.ai_provider === "disabled" ? "ollama" : draft.ai_provider}
              onChange={(event) => setSettingsPatch({ ai_provider: event.target.value, ai_model: draft.ai_model || (event.target.value === "ollama" ? "gemma4" : "") })}
              disabled={draft.ai_provider === "disabled"}
            >
              <option value="ollama">ollama</option>
              <option value="openai">openai</option>
              <option value="gemini">gemini</option>
            </Select>
            <Input
              placeholder={draft.ai_provider === "ollama" || draft.ai_provider === "disabled" ? "gemma4" : "모델명"}
              value={draft.ai_model}
              onChange={(event) => setDraft("ai_model", event.target.value)}
              disabled={draft.ai_provider === "disabled"}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">현재 provider: {draft.ai_provider}</span>
            <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">현재 모델: {draft.ai_model || (draft.ai_provider === "ollama" ? "gemma4" : "미설정")}</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">API Key는 backend `.env`에서만 읽고 브라우저로 내려오지 않습니다.</p>
          <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">백엔드 후처리</div>
              <div className="flex gap-2">
                <GhostButton
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    setShowPostprocessLogs(true);
                    queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
                  }}
                >
                  <ListChecks size={14} /> 후처리 로그
                </GhostButton>
                <GhostButton className="h-8 px-2 text-xs" onClick={() => queryClient.invalidateQueries({ queryKey: ["ingestLogs"] })}>
                  <RefreshCw size={14} /> 새로고침
                </GhostButton>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition",
                    postprocessActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-foreground hover:bg-muted"
                  )}
                  onClick={() => {
                    setShowPostprocessLogs(true);
                    runPostprocess.mutate();
                  }}
                  disabled={Boolean(postprocessActive)}
                >
                  <RefreshCw size={14} className={cn(postprocessActive && "animate-spin")} />
                  {postprocessActive ? "후처리 활성화" : "후처리 실행"}
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              수집이 끝나면 해외 제목 번역을 먼저 처리하고, 본문 보강 후 AI 요약을 진행합니다. 새 수집이 시작되면 후처리는 잠시 멈춥니다.
            </p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDraft("enable_ai_summary_postprocess", !draft.enable_ai_summary_postprocess)}
                className={cn(
                  "rounded-md border p-3 text-left transition",
                  draft.enable_ai_summary_postprocess
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">AI 요약</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                      draft.enable_ai_summary_postprocess ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {draft.enable_ai_summary_postprocess && <Check size={13} />} {draft.enable_ai_summary_postprocess ? "활성화" : "비활성화"}
                  </span>
                </div>
                <div className={cn("mt-2 text-xs", draft.enable_ai_summary_postprocess ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  수집이 끝난 뒤 요약이 없는 기사만 순차 처리합니다.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDraft("enable_title_translation_postprocess", !draft.enable_title_translation_postprocess)}
                className={cn(
                  "rounded-md border p-3 text-left transition",
                  draft.enable_title_translation_postprocess
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">제목 번역</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                      draft.enable_title_translation_postprocess ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {draft.enable_title_translation_postprocess && <Check size={13} />} {draft.enable_title_translation_postprocess ? "활성화" : "비활성화"}
                  </span>
                </div>
                <div className={cn("mt-2 text-xs", draft.enable_title_translation_postprocess ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  해외 기사 중 번역 제목이 없는 항목만 묶어서 처리합니다.
                </div>
              </button>
            </div>
          </div>
          {showPostprocessLogs && (
            <div className="mt-3 rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">후처리 로그</div>
                <GhostButton className="h-8 px-2 text-xs" onClick={() => setShowPostprocessLogs(false)}>
                  전체 로그로 돌아가기
                </GhostButton>
              </div>
              <div className="space-y-2 text-xs">
                {postprocessStatus && (
                  <div>
                    <button
                      className="grid w-full gap-2 rounded-md border border-primary/25 bg-primary/10 p-2 text-left md:grid-cols-[135px_1fr_auto]"
                      onClick={() => setSelectedPostprocessLogId((current) => (current === -1 ? null : -1))}
                      aria-expanded={selectedPostprocessLogId === -1}
                    >
                      <div className="font-semibold text-primary">{postprocessStatus.running ? "진행 중" : "현재 상태"}</div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {postprocessStatus.stage || "대기"} · {postprocessStatus.message || "대기 중"}
                        </div>
                        {postprocessStatus.current_title && <div className="truncate text-muted-foreground">현재: {postprocessStatus.current_title}</div>}
                      </div>
                      <div className="text-muted-foreground">
                        {postprocessStatus.total > 0 ? `${postprocessStatus.processed}/${postprocessStatus.total}건` : "대상 확인 중"}
                      </div>
                    </button>
                    {selectedPostprocessLogId === -1 && (
                      <div className="rounded-b-md border-x border-b border-primary/25 bg-card p-3 text-muted-foreground">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>단계: {postprocessStatus.stage || "대기"}</div>
                          <div>
                            진행: {postprocessStatus.total > 0 ? `${postprocessStatus.processed}/${postprocessStatus.total}건` : "대상 확인 중"}
                            {postprocessStatus.updated > 0 ? ` · 반영 ${postprocessStatus.updated}건` : ""}
                          </div>
                        </div>
                        {postprocessStatus.total > 0 && (
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${postprocessProgress}%` }} />
                          </div>
                        )}
                        {postprocessStatus.current_title && <div className="mt-2 truncate">현재 처리: {postprocessStatus.current_title}</div>}
                        {postprocessStatus.updated_at && <div className="mt-1">마지막 갱신: {formatDate(postprocessStatus.updated_at)}</div>}
                      </div>
                    )}
                  </div>
                )}
                {recentIngestLogs.filter((log) => log.source_name.startsWith("후처리")).length === 0 && <div className="text-muted-foreground">아직 후처리 로그가 없습니다.</div>}
                {recentIngestLogs
                  .filter((log) => log.source_name.startsWith("후처리"))
                  .slice(0, 8)
                  .map((log) => (
                    <div key={log.id}>
                      <button
                        className="grid w-full gap-2 rounded-md bg-muted/60 p-2 text-left md:grid-cols-[135px_1fr_auto]"
                        onClick={() => setSelectedPostprocessLogId((current) => (current === log.id ? null : log.id))}
                      >
                        <div className="text-muted-foreground">{formatDate(log.created_at)}</div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{log.source_name}</div>
                          {log.message && <div className="truncate text-muted-foreground">{log.message}</div>}
                        </div>
                        <div className="text-muted-foreground">처리 {log.fetched_count} / 반영 {log.new_count}</div>
                      </button>
                      {selectedPostprocessLogId === log.id && (
                        <div className="rounded-b-md border-x border-b border-border bg-card p-3 text-muted-foreground">
                          <div>상태: {log.status}</div>
                          <div>처리 대상: {log.fetched_count}건</div>
                          <div>반영: {log.new_count}건</div>
                          <div>시간: {formatDate(log.created_at)}</div>
                          {log.message && <div className="mt-1">메시지: {log.message}</div>}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold">수집과 알림</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => ingest.mutate()} disabled={ingest.isPending}>
              <Database size={16} /> 지금 수집
            </Button>
            <GhostButton onClick={askNotification}>
              <Bell size={16} /> 브라우저 알림 권한
            </GhostButton>
          </div>
          {(ingest.isPending || ingestLogs.length > 0) && (
            <div className="mt-3 rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">수집 로그</div>
                {ingest.isPending && <span className="text-xs text-muted-foreground">진행 중...</span>}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {ingestLogs.map((log) => (
                  <div key={log}>{log}</div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">알림 상태</span>
              <span
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  notificationPermission === "granted" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                  notificationPermission === "denied" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
                  notificationPermission === "default" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
                  notificationPermission === "unsupported" && "bg-muted-foreground/15 text-muted-foreground"
                )}
              >
                {notificationPermission === "granted" ? "허용됨" : notificationPermission === "denied" ? "차단됨" : notificationPermission === "default" ? "미선택" : "미지원"}
              </span>
            </div>
            <p className="mt-1">{notificationText}</p>
            {notificationPermission === "denied" && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-card p-3 text-xs leading-5">
                <div className="font-semibold text-foreground">차단 해제 방법</div>
                <p>
                  Chrome: 주소창 왼쪽 사이트 정보 아이콘 클릭 → 사이트 설정 → 알림 → 허용으로 변경 → 이 페이지 새로고침
                </p>
                <p>
                  Edge: 주소창 왼쪽 자물쇠/사이트 정보 아이콘 클릭 → 이 사이트에 대한 사용 권한 → 알림 → 허용으로 변경 → 이 페이지 새로고침
                </p>
              </div>
            )}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">자동 수집 주기</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={draft.news_fetch_interval_minutes}
                  onChange={(event) => setDraft("news_fetch_interval_minutes", Number(event.target.value))}
                />
                <span className="shrink-0 text-sm text-muted-foreground">분</span>
              </div>
              <p className="text-xs text-muted-foreground">백그라운드에서 RSS를 다시 확인하는 간격입니다.</p>
              <div className="rounded-md border border-border bg-card p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">다음 자동 수집</span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-1 font-semibold",
                      ingestSchedule?.running ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {ingestSchedule?.running ? "예약됨" : "대기"}
                  </span>
                </div>
                <div className="mt-2 text-muted-foreground">
                  {ingestSchedule?.next_run_at ? `${formatDate(ingestSchedule.next_run_at)} · 약 ${nextIngestRemainText} 후` : "아직 예약 시간이 없습니다."}
                </div>
                <div className="mt-1 text-muted-foreground">현재 적용 주기: {ingestSchedule?.interval_minutes ?? draft.news_fetch_interval_minutes}분</div>
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">기사 보관 기간</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={draft.article_retention_days}
                  onChange={(event) => setDraft("article_retention_days", Number(event.target.value))}
                />
                <span className="shrink-0 text-sm text-muted-foreground">일</span>
              </div>
              <p className="text-xs text-muted-foreground">저장하지 않은 오래된 기사를 정리하는 기준입니다.</p>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">보고서 보관 기간</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={draft.report_retention_days}
                  onChange={(event) => setDraft("report_retention_days", Number(event.target.value))}
                />
                <span className="shrink-0 text-sm text-muted-foreground">일</span>
              </div>
              <p className="text-xs text-muted-foreground">확정 저장 보고서를 보관하는 기간입니다.</p>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">보고서 마감 시간</span>
              <Input
                type="time"
                value={draft.report_final_time}
                onChange={(event) => setDraft("report_final_time", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                매일 이 시간에 확정 보고서를 저장하고, 해당 일자 00:00부터 이 시간까지 수집된 기사만 최종본에 반영합니다. 기본값은 18:00입니다.
              </p>
            </label>
          </div>
          {recentIngestLogs.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-card p-3">
              <div className="mb-2 text-sm font-semibold">최근 수집 기록</div>
              <div className="space-y-2 text-xs">
                {recentIngestLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="grid gap-2 rounded-md bg-muted/60 p-2 md:grid-cols-[135px_1fr_auto]">
                    <div className="text-muted-foreground">{formatDate(log.created_at)}</div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{log.source_name}</div>
                      {log.message && <div className="truncate text-muted-foreground">{log.message}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-md px-2 py-1 font-semibold",
                          (log.status === "ok" || log.status === "postprocess_ok") && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                          log.status === "postprocess_paused" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
                          log.status === "postprocess_skipped" && "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200",
                          log.status.includes("error") && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                        )}
                      >
                        {log.status === "ok" || log.status === "postprocess_ok" ? "성공" : log.status === "postprocess_paused" ? "일시중단" : log.status === "postprocess_skipped" ? "건너뜀" : log.status}
                      </span>
                      <span className="text-muted-foreground">수집 {log.fetched_count} / 신규 {log.new_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-4 text-lg font-semibold">뉴스 소스 관리</h2>
        <form onSubmit={submitSource} className="mb-4 grid gap-2 md:grid-cols-[1fr_2fr_120px_120px_auto]">
          <Input placeholder="이름" value={newSource.name} onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))} required />
          <Input placeholder="RSS/Atom URL" value={newSource.url} onChange={(e) => setNewSource((s) => ({ ...s, url: e.target.value }))} required />
          <Select value={newSource.region} onChange={(e) => setNewSource((s) => ({ ...s, region: e.target.value }))}>
            <option value="domestic">국내</option>
            <option value="global">해외</option>
          </Select>
          <Input placeholder="카테고리" value={newSource.category} onChange={(e) => setNewSource((s) => ({ ...s, category: e.target.value }))} />
          <Button type="submit">
            <Plus size={16} /> 추가
          </Button>
        </form>
        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm md:grid-cols-[1fr_2fr_100px_80px_auto]">
              <div className="font-medium">{source.name}</div>
              <div className="truncate text-muted-foreground">{source.url}</div>
              <div>{source.region}</div>
              <div>{source.enabled ? "활성" : "비활성"}</div>
              <GhostButton onClick={() => deleteSource.mutate(source.id)} aria-label="delete">
                <Trash2 size={15} />
              </GhostButton>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}초`;
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}
