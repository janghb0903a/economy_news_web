import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Bell, Bot, Check, ChevronLeft, ChevronRight, Copy, Database, ListChecks, Mail, Plus, RefreshCw, Rss, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import type { Settings } from "../lib/types";
import { Button, Card, GhostButton, Input, Select } from "../components/ui";
import { cn, formatDate } from "../lib/utils";

type SettingsTab = "ai" | "ingest" | "email" | "sources";

const tabs: { id: SettingsTab; label: string; description: string; icon: typeof Bot }[] = [
  { id: "ai", label: "AI", description: "Provider, 모델, 후처리", icon: Bot },
  { id: "ingest", label: "알람 및 수집", description: "수집 주기, 알림, 보고서", icon: Bell },
  { id: "email", label: "이메일", description: "보고서 자동 발송", icon: Mail },
  { id: "sources", label: "소스", description: "RSS/Atom 뉴스 소스", icon: Rss }
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "ai" || value === "ingest" || value === "email" || value === "sources";
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [postprocessLogPage, setPostprocessLogPage] = useState(1);
  const [collectionLogPage, setCollectionLogPage] = useState(1);
  const [showPostprocessLogs, setShowPostprocessLogs] = useState(false);
  const [showCollectionLogs, setShowCollectionLogs] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: api.sources });
  const { data: recentIngestLogsPage } = useQuery({
    queryKey: ["ingestLogs", "postprocess", postprocessLogPage],
    queryFn: () => api.ingestLogs({ page: postprocessLogPage, page_size: 8, hours: 12, log_type: "ai" }),
    enabled: showPostprocessLogs
  });
  const { data: collectionLogsPage } = useQuery({
    queryKey: ["ingestLogs", "collection", collectionLogPage],
    queryFn: () => api.ingestLogs({ page: collectionLogPage, page_size: 10, hours: 12, log_type: "collection" }),
    refetchInterval: 15000
  });
  const { data: postprocessStatus } = useQuery({ queryKey: ["postprocessStatus"], queryFn: api.postprocessStatus, refetchInterval: 3000 });
  const { data: ingestSchedule } = useQuery({ queryKey: ["ingestSchedule"], queryFn: api.ingestSchedule, refetchInterval: 15000 });

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const tab = searchParams.get("tab");
    return isSettingsTab(tab) ? tab : "ai";
  });
  const [settingsDraft, setSettingsDraft] = useState<Partial<Settings>>({});
  const [clock, setClock] = useState(() => Date.now());
  const [newSource, setNewSource] = useState({ name: "", url: "", region: "domestic", category: "economy", language: "ko", enabled: true });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [selectedPostprocessLogId, setSelectedPostprocessLogId] = useState<number | null>(null);
  const [aiBoostConfirmOpen, setAiBoostConfirmOpen] = useState(false);
  const [aiBoostBlockedOpen, setAiBoostBlockedOpen] = useState(false);
  const [emailRecipientDraft, setEmailRecipientDraft] = useState("");
  const [smtpPasswordDraft, setSmtpPasswordDraft] = useState("");
  const [emailSendMessage, setEmailSendMessage] = useState("");

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
  const updateSource = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { enabled?: boolean; name?: string; url?: string; region?: string; category?: string; language?: string } }) =>
      api.updateSource(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] })
  });
  const runBodyPostprocess = useMutation({
    mutationFn: api.runBodyPostprocess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
      queryClient.invalidateQueries({ queryKey: ["postprocessStatus"] });
    }
  });
  const runAiPostprocess = useMutation({
    mutationFn: api.runAiPostprocess,
    onSuccess: () => {
      setShowPostprocessLogs(true);
      queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
      queryClient.invalidateQueries({ queryKey: ["postprocessStatus"] });
    }
  });
  const sendLatestReportEmail = useMutation({
    mutationFn: api.sendLatestReportEmail,
    onMutate: () => setEmailSendMessage("최근 확정 보고서 이메일 발송을 요청했습니다."),
    onSuccess: (result) => {
      setEmailSendMessage(result.ok ? `${result.report_date || "최근"} 보고서를 ${result.recipients?.length ?? 0}명에게 발송했습니다.` : result.message || "발송 요청이 완료되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
    },
    onError: (error) => setEmailSendMessage(error instanceof Error ? error.message : "이메일 발송에 실패했습니다.")
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

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (isSettingsTab(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [activeTab, searchParams]);

  const draft = {
    ai_provider: settingsDraft.ai_provider ?? settings?.ai_provider ?? "disabled",
    ai_model: settingsDraft.ai_model ?? settings?.ai_model ?? "",
    news_fetch_interval_minutes: settingsDraft.news_fetch_interval_minutes ?? settings?.news_fetch_interval_minutes ?? 10,
    article_retention_days: settingsDraft.article_retention_days ?? settings?.article_retention_days ?? 14,
    report_retention_days: settingsDraft.report_retention_days ?? settings?.report_retention_days ?? 30,
    report_final_time: settingsDraft.report_final_time ?? settings?.report_final_time ?? "18:00",
    report_email_enabled: settingsDraft.report_email_enabled ?? settings?.report_email_enabled ?? false,
    report_email_time: settingsDraft.report_email_time ?? settings?.report_email_time ?? "18:10",
    report_email_recipients: settingsDraft.report_email_recipients ?? settings?.report_email_recipients ?? [],
    report_email_formats: settingsDraft.report_email_formats ?? settings?.report_email_formats ?? ["md", "html"],
    smtp_host: settingsDraft.smtp_host ?? settings?.smtp_host ?? "",
    smtp_port: settingsDraft.smtp_port ?? settings?.smtp_port ?? 587,
    smtp_username: settingsDraft.smtp_username ?? settings?.smtp_username ?? "",
    smtp_from_email: settingsDraft.smtp_from_email ?? settings?.smtp_from_email ?? "",
    smtp_from_name: settingsDraft.smtp_from_name ?? settings?.smtp_from_name ?? "Economy News Dashboard",
    smtp_use_tls: settingsDraft.smtp_use_tls ?? settings?.smtp_use_tls ?? true,
    smtp_use_ssl: settingsDraft.smtp_use_ssl ?? settings?.smtp_use_ssl ?? false,
    smtp_password_configured: settingsDraft.smtp_password_configured ?? settings?.smtp_password_configured ?? false,
    enable_browser_notifications: settingsDraft.enable_browser_notifications ?? settings?.enable_browser_notifications ?? true,
    enable_collect_domestic: settingsDraft.enable_collect_domestic ?? settings?.enable_collect_domestic ?? true,
    enable_collect_global: settingsDraft.enable_collect_global ?? settings?.enable_collect_global ?? true,
    enable_collect_bok: settingsDraft.enable_collect_bok ?? settings?.enable_collect_bok ?? true,
    enable_ai_boost: settingsDraft.enable_ai_boost ?? settings?.enable_ai_boost ?? false,
    enable_ai_summary_postprocess: settingsDraft.enable_ai_summary_postprocess ?? settings?.enable_ai_summary_postprocess ?? false,
    enable_title_translation_postprocess: settingsDraft.enable_title_translation_postprocess ?? settings?.enable_title_translation_postprocess ?? false
  };

  const postprocessProgress =
    postprocessStatus && postprocessStatus.total > 0 ? Math.min(100, Math.round((postprocessStatus.processed / postprocessStatus.total) * 100)) : 0;
  const postprocessActive = runBodyPostprocess.isPending || runAiPostprocess.isPending || Boolean(postprocessStatus?.running);
  const recentIngestLogs = recentIngestLogsPage?.items ?? [];
  const collectionLogs = collectionLogsPage?.items ?? [];
  const collectionPageGroupStart = collectionLogsPage ? Math.floor((collectionLogsPage.page - 1) / 10) * 10 + 1 : 1;
  const collectionPageGroupEnd = collectionLogsPage ? Math.min(collectionPageGroupStart + 9, collectionLogsPage.total_pages) : 1;
  const visibleCollectionPages = collectionLogsPage
    ? Array.from({ length: collectionPageGroupEnd - collectionPageGroupStart + 1 }, (_, index) => collectionPageGroupStart + index)
    : [];
  const postprocessPageGroupStart = recentIngestLogsPage ? Math.floor((recentIngestLogsPage.page - 1) / 10) * 10 + 1 : 1;
  const postprocessPageGroupEnd = recentIngestLogsPage ? Math.min(postprocessPageGroupStart + 9, recentIngestLogsPage.total_pages) : 1;
  const visiblePostprocessPages = recentIngestLogsPage
    ? Array.from({ length: postprocessPageGroupEnd - postprocessPageGroupStart + 1 }, (_, index) => postprocessPageGroupStart + index)
    : [];
  const nextIngestAt = ingestSchedule?.next_run_at ? new Date(ingestSchedule.next_run_at).getTime() : null;
  const nextIngestRemainMs = nextIngestAt ? Math.max(0, nextIngestAt - clock) : null;
  const nextIngestRemainText = nextIngestRemainMs === null ? "계산 중" : formatDuration(nextIngestRemainMs);
  const aiBoostBlockedByGemini = draft.ai_provider === "gemini";
  const titleTranslationBlocked = !draft.enable_ai_boost || !draft.enable_collect_global;
  const aiProcessingAvailable =
    draft.ai_provider !== "disabled" &&
    !aiBoostBlockedByGemini &&
    (draft.enable_ai_summary_postprocess || (draft.enable_title_translation_postprocess && !titleTranslationBlocked));
  const bodyEnrichmentActive =
    runBodyPostprocess.isPending ||
    (postprocessStatus?.running &&
      (postprocessStatus.stage.includes("크롤링") || postprocessStatus.message.includes("본문 보강")));
  const activityLabel = ingest.isPending ? "수집" : bodyEnrichmentActive ? "본문 보강" : postprocessStatus?.running ? "AI 처리" : "대기";
  const activityActive = ingest.isPending || Boolean(postprocessStatus?.running);

  const setDraft = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
    updateSettings.mutate({ [key]: value } as Partial<Settings>);
  };

  const setSettingsPatch = (patch: Partial<Settings>) => {
    setSettingsDraft((current) => ({ ...current, ...patch }));
    updateSettings.mutate(patch);
  };

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const addEmailRecipient = () => {
    const value = emailRecipientDraft.trim();
    if (!value) return;
    const next = Array.from(new Set([...(draft.report_email_recipients || []), value]));
    setEmailRecipientDraft("");
    setSettingsPatch({ report_email_recipients: next });
  };

  const removeEmailRecipient = (recipient: string) => {
    setSettingsPatch({ report_email_recipients: (draft.report_email_recipients || []).filter((item) => item !== recipient) });
  };

  const toggleEmailFormat = (format: "md" | "html") => {
    const current = draft.report_email_formats || [];
    const next = current.includes(format) ? current.filter((item) => item !== format) : [...current, format];
    setSettingsPatch({ report_email_formats: next.length ? next : [format] });
  };

  const saveSmtpPassword = () => {
    const value = smtpPasswordDraft.trim().replace(/\s+/g, "");
    if (!value) return;
    setSmtpPasswordDraft("");
    setSettingsPatch({ smtp_password: value, smtp_password_configured: true } as Partial<Settings>);
  };

  const clearSmtpPassword = () => {
    setSmtpPasswordDraft("");
    setSettingsPatch({ smtp_password_clear: true, smtp_password_configured: false } as Partial<Settings>);
  };

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    createSource.mutate(newSource, {
      onSuccess: () => setNewSource({ name: "", url: "", region: "domestic", category: "economy", language: "ko", enabled: true })
    });
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
          ? "아직 선택하지 않음: 버튼을 누르면 브라우저 권한 창이 열립니다."
          : "이 브라우저는 알림 API를 지원하지 않습니다.";

  const selectedTab = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">AI, 수집, 알림, 뉴스 소스를 한 곳에서 관리합니다.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="grid min-h-[620px] lg:grid-cols-[260px_1fr]">
          <aside className="border-b border-border bg-muted/40 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">설정 메뉴</div>
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition",
                      active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
                    )}
                  >
                    <span className={cn("grid size-9 place-items-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{tab.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{tab.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="text-sm text-muted-foreground">설정 / {selectedTab.label}</div>
                <h2 className="mt-1 text-xl font-semibold">{selectedTab.label}</h2>
              </div>
              {updateSettings.isPending && <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">저장 중...</span>}
            </div>

            {activeTab === "ai" && (
              <div className="space-y-4">
                <Panel title="AI Provider" description="AI 분석을 켜면 선택한 provider와 모델로 기사 요약, 제목 번역, 기업 분석 메모를 생성합니다.">
                  <div className="rounded-md border border-border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">AI 기능</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          비활성화해도 뉴스 수집, 검색, 지표 API는 계속 동작합니다. AI가 필요한 영역에는 LLM 연동이 꺼져 있다는 안내를 표시합니다.
                        </p>
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
                            setSettingsPatch({ ai_provider: "disabled", enable_ai_boost: false, enable_title_translation_postprocess: false });
                          }
                        }}
                      >
                        {draft.ai_provider !== "disabled" && <Check size={15} />}
                        {draft.ai_provider !== "disabled" ? "켜짐" : "꺼짐"}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="rounded-md border border-border bg-card p-3">
                      <span className="mb-2 block text-sm font-semibold text-foreground">Provider</span>
                      <Select
                        className="w-full"
                        value={draft.ai_provider === "disabled" ? "ollama" : draft.ai_provider}
                        onChange={(event) => {
                          const nextProvider = event.target.value;
                          setSettingsPatch({
                            ai_provider: nextProvider,
                            ai_model: draft.ai_model || (nextProvider === "ollama" ? "gemma4" : ""),
                            ...(nextProvider === "gemini" ? { enable_ai_boost: false, enable_title_translation_postprocess: false } : {})
                          });
                        }}
                        disabled={draft.ai_provider === "disabled"}
                      >
                        <option value="ollama">ollama</option>
                        <option value="openai">openai</option>
                        <option value="gemini">gemini</option>
                      </Select>
                    </label>
                    <label className="rounded-md border border-border bg-card p-3">
                      <span className="mb-2 block text-sm font-semibold text-foreground">모델</span>
                      <Input
                        placeholder={draft.ai_provider === "ollama" || draft.ai_provider === "disabled" ? "gemma4" : "모델명"}
                        value={draft.ai_model}
                        onChange={(event) => setDraft("ai_model", event.target.value)}
                        disabled={draft.ai_provider === "disabled"}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">현재 provider: {draft.ai_provider}</span>
                    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">현재 모델: {draft.ai_model || (draft.ai_provider === "ollama" ? "gemma4" : "미설정")}</span>
                  </div>
                </Panel>

                <Panel title="AI Boost" description="기업 분석과 보고서 고급 인사이트처럼 토큰과 시간이 많이 드는 기능을 별도로 허용합니다.">
                  <ToggleTile
                    title="AI Boost"
                    description={
                      draft.ai_provider === "disabled"
                        ? "AI 기능이 꺼져 있어 Boost를 켤 수 없습니다."
                        : aiBoostBlockedByGemini
                          ? "Gemini 사용 중에는 AI Boost를 활성화할 수 없습니다. 관리자에게 문의 바랍니다."
                        : "기업 분석, 투자 관점 코멘트, 보고서 고급 인사이트 생성을 허용합니다."
                    }
                    active={draft.enable_ai_boost && !aiBoostBlockedByGemini}
                    disabled={draft.ai_provider === "disabled"}
                    onClick={() => {
                      if (draft.ai_provider === "disabled") return;
                      if (aiBoostBlockedByGemini) {
                        setAiBoostBlockedOpen(true);
                        return;
                      }
                      if (!draft.enable_ai_boost) {
                        setAiBoostConfirmOpen(true);
                        return;
                      }
                      setSettingsPatch({ enable_ai_boost: false, enable_title_translation_postprocess: false });
                    }}
                  />
                  <div className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    Boost가 꺼져 있으면 기업 분석, 보고서 고급 인사이트, 해외 제목 번역을 제한합니다. 기사 상세의 AI 분석 버튼은 건별 실행 기능이라 계속 사용할 수 있습니다.
                  </div>
                </Panel>

                <Panel title="AI 처리" description="AI 요약, 해외 제목 번역, 1시간 단위 AI 배치 작업을 관리합니다. 새 수집이 시작되면 AI 처리는 잠시 멈춘 뒤 다시 이어집니다.">
                  <div className="grid gap-3 md:grid-cols-2">
                    <ToggleTile
                      title="AI 요약"
                      description="요약이 없는 최근 기사만 순차 처리합니다."
                      active={draft.enable_ai_summary_postprocess}
                      onClick={() => setDraft("enable_ai_summary_postprocess", !draft.enable_ai_summary_postprocess)}
                    />
                    <ToggleTile
                      title="해외 제목 번역"
                      description={
                        !draft.enable_ai_boost
                          ? "AI Boost가 꺼져 있어 해외 제목 번역을 켤 수 없습니다."
                          : !draft.enable_collect_global
                            ? "해외 수집이 꺼져 있어 해외 제목 번역을 켤 수 없습니다."
                            : "해외 기사 중 번역 제목이 없는 항목만 처리합니다."
                      }
                      active={draft.enable_title_translation_postprocess && !titleTranslationBlocked}
                      disabled={titleTranslationBlocked}
                      onClick={() => {
                        if (titleTranslationBlocked) return;
                        setDraft("enable_title_translation_postprocess", !draft.enable_title_translation_postprocess);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setShowPostprocessLogs(true);
                        runAiPostprocess.mutate();
                      }}
                      disabled={Boolean(postprocessActive) || ingest.isPending || !aiProcessingAvailable}
                      title={
                        aiProcessingAvailable
                          ? "AI 요약 또는 해외 제목 번역을 실행합니다."
                          : draft.ai_provider === "disabled"
                            ? "AI provider가 disabled라 실행할 수 없습니다."
                            : aiBoostBlockedByGemini
                              ? "현재 Gemini 설정에서는 수동 AI 처리를 비활성화했습니다. 다른 모델 연동 시 사용할 수 있습니다."
                              : "AI 요약 또는 해외 제목 번역 기능을 켜야 실행할 수 있습니다."
                      }
                    >
                      <RefreshCw size={16} className={cn(postprocessActive && "animate-spin")} />
                      {postprocessActive ? "AI 처리 진행 중" : "AI 처리 실행"}
                    </Button>
                    <GhostButton
                      type="button"
                      onClick={() => {
                        setShowPostprocessLogs((current) => !current);
                        setPostprocessLogPage(1);
                        queryClient.invalidateQueries({ queryKey: ["ingestLogs"] });
                      }}
                    >
                      <ListChecks size={16} /> AI 처리 로그
                    </GhostButton>
                  </div>

                  {showPostprocessLogs && (
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="mb-2 text-sm font-semibold">AI 처리 로그</div>
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
                        {recentIngestLogs.length === 0 && <div className="text-muted-foreground">최근 12시간 AI 처리 로그가 없습니다.</div>}
                        {recentIngestLogs.map((log) => (
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
                        {recentIngestLogsPage && recentIngestLogsPage.total_pages > 1 && (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                            <div className="text-muted-foreground">
                              최근 {recentIngestLogsPage.hours}시간 로그 {recentIngestLogsPage.total}건 · {recentIngestLogsPage.page}/{recentIngestLogsPage.total_pages}페이지
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setPostprocessLogPage(Math.max(1, postprocessPageGroupStart - 10));
                                  setSelectedPostprocessLogId(null);
                                }}
                                disabled={postprocessPageGroupStart <= 1}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="이전 로그 페이지 묶음"
                              >
                                <ChevronLeft size={15} />
                              </button>
                              {visiblePostprocessPages.map((page) => (
                                <button
                                  key={page}
                                  type="button"
                                  onClick={() => {
                                    setPostprocessLogPage(page);
                                    setSelectedPostprocessLogId(null);
                                  }}
                                  className={cn(
                                    "h-8 min-w-8 rounded-md border px-2 text-xs font-semibold transition",
                                    page === recentIngestLogsPage.page
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                                  )}
                                >
                                  {page}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  setPostprocessLogPage(Math.min(recentIngestLogsPage.total_pages, postprocessPageGroupEnd + 1));
                                  setSelectedPostprocessLogId(null);
                                }}
                                disabled={postprocessPageGroupEnd >= recentIngestLogsPage.total_pages}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="다음 로그 페이지 묶음"
                              >
                                <ChevronRight size={15} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {activeTab === "ingest" && (
              <div className="space-y-4">
                <Panel title="수집 항목" description="국내에는 한국은행, 증시, 금리·채권, 환율, 부동산·가계부채 등 국내 세부 RSS가 함께 포함됩니다. 기존 저장 기사는 삭제하지 않습니다.">
                  <div className="grid gap-3 md:grid-cols-2">
                    <ToggleTile
                      title="국내"
                      description="국내 경제, 한국은행, 증시, 금리·채권, 환율 등 국내 소스를 수집합니다."
                      active={draft.enable_collect_domestic}
                      onClick={() => {
                        const nextEnabled = !draft.enable_collect_domestic;
                        setSettingsPatch({
                          enable_collect_domestic: nextEnabled,
                          enable_collect_bok: nextEnabled
                        });
                      }}
                    />
                    <ToggleTile
                      title="해외"
                      description="해외 경제 뉴스 소스를 수집하고 후처리합니다."
                      active={draft.enable_collect_global}
                      onClick={() => {
                        const nextEnabled = !draft.enable_collect_global;
                        setSettingsPatch({
                          enable_collect_global: nextEnabled,
                          enable_title_translation_postprocess: nextEnabled && draft.enable_ai_boost
                        });
                      }}
                    />
                  </div>
                </Panel>

                <Panel title="수집과 알림" description="RSS 수집을 수동 실행하고 브라우저 알림 권한을 관리합니다.">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => ingest.mutate()} disabled={ingest.isPending}>
                        <Database size={16} /> 지금 수집
                      </Button>
                      <Button onClick={() => runBodyPostprocess.mutate()} disabled={Boolean(postprocessActive) || ingest.isPending}>
                        <RefreshCw size={16} className={cn(postprocessActive && bodyEnrichmentActive && "animate-spin")} />
                        {bodyEnrichmentActive ? "본문 보강 중" : "본문 보강(수동)"}
                      </Button>
                      <GhostButton onClick={askNotification}>
                        <Bell size={16} /> 브라우저 알림 권한
                      </GhostButton>
                    </div>
                    <GhostButton
                      onClick={() => {
                        setShowCollectionLogs((current) => !current);
                        setCollectionLogPage(1);
                        queryClient.invalidateQueries({ queryKey: ["ingestLogs", "collection"] });
                      }}
                      title={showCollectionLogs ? "후처리 작업 로그 숨기기" : "후처리 작업 로그 보기"}
                      aria-label={showCollectionLogs ? "후처리 작업 로그 숨기기" : "후처리 작업 로그 보기"}
                    >
                      <ListChecks size={16} />
                    </GhostButton>
                  </div>

                  {(ingest.isPending || ingestLogs.length > 0) && (
                    <div className="rounded-md border border-border bg-card p-3">
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

                  {showCollectionLogs && (
                    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">후처리 작업 로그</div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            본문 보강과 수집 보조 작업 로그를 최근 12시간 기준으로 확인합니다.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition",
                              activityActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/60 text-muted-foreground"
                            )}
                            title={postprocessStatus?.message || "현재 작업 상태"}
                          >
                            <RefreshCw size={15} className={cn(activityActive && "animate-spin")} />
                            {activityLabel}
                          </button>
                          <GhostButton onClick={() => setShowCollectionLogs(false)} aria-label="후처리 작업 로그 닫기">
                            <X size={16} /> 닫기
                          </GhostButton>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-md border border-border bg-muted/40 p-3">
                          <div className="text-xs text-muted-foreground">최근 12시간 작업 로그</div>
                          <div className="mt-1 text-2xl font-bold">{collectionLogsPage?.total ?? 0}</div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 p-3">
                          <div className="text-xs text-muted-foreground">표시 중 반영</div>
                          <div className="mt-1 text-2xl font-bold">{collectionLogs.reduce((sum, log) => sum + log.new_count, 0)}</div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 p-3">
                          <div className="text-xs text-muted-foreground">현재 상태</div>
                          <div className="mt-1 text-lg font-semibold">{postprocessStatus?.running ? postprocessStatus.stage || "작업 중" : "대기"}</div>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-md border border-border">
                        <div className="grid grid-cols-[120px_1fr_96px_96px_90px] gap-2 border-b border-border bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                          <div>시간</div>
                          <div>소스</div>
                          <div className="text-right">가져옴</div>
                          <div className="text-right">신규</div>
                          <div className="text-center">상태</div>
                        </div>
                        {collectionLogs.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">최근 12시간 후처리 작업 로그가 없습니다.</div>}
                        {collectionLogs.map((log) => (
                          <div key={log.id} className="grid grid-cols-[120px_1fr_96px_96px_90px] items-center gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-b-0">
                            <div className="text-muted-foreground">{formatDate(log.created_at)}</div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{log.source_name}</div>
                              {log.message && <div className="truncate text-muted-foreground" title={log.message}>{log.message}</div>}
                            </div>
                            <div className="text-right font-semibold">{log.fetched_count.toLocaleString()}건</div>
                            <div className={cn("text-right font-semibold", log.new_count > 0 ? "text-primary" : "text-muted-foreground")}>{log.new_count.toLocaleString()}건</div>
                            <div className="text-center">
                              <span className={cn("rounded-md px-2 py-1 font-semibold", statusClass(log.status))}>{statusLabel(log.status)}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {collectionLogsPage && collectionLogsPage.total_pages > 1 && (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-border p-1.5 disabled:opacity-40"
                            onClick={() => setCollectionLogPage(Math.max(1, collectionPageGroupStart - 10))}
                            disabled={collectionPageGroupStart <= 1}
                          >
                            <ChevronLeft size={15} />
                          </button>
                          {visibleCollectionPages.map((page) => (
                            <button
                              type="button"
                              key={page}
                              onClick={() => setCollectionLogPage(page)}
                              className={cn(
                                "min-w-8 rounded-md border px-2 py-1 text-xs font-semibold",
                                collectionLogsPage.page === page ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                              )}
                            >
                              {page}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="rounded-md border border-border p-1.5 disabled:opacity-40"
                            onClick={() => setCollectionLogPage(Math.min(collectionLogsPage.total_pages, collectionPageGroupEnd + 1))}
                            disabled={collectionPageGroupEnd >= collectionLogsPage.total_pages}
                          >
                            <ChevronRight size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
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
                        {notificationPermission === "granted" ? "허용" : notificationPermission === "denied" ? "차단" : notificationPermission === "default" ? "미선택" : "미지원"}
                      </span>
                    </div>
                    <p className="mt-1">{notificationText}</p>
                    {notificationPermission === "denied" && (
                      <div className="mt-3 space-y-2 rounded-md border border-border bg-card p-3 text-xs leading-5">
                        <div className="font-semibold text-foreground">차단 해제 방법</div>
                        <p>Chrome: 주소창 왼쪽 사이트 정보 아이콘 클릭 → 사이트 설정 → 알림 → 허용으로 변경 → 이 페이지 새로고침</p>
                        <p>Edge: 주소창 왼쪽 자물쇠/사이트 정보 아이콘 클릭 → 이 사이트에 대한 사용 권한 → 알림 → 허용으로 변경 → 이 페이지 새로고침</p>
                      </div>
                    )}
                  </div>
                </Panel>

                <Panel title="자동 수집과 보관" description="수집 주기, 기사 보관 기간, 보고서 확정 시간을 설정합니다.">
                  <div className="grid gap-4 md:grid-cols-2">
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
                    </label>
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
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-sm font-medium">보고서 마감 시간</span>
                      <Input type="time" value={draft.report_final_time} onChange={(event) => setDraft("report_final_time", event.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        매일 이 시간에 확정 보고서를 저장하고, 해당 일자 00:00부터 마감 시간까지 수집된 기사만 최종본에 반영합니다.
                      </p>
                    </label>
                  </div>
                </Panel>

              </div>
            )}

            {activeTab === "email" && (
              <div className="space-y-4">
                <Panel title="보고서 이메일 발송" description="가장 최근의 확정 보고서를 지정한 시간에 이메일 첨부파일로 발송합니다. 보고서 마감 전 발송 시간이라면 전날 확정본이 발송됩니다.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ToggleTile
                      title="자동 이메일 발송"
                      description="켜두면 매일 지정한 시간에 최신 확정 보고서를 보냅니다."
                      active={draft.report_email_enabled}
                      onClick={() => setDraft("report_email_enabled", !draft.report_email_enabled)}
                    />
                    <label className="rounded-md border border-border bg-card p-3">
                      <span className="mb-2 block text-sm font-semibold text-foreground">발송 시간</span>
                      <Input type="time" value={draft.report_email_time} onChange={(event) => setDraft("report_email_time", event.target.value)} />
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        예: 보고서 마감이 18:00이고 메일 발송이 17:00이면, 가장 최근 확정본인 전일 보고서를 보냅니다.
                      </p>
                    </label>
                  </div>
                </Panel>

                <Panel title="받는 사람" description="여러 명에게 보낼 수 있습니다. + 버튼으로 주소를 추가하고 필요 없는 주소는 삭제하세요.">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_104px]">
                    <Input
                      type="email"
                      className="min-w-0"
                      placeholder="recipient@example.com"
                      value={emailRecipientDraft}
                      onChange={(event) => setEmailRecipientDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addEmailRecipient();
                        }
                      }}
                    />
                    <Button type="button" onClick={addEmailRecipient} className="h-9 w-full shrink-0 whitespace-nowrap px-4">
                      <Plus size={16} /> 추가
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {draft.report_email_recipients.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">아직 등록된 이메일 주소가 없습니다.</div>
                    ) : (
                      draft.report_email_recipients.map((recipient) => (
                        <span key={recipient} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-sm">
                          {recipient}
                          <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => removeEmailRecipient(recipient)} aria-label={`${recipient} 삭제`}>
                            <X size={13} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel title="SMTP 서버 설정" description="발신 메일 서버 정보를 저장합니다. 비밀번호는 암호화되어 저장되며 화면에 다시 표시되지 않습니다.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-sm font-medium">SMTP Host</span>
                      <Input placeholder="smtp.gmail.com" value={draft.smtp_host} onChange={(event) => setDraft("smtp_host", event.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Port</span>
                      <Input type="number" min={1} value={draft.smtp_port} onChange={(event) => setDraft("smtp_port", Number(event.target.value))} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">Username</span>
                      <Input placeholder="sender@gmail.com" value={draft.smtp_username} onChange={(event) => setDraft("smtp_username", event.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm font-medium">From Email</span>
                      <Input placeholder="sender@gmail.com" value={draft.smtp_from_email} onChange={(event) => setDraft("smtp_from_email", event.target.value)} />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-sm font-medium">From Name</span>
                      <Input value={draft.smtp_from_name} onChange={(event) => setDraft("smtp_from_name", event.target.value)} />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ToggleTile
                      title="TLS 사용"
                      description="Gmail 587 포트는 TLS 사용이 일반적입니다."
                      active={draft.smtp_use_tls}
                      onClick={() => setSettingsPatch({ smtp_use_tls: !draft.smtp_use_tls, smtp_use_ssl: draft.smtp_use_tls ? draft.smtp_use_ssl : false })}
                    />
                    <ToggleTile
                      title="SSL 사용"
                      description="465 포트는 SSL 사용이 일반적입니다. TLS와 동시에 켜지지 않게 관리하세요."
                      active={draft.smtp_use_ssl}
                      onClick={() => setSettingsPatch({ smtp_use_ssl: !draft.smtp_use_ssl, smtp_use_tls: draft.smtp_use_ssl ? draft.smtp_use_tls : false })}
                    />
                  </div>
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">SMTP Password</div>
                        <div className="text-xs text-muted-foreground">
                          {draft.smtp_password_configured ? "비밀번호가 저장되어 있습니다. 새 값을 입력하면 교체됩니다." : "아직 비밀번호가 저장되지 않았습니다."}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-semibold",
                          draft.smtp_password_configured ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {draft.smtp_password_configured ? "저장됨" : "미설정"}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_104px_104px]">
                      <Input
                        type="password"
                        placeholder="앱 비밀번호 입력"
                        value={smtpPasswordDraft}
                        onChange={(event) => setSmtpPasswordDraft(event.target.value)}
                      />
                      <Button type="button" className="w-full whitespace-nowrap" onClick={saveSmtpPassword} disabled={!smtpPasswordDraft.trim()}>
                        저장
                      </Button>
                      <GhostButton type="button" className="w-full whitespace-nowrap" onClick={clearSmtpPassword} disabled={!draft.smtp_password_configured}>
                        초기화
                      </GhostButton>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Gmail 앱 비밀번호는 공백을 제거한 16자리로 저장합니다. 저장 후에는 값이 다시 표시되지 않습니다.
                    </p>
                  </div>
                </Panel>

                <Panel title="첨부 형식과 테스트 발송" description="백엔드는 저장된 Markdown 보고서를 기준으로 Markdown/HTML 파일을 첨부합니다. PDF는 브라우저 화면에서 별도로 저장할 수 있습니다.">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleEmailFormat("md")}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                        draft.report_email_formats.includes("md") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {draft.report_email_formats.includes("md") && <Check size={15} />} Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleEmailFormat("html")}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                        draft.report_email_formats.includes("html") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {draft.report_email_formats.includes("html") && <Check size={15} />} HTML
                    </button>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                    SMTP 설정은 위 서버 설정 값이 우선 적용됩니다. 입력하지 않은 값은 `.env`의 기본값을 사용합니다.
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" onClick={() => sendLatestReportEmail.mutate()} disabled={sendLatestReportEmail.isPending || draft.report_email_recipients.length === 0}>
                      <Send size={16} /> 최신 확정 보고서 보내기
                    </Button>
                    {emailSendMessage && (
                      <span className={cn("rounded-md px-3 py-2 text-sm", sendLatestReportEmail.isError ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-muted text-muted-foreground")}>
                        {emailSendMessage}
                      </span>
                    )}
                  </div>
                </Panel>
              </div>
            )}

            {activeTab === "sources" && (
              <Panel title="뉴스 소스 관리" description="RSS/Atom 기반 뉴스 소스를 추가하거나 삭제합니다.">
                <form onSubmit={submitSource} className="grid gap-2 md:grid-cols-[1fr_2fr_120px_120px_auto]">
                  <Input placeholder="이름" value={newSource.name} onChange={(event) => setNewSource((source) => ({ ...source, name: event.target.value }))} required />
                  <Input placeholder="RSS/Atom URL" value={newSource.url} onChange={(event) => setNewSource((source) => ({ ...source, url: event.target.value }))} required />
                  <Select value={newSource.region} onChange={(event) => setNewSource((source) => ({ ...source, region: event.target.value }))}>
                    <option value="domestic">국내</option>
                    <option value="global">해외</option>
                  </Select>
                  <Input placeholder="category tag" value={newSource.category} onChange={(event) => setNewSource((source) => ({ ...source, category: event.target.value }))} />
                  <Button type="submit" disabled={createSource.isPending}>
                    <Plus size={16} /> 추가
                  </Button>
                </form>
                <div className="space-y-2">
                  {sources.map((source) => {
                    const display = sourceDisplayParts(source.name);
                    return (
                      <div key={source.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm md:grid-cols-[minmax(150px,1.1fr)_minmax(0,2fr)_72px_170px_88px_40px]">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{display.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{display.provider}</div>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1 truncate text-muted-foreground" title={source.url}>
                            {source.url}
                          </div>
                          <GhostButton
                            className="h-8 shrink-0 px-2"
                            onClick={() => copyToClipboard(source.url)}
                            aria-label={`${display.title} URL 복사`}
                            title="URL 복사"
                          >
                            <Copy size={14} />
                          </GhostButton>
                        </div>
                        <div>{source.region === "domestic" ? "국내" : source.region === "global" ? "해외" : source.region}</div>
                        <div className="w-full break-words rounded-md bg-muted px-2 py-1 font-mono text-xs leading-5 text-muted-foreground">{source.category}</div>
                        <button
                          type="button"
                          onClick={() => updateSource.mutate({ id: source.id, patch: { enabled: !source.enabled } })}
                          disabled={updateSource.isPending}
                          className={cn(
                            "inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                            source.enabled
                              ? "border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                              : "border-border bg-muted text-muted-foreground hover:bg-card"
                          )}
                          aria-label={`${display.title} ${source.enabled ? "비활성화" : "활성화"}`}
                        >
                          {source.enabled ? "활성" : "비활성"}
                        </button>
                        <GhostButton onClick={() => deleteSource.mutate(source.id)} aria-label={`${source.name} 삭제`}>
                          <Trash2 size={15} />
                        </GhostButton>
                      </div>
                    );
                  })}
                  {sources.length === 0 && <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">등록된 뉴스 소스가 없습니다.</div>}
                </div>
              </Panel>
            )}
          </main>
        </div>
      </Card>

      {aiBoostConfirmOpen && (
        <AIBoostConfirmModal
          provider={draft.ai_provider}
          model={draft.ai_model || (draft.ai_provider === "ollama" ? "gemma4" : "미설정")}
          onCancel={() => setAiBoostConfirmOpen(false)}
          onConfirm={() => {
            setAiBoostConfirmOpen(false);
            setSettingsPatch({ enable_ai_boost: true, enable_title_translation_postprocess: draft.enable_collect_global });
          }}
        />
      )}
      {aiBoostBlockedOpen && <AIBoostBlockedModal onClose={() => setAiBoostBlockedOpen(false)} />}
    </div>
  );
}

function AIBoostBlockedModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ai-boost-blocked-title">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div>
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
              <AlertTriangle size={22} />
            </div>
            <h3 id="ai-boost-blocked-title" className="text-xl font-semibold tracking-tight">
              AI Boost를 활성화할 수 없습니다
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Gemini 사용 중에는 AI Boost를 켤 수 없습니다. 관리자에게 문의 바랍니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        <div className="border-t border-border bg-muted/40 px-6 py-4">
          <Button type="button" onClick={onClose} className="w-full">
            확인
          </Button>
        </div>
      </div>
    </div>
  );
}

function AIBoostConfirmModal({ provider, model, onCancel, onConfirm }: { provider: string; model: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ai-boost-title">
      <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div>
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck size={22} />
            </div>
            <h3 id="ai-boost-title" className="text-2xl font-semibold tracking-tight">
              AI Boost 활성화
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              기업 분석과 보고서 고급 인사이트처럼 자원을 많이 쓰는 기능을 켭니다. 유료 API를 연결한 경우 호출량에 따라 비용이 발생할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} />
              비용 및 자원 사용 안내
            </div>
            <p>
              OpenAI, Gemini 같은 유료 API를 사용하면 토큰 사용량에 따라 비용이 발생할 수 있습니다. Ollama 같은 로컬 LLM은 API 비용은 없지만 PC 자원을 더 사용할 수 있습니다.
            </p>
          </div>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl border border-border p-4">
              <div className="text-xs font-medium text-muted-foreground">현재 Provider</div>
              <div className="mt-1 font-semibold">{provider}</div>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <div className="text-xs font-medium text-muted-foreground">현재 모델</div>
              <div className="mt-1 font-semibold">{model}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center border-t border-border bg-muted/40 px-6 py-4">
          <Button type="button" onClick={onConfirm} className="min-w-40">
            <Check size={16} />
            활성화
          </Button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ToggleTile({ title, description, active, disabled = false, onClick }: { title: string; description: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55",
        active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card text-muted-foreground hover:bg-muted"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold", active ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {active && <Check size={13} />} {active ? "켜짐" : "꺼짐"}
        </span>
      </div>
      <div className={cn("mt-2 text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{description}</div>
    </button>
  );
}

function statusLabel(status: string) {
  if (status === "ok" || status === "postprocess_ok") return "성공";
  if (status === "postprocess_paused") return "일시중단";
  if (status === "postprocess_skipped") return "건너뜀";
  if (status.includes("error")) return "오류";
  return status;
}

function statusClass(status: string) {
  if (status === "ok" || status === "postprocess_ok") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "postprocess_paused") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
  if (status === "postprocess_skipped") return "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200";
  if (status.includes("error")) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
  return "bg-muted text-muted-foreground";
}

function sourceDisplayParts(name: string) {
  const aliases: Record<string, string> = {
    "Google News KR Economy": "Google 뉴스(국내 경제)",
    "Google News BOK": "Google 뉴스(한국은행)",
    "Google News KR Markets": "Google 뉴스(증시)",
    "Google News KR Rates Bonds": "Google 뉴스(채권)",
    "Google News KR FX": "Google 뉴스(환율)",
    "Google News KR Real Estate Debt": "Google 뉴스(부동산·가계부채)",
    "Google News KR Industry Export": "Google 뉴스(산업·수출)",
    "Google News KR Banking Finance": "Google 뉴스(금융·은행)",
    "Google News KR Inflation Consumption": "Google 뉴스(물가·소비)",
    "Google News Global Economy": "Google 뉴스(해외 경제)",
    "Google News US Business": "Google 뉴스(미국 비즈니스)",
    "Google News Global Markets": "Google 뉴스(해외 시장)",
    "Google News Central Banks": "Google 뉴스(중앙은행)",
    "Google News Inflation FX": "Google 뉴스(해외 물가·환율)",
    "Yahoo Finance News": "Yahoo Finance(시장 뉴스)"
  };
  const normalized = aliases[name] || name;
  const match = normalized.match(/^(.+?)\((.+)\)$/);
  if (!match) return { title: normalized, provider: "RSS/Atom" };
  const provider = match[1].trim().replace("Google 뉴스", "Google News");
  return { title: match[2].trim(), provider };
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}초`;
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}
