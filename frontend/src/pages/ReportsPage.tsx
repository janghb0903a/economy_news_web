import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  BadgeDollarSign,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileDown,
  FileText,
  Globe2,
  Home,
  Landmark,
  Newspaper,
  RefreshCw,
  Star,
  StickyNote,
  TrendingUp,
  TriangleAlert
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card } from "../components/ui";
import { cn, formatDate, percent } from "../lib/utils";
import type { Report, ReportArticle } from "../lib/types";

type ReportSection = {
  label: string;
  count: number;
  topics?: string[];
  overview: string;
  articles: ReportArticle[];
};

type MarketChecklistItem = {
  label: string;
  detail: string;
};

type SignalItem = {
  label: string;
  headline: string;
  tone: "negative" | "positive" | "watch" | "neutral";
  strength: number;
  keywords: string[];
  detail: string;
};

type ReportSummary = {
  overview?: string;
  keywords?: { name: string; count: number }[];
  domestic?: ReportSection;
  global?: ReportSection;
  bok?: ReportSection;
  sections?: Record<string, ReportSection>;
  important?: ReportArticle[];
  bok_important?: ReportArticle[];
  market_checklist?: MarketChecklistItem[];
  signal_board?: SignalItem[];
  report_ai_notice?: string;
  report_ai_bullets?: string[];
};

type ReportExportFormat = "pdf" | "md";

type MarkdownBlock = {
  type: "h1" | "h2" | "h3" | "h4" | "li" | "p" | "blank";
  text: string;
};

const sectionIcons: Record<string, typeof BarChart3> = {
  markets: BarChart3,
  rates_bonds: BadgeDollarSign,
  fx: Globe2,
  real_estate_debt: Home,
  industry_export: Newspaper,
  banking_finance: Landmark,
  inflation_consumption: Star
};

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string | null>(() => searchParams.get("date"));
  const [generatedDraft, setGeneratedDraft] = useState<Report | null>(null);
  const [bokPriority, setBokPriority] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingHtml, setIsExportingHtml] = useState(false);
  const reportCaptureRef = useRef<HTMLDivElement | null>(null);
  const pdfPagesRef = useRef<HTMLDivElement | null>(null);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: todayReport, isLoading } = useQuery({ queryKey: ["todayReport"], queryFn: api.todayReport });
  const { data: reports = [] } = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  const { data: selectedReport } = useQuery({
    queryKey: ["finalReport", selectedDate],
    queryFn: () => api.finalReport(selectedDate as string),
    enabled: Boolean(selectedDate)
  });
  useEffect(() => {
    const dateFromUrl = searchParams.get("date");
    setSelectedDate(dateFromUrl);
    if (dateFromUrl) setGeneratedDraft(null);
  }, [searchParams]);
  const generate = useMutation({
    mutationFn: api.generateReport,
    onSuccess: (report) => {
      setGeneratedDraft(report);
      queryClient.invalidateQueries({ queryKey: ["todayReport"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setSelectedDate(null);
    }
  });
  const report = selectedReport || generatedDraft || todayReport;
  const summary = (report?.summary || {}) as ReportSummary;
  const sections = Object.entries(summary.sections || {}).filter(([, section]) => section.count > 0);
  const topArticles = bokPriority ? summary.bok_important || [] : summary.important || [];
  const importantArticles = summary.important || [];
  const bokImportantArticles = summary.bok_important || [];
  const isExporting = isExportingPdf || isExportingHtml;
  const isSavedReportView = Boolean(selectedDate && selectedReport);
  const aiBoostLimited = (settings?.ai_provider || "disabled") !== "disabled" && !settings?.enable_ai_boost;
  const realtimeBoostLimited = aiBoostLimited && report?.status !== "final";
  const finalAiApplied = report?.status === "final" && report.model_provider !== "rule_based";
  const reportViewLabel = isSavedReportView ? "저장 보고서" : report?.status === "final" ? "오늘 확정 저장본" : "실시간 보고서";

  const openRealtimeReport = () => {
    setSelectedDate(null);
    setGeneratedDraft(null);
    setSearchParams({});
  };

  const openSavedReport = (date: string) => {
    setGeneratedDraft(null);
    setSelectedDate(date);
    setSearchParams({ date });
  };

  const saveReport = async (format: ReportExportFormat) => {
    const currentReport = report;
    if (!currentReport || isExporting) return;
    const currentSummary = (currentReport.summary || {}) as ReportSummary;
    const markdown = generateMarkdownReport({
      report: currentReport,
      summary: currentSummary,
      sections: Object.entries(currentSummary.sections || {}),
      important: currentSummary.important || [],
      bokImportant: currentSummary.bok_important || []
    });

    if (format === "md") {
      downloadTextFile(
        `economy-daily-brief-${currentReport.report_date}.md`,
        `\uFEFF${markdown}`,
        "text/markdown;charset=utf-8"
      );
      return;
    }

    setIsExportingPdf(true);
    await waitForExportRender();
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pages = Array.from(pdfPagesRef.current?.querySelectorAll<HTMLElement>(".pdf-page") || []);
      for (const [pageIndex, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          backgroundColor: "#f8fafc",
          scale: 2,
          useCORS: true,
          windowWidth: page.scrollWidth,
          windowHeight: page.scrollHeight
        });
        if (pageIndex > 0) {
          pdf.addPage();
        }
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, pageHeight);
      }
      pdf.save(`${currentReport.report_date}-economy-report.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const saveHtml = async () => {
    const currentReport = report;
    if (!currentReport || !reportCaptureRef.current || isExporting) return;
    setIsExportingHtml(true);
    await waitForExportRender();
    try {
      const clone = reportCaptureRef.current.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".no-print").forEach((element) => element.remove());
      const html = buildStandaloneHtml(`${currentReport.report_date} 경제 뉴스 보고서`, clone.outerHTML);
      downloadTextFile(`${currentReport.report_date}-economy-report.html`, html, "text/html;charset=utf-8");
    } finally {
      setIsExportingHtml(false);
    }
  };

  if (isLoading || !report) return <div className="p-6 text-muted-foreground">보고서를 불러오는 중...</div>;

  return (
    <>
    <div ref={reportCaptureRef} className={cn("grid gap-4 xl:grid-cols-[1fr_320px]", isExporting && "pdf-capture-mode")}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">경제 뉴스 보고서</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSavedReportView ? `${selectedDate}에 저장된 확정 보고서를 보고 있습니다.` : "오늘의 경제 흐름을 인사이트 중심으로 정리합니다."}
            </p>
          </div>
          <div className="no-print flex gap-2">
            <button
              type="button"
              onClick={() => saveReport("pdf")}
              disabled={isExporting}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition hover:bg-muted"
            >
              <FileDown size={16} />
              {isExportingPdf ? "PDF 생성 중" : "PDF 저장"}
            </button>
            <button
              type="button"
              onClick={() => saveReport("md")}
              disabled={isExporting}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition hover:bg-muted"
            >
              <FileText size={16} />
              MD 저장
            </button>
            <button
              type="button"
              onClick={saveHtml}
              disabled={isExporting}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition hover:bg-muted"
            >
              <FileText size={16} />
              {isExportingHtml ? "HTML 생성 중" : "HTML 저장"}
            </button>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              <RefreshCw size={16} className={cn(generate.isPending && "animate-spin")} />
              {generate.isPending ? "갱신 중" : "오늘 보고서 갱신"}
            </Button>
          </div>
        </div>

        {realtimeBoostLimited && (
          <Card className="border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            AI Boost 기능 비활성화로 실시간 보고서 갱신은 규칙 기반으로 표시합니다. 최종 저장본 생성 시점에는 보고서 대표 인사이트에 한해 AI를 1회 사용할 수 있습니다.
          </Card>
        )}
        {finalAiApplied && (
          <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            {summary.report_ai_notice || "최종 저장본에 AI 기반 대표 인사이트가 반영되었습니다."}
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/50 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <FileText size={17} /> {reportViewLabel}
                </div>
                <h2 className="mt-1 text-2xl font-semibold">{report.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  생성 {formatDate(report.generated_at)}
                  {report.finalized_at ? ` · 확정 ${formatDate(report.finalized_at)}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  report.status === "final" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                )}
              >
                {report.status === "final" ? "확정본" : "초안"}
              </span>
            </div>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-5">
            <Metric label="대상 기사" value={report.article_count} />
            <Metric label="국내" value={report.domestic_count} />
            <Metric label="해외" value={report.global_count} />
            <Metric label="한국은행" value={report.bok_count} />
            <Metric label="중요" value={report.important_count} />
          </div>
        </Card>

        <Card className="border-primary/25 bg-primary/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <TrendingUp size={17} />
            </span>
            <div>
              <h2 className="text-xl font-semibold">한눈에 보기</h2>
              <p className="text-xs text-muted-foreground">기사 개수보다 오늘 시장이 어디를 보고 있는지 먼저 읽습니다.</p>
            </div>
          </div>
          <p className="text-base leading-7 text-foreground">{summary.overview || fallbackOverview()}</p>
          {summary.keywords && summary.keywords.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {summary.keywords.slice(0, 8).map((keyword) => (
                <span key={keyword.name} className="rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                  #{keyword.name}
                </span>
              ))}
            </div>
          )}
        </Card>

        <SignalBoard signals={summary.signal_board || []} />

        <div className="grid gap-4 lg:grid-cols-3">
          {summary.domestic && <InsightCard title="국내 경제" icon={Home} section={summary.domestic} tone="primary" />}
          {summary.global && <InsightCard title="해외 경제" icon={Globe2} section={summary.global} tone="blue" />}
          {summary.bok && <InsightCard title="한국은행" icon={Landmark} section={summary.bok} tone="green" />}
        </div>

        <section className={cn("space-y-3", isExporting && "hidden")}>
          <SectionHeader title="분야별 브리핑" subtitle="증시, 금리, 환율, 부동산, 수출처럼 실제 시장 변수별로 읽습니다." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sections.map(([key, section]) => {
              const Icon = sectionIcons[key] || BarChart3;
              return <TopicCard key={key} icon={Icon} section={section} />;
            })}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader title="시장 영향 메모" subtitle="오늘 체크해야 할 변수를 하나의 메모처럼 모았습니다." />
          <ChecklistMemo items={summary.market_checklist || []} />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeader
              title="오늘 봐야 할 기사"
              subtitle={bokPriority ? "한국은행 관련도와 경제 영향도를 함께 반영한 TOP 10입니다." : "한국 경제 전반에 미칠 영향도를 기준으로 뽑은 TOP 10입니다."}
            />
            <button
              type="button"
              onClick={() => setBokPriority((value) => !value)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                bokPriority
                  ? "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              <Landmark size={16} />
              한국은행
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {topArticles.length === 0 && <Card className="p-4 text-sm text-muted-foreground">조건에 맞는 주요 기사가 아직 없습니다.</Card>}
            {topArticles.slice(0, 10).map((article, index) => (
              <FeatureArticle key={`${article.id}-${index}`} article={article} rank={index + 1} />
            ))}
          </div>
        </section>

        {isExporting && <PdfTopArticles important={importantArticles} bokImportant={bokImportantArticles} />}
      </section>

      <aside className="no-print space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <CalendarDays size={18} /> 저장 보고서
          </h2>
          <p className="mb-3 text-xs leading-5 text-muted-foreground">
            저장 보고서를 누르면 해당 날짜의 확정본이 이 화면에 열립니다. 열린 보고서는 위 버튼으로 PDF, MD, HTML 저장이 가능합니다.
          </p>
          <div className="space-y-2">
            <button
              className={cn("w-full rounded-md p-2 text-left text-sm", selectedDate === null ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-primary/10")}
              onClick={openRealtimeReport}
            >
              <div className="font-medium">오늘 실시간 보고서</div>
              <div className={cn("text-xs", selectedDate === null ? "text-primary-foreground/80" : "text-muted-foreground")}>
                지금까지 수집된 기사 기준
              </div>
            </button>
            {reports.length === 0 && <div className="text-sm text-muted-foreground">아직 저장된 확정 보고서가 없습니다.</div>}
            {reports.map((item) => (
              <button
                key={item.id}
                className={cn("w-full rounded-md p-2 text-left text-sm", selectedDate === item.report_date ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-primary/10")}
                onClick={() => openSavedReport(item.report_date)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.report_date}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px]", selectedDate === item.report_date ? "bg-primary-foreground/15" : "bg-background")}>보기</span>
                </div>
                <div className={cn("text-xs", selectedDate === item.report_date ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  기사 {item.article_count}건 · BOK {item.bok_count}건
                </div>
                <div className={cn("text-xs", selectedDate === item.report_date ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  저장 {formatDate(item.finalized_at || item.generated_at)}
                </div>
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">운영 방식</div>
          <p className="mt-2 leading-6">
            보고서 갱신은 현재까지 수집된 기사로 초안을 만듭니다. 매일 18:00 KST에는 확정본이 자동 저장되고, 이후 수집된 기사는 그날 확정본에 반영하지 않습니다.
          </p>
        </Card>
      </aside>
    </div>
    {isExportingPdf && (
      <div ref={pdfPagesRef} className="pdf-export-root" aria-hidden>
        <MarkdownPdfDocument
          markdown={generateMarkdownReport({
            report,
            summary,
            sections,
            important: importantArticles,
            bokImportant: bokImportantArticles
          })}
        />
      </div>
    )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function MarkdownPdfDocument({ markdown }: { markdown: string }) {
  const pages = paginateMarkdownBlocks(parseMarkdownBlocks(markdown));
  return (
    <div className="markdown-pdf-document">
      {pages.map((blocks, pageIndex) => (
        <section key={pageIndex} className="pdf-page markdown-pdf-page">
          <div className="markdown-pdf-header">
            <span>ECONOMY DAILY BRIEF</span>
            <span>{pageIndex + 1} / {pages.length}</span>
          </div>
          <div className="markdown-pdf-body">
            {blocks.map((block, blockIndex) => (
              <MarkdownPdfBlock key={`${pageIndex}-${blockIndex}`} block={block} />
            ))}
          </div>
          <div className="markdown-pdf-footer">로컬 경제 뉴스 대시보드 자동 생성 보고서</div>
        </section>
      ))}
    </div>
  );
}

function MarkdownPdfBlock({ block }: { block: MarkdownBlock }) {
  if (block.type === "blank") return <div className="markdown-pdf-blank" />;
  if (block.type === "h1") return <h1 className="markdown-pdf-h1">{block.text}</h1>;
  if (block.type === "h2") return <h2 className="markdown-pdf-h2">{block.text}</h2>;
  if (block.type === "h3") return <h3 className="markdown-pdf-h3">{block.text}</h3>;
  if (block.type === "h4") return <h4 className="markdown-pdf-h4">{block.text}</h4>;
  if (block.type === "li") return <div className="markdown-pdf-li"><span>•</span><p>{block.text}</p></div>;
  return <p className="markdown-pdf-p">{block.text}</p>;
}

function PdfReportDocument({
  report,
  summary,
  sections,
  important,
  bokImportant
}: {
  report: Report;
  summary: ReportSummary;
  sections: [string, ReportSection][];
  important: ReportArticle[];
  bokImportant: ReportArticle[];
}) {
  const sectionRows = sections.map(([, section]) => section);
  const signals = summary.signal_board || [];
  const memoItems = summary.market_checklist || [];
  return (
    <div className="pdf-document">
      <PdfPage>
        <div className="pdf-doc-code">ECONOMY DAILY BRIEF</div>
        <div className="pdf-title">일일 경제 뉴스 보고서</div>
        <div className="pdf-subtitle">
          보고일 {report.report_date} · {report.status === "final" ? "확정본" : "실시간 초안"} · 생성 {formatDate(report.generated_at)}
        </div>
        <div className="pdf-rule" />
        <div className="pdf-meta-grid">
          <div><span>보고 범위</span><b>국내·해외 경제, 한국은행 관련 기사</b></div>
          <div><span>작성 기준</span><b>로컬 수집 기사 및 AI/규칙 기반 요약</b></div>
          <div><span>활용 목적</span><b>당일 시장 변수와 정책 신호 점검</b></div>
        </div>
        <div className="pdf-section">
          <div className="pdf-section-title">1. 종합 의견</div>
          <p>{summary.overview || fallbackOverview()}</p>
        </div>
        <div className="pdf-metrics">
          <PdfMetric label="대상 기사" value={report.article_count} />
          <PdfMetric label="국내" value={report.domestic_count} />
          <PdfMetric label="해외" value={report.global_count} />
          <PdfMetric label="한국은행" value={report.bok_count} />
          <PdfMetric label="중요" value={report.important_count} />
        </div>
        <div className="pdf-section-title">2. 주요 키워드</div>
        <div className="pdf-chip-row">
          {(summary.keywords || []).slice(0, 12).map((keyword) => <span key={keyword.name} className="pdf-chip">#{keyword.name}</span>)}
        </div>
      </PdfPage>

      {chunkItems(signals, 3).map((items, index) => (
        <PdfPage key={`signals-${index}`}>
          <div className="pdf-page-heading">시장 신호 요약</div>
          <div className="pdf-page-subheading">주요 변수별 압력과 방향성을 보고용 문장으로 정리합니다.</div>
          <div className="pdf-signal-list">
            {items.map((signal) => <PdfSignal key={signal.label} signal={signal} />)}
          </div>
        </PdfPage>
      ))}

      <PdfPage>
        <div className="pdf-page-heading">핵심 파트별 요약</div>
        <div className="pdf-section-stack">
          {summary.domestic && <PdfInsight title="국내 경제" section={summary.domestic} />}
          {summary.global && <PdfInsight title="해외 경제" section={summary.global} />}
          {summary.bok && <PdfInsight title="한국은행" section={summary.bok} />}
        </div>
      </PdfPage>

      {chunkItems(sectionRows, 3).map((items, index) => (
        <PdfPage key={`topics-${index}`}>
          <div className="pdf-page-heading">분야별 브리핑</div>
          <div className="pdf-page-subheading">시장에 영향을 줄 수 있는 분야별 핵심 흐름입니다.</div>
          <div className="pdf-section-stack">
            {items.map((section) => <PdfTopic key={section.label} section={section} />)}
          </div>
        </PdfPage>
      ))}

      {chunkItems(memoItems, 5).map((items, index) => (
        <PdfPage key={`memo-${index}`}>
          <div className="pdf-page-heading">시장 영향 체크리스트</div>
          <div className="pdf-note-block">
            {items.map((item) => (
              <div key={item.label} className="pdf-check-row">
                <span className="pdf-check-circle" />
                <div><b>{item.label}</b> {item.detail}</div>
              </div>
            ))}
          </div>
        </PdfPage>
      ))}

      {chunkArticles(important, 1).map((items, index) => (
        <PdfPage key={`general-${index}`}>
          <div className="pdf-page-heading">주요 기사 검토 · 한국은행 OFF</div>
          <div className="pdf-page-subheading">한국 경제 전반 영향도 기준 TOP 10</div>
          <PdfArticleList articles={items} offset={index} />
        </PdfPage>
      ))}

      {chunkArticles(bokImportant, 1).map((items, index) => (
        <PdfPage key={`bok-${index}`}>
          <div className="pdf-page-heading">주요 기사 검토 · 한국은행 ON</div>
          <div className="pdf-page-subheading">한국은행 관련도와 경제 영향도 기준 TOP 10</div>
          <PdfArticleList articles={items} offset={index} />
        </PdfPage>
      ))}
    </div>
  );
}

function PdfPage({ children }: { children: ReactNode }) {
  return <section className="pdf-page">{children}</section>;
}

function PdfMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="pdf-metric">
      <div>{label}</div>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function PdfSignal({ signal }: { signal: SignalItem }) {
  return (
    <div className={`pdf-signal pdf-${signal.tone}`}>
      <div className="pdf-row-head">
        <div>
          <div className="pdf-signal-label">{signal.label}</div>
          <div className="pdf-signal-title">{signal.headline}</div>
        </div>
        <span className={`pdf-tone pdf-tone-${signal.tone}`}>{toneLabel(signal.tone)}</span>
      </div>
      <div className="pdf-chip-row">{signal.keywords.slice(0, 3).map((keyword) => <span key={keyword} className="pdf-chip">#{keyword}</span>)}</div>
      <p>{signal.detail}</p>
    </div>
  );
}

function PdfInsight({ title, section }: { title: string; section: ReportSection }) {
  return (
    <div className="pdf-card">
      <div className="pdf-card-head"><b>{title}</b><span>{section.count}건</span></div>
      <p>{section.overview}</p>
      <div className="pdf-chip-row">{(section.topics || []).slice(0, 4).map((topic) => <span key={topic} className="pdf-chip">#{topic}</span>)}</div>
    </div>
  );
}

function PdfTopic({ section }: { section: ReportSection }) {
  return (
    <div className="pdf-topic">
      <div className="pdf-card-head"><b>{section.label}</b><span>{section.count}건</span></div>
      <p>{section.overview}</p>
    </div>
  );
}

function PdfArticleList({ articles, offset }: { articles: ReportArticle[]; offset: number }) {
  return (
    <div className="pdf-article-list">
      {articles.map((article, index) => (
        <div key={`${article.id}-${index}`} className="pdf-article">
          <div className="pdf-rank">TOP {offset + index + 1}</div>
          <div className="pdf-article-body">
            <div className="pdf-article-title">{article.title}</div>
            {article.original_title !== article.title && <div className="pdf-original">원문: {article.original_title}</div>}
            <p>{article.summary}</p>
            <div className="pdf-chip-row">
              <span className="pdf-chip">영향 {percent(article.impact_score ?? article.importance_score)}</span>
              <span className="pdf-chip">중요 {percent(article.importance_score)}</span>
              <span className="pdf-chip">BOK {percent(article.bok_relevance_score)}</span>
              <span className="pdf-chip">{article.source}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function toneLabel(tone: SignalItem["tone"]) {
  if (tone === "negative") return "부담";
  if (tone === "positive") return "개선";
  if (tone === "watch") return "점검";
  return "중립";
}

function chunkArticles(articles: ReportArticle[], size: number) {
  return chunkItems(articles, size);
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  return markdown.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: "blank", text: "" };
    if (trimmed.startsWith("#### ")) return { type: "h4", text: trimmed.replace(/^####\s+/, "") };
    if (trimmed.startsWith("### ")) return { type: "h3", text: trimmed.replace(/^###\s+/, "") };
    if (trimmed.startsWith("## ")) return { type: "h2", text: trimmed.replace(/^##\s+/, "") };
    if (trimmed.startsWith("# ")) return { type: "h1", text: trimmed.replace(/^#\s+/, "") };
    if (trimmed.startsWith("- ")) return { type: "li", text: trimmed.replace(/^-\s+/, "") };
    return { type: "p", text: trimmed };
  });
}

function paginateMarkdownBlocks(blocks: MarkdownBlock[]) {
  const pages: MarkdownBlock[][] = [];
  let current: MarkdownBlock[] = [];
  let currentWeight = 0;
  const maxWeight = 62;

  for (const block of blocks) {
    const weight = markdownBlockWeight(block);
    const shouldBreak = current.length > 0 && currentWeight + weight > maxWeight;
    if (shouldBreak) {
      pages.push(trimPageBlocks(current));
      current = [];
      currentWeight = 0;
    }
    current.push(block);
    currentWeight += weight;
  }

  if (current.length > 0) {
    pages.push(trimPageBlocks(current));
  }
  return pages.length ? pages : [[{ type: "p" as const, text: "보고서 내용이 없습니다." }]];
}

function trimPageBlocks(blocks: MarkdownBlock[]) {
  const result = [...blocks];
  while (result[0]?.type === "blank") result.shift();
  while (result[result.length - 1]?.type === "blank") result.pop();
  return result;
}

function markdownBlockWeight(block: MarkdownBlock) {
  const textLength = block.text.length;
  if (block.type === "blank") return 0.7;
  if (block.type === "h1") return 6;
  if (block.type === "h2") return 4.5;
  if (block.type === "h3") return 3.5;
  if (block.type === "h4") return 2.8;
  if (block.type === "li") return Math.max(1.7, Math.ceil(textLength / 48) * 1.5);
  return Math.max(2, Math.ceil(textLength / 54) * 1.7);
}

function generateMarkdownReport({
  report,
  summary,
  sections,
  important,
  bokImportant
}: {
  report: Report;
  summary: ReportSummary;
  sections: [string, ReportSection][];
  important: ReportArticle[];
  bokImportant: ReportArticle[];
}) {
  const sectionMap = Object.fromEntries(sections);
  const signals = summary.signal_board || [];
  const checklist = summary.market_checklist || [];
  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(report.generated_at));
  const keywords = normalizedKeywords(summary);
  const domestic = summary.domestic || emptySection("국내 경제");
  const global = summary.global || emptySection("해외 경제");
  const bok = summary.bok || emptySection("한국은행 관련 이슈");
  const marketSignal = findSignal(signals, ["증시", "시장"]);
  const rateSignal = findSignal(signals, ["금리", "채권"]);
  const fxSignal = findSignal(signals, ["환율", "달러"]);
  const inflationSignal = findSignal(signals, ["물가", "소비"]);
  const realEstateSignal = findSignal(signals, ["부동산", "가계", "부채"]);
  const industrySignal = findSignal(signals, ["산업", "수출", "반도체"]);
  const bokSignal = findSignal(signals, ["한국은행", "금통위", "통화정책"]);

  return [
    "# 일일 경제 뉴스 보고서",
    "",
    "## 0. 보고 개요",
    `- 보고일: ${report.report_date}`,
    `- 생성 시각: ${generatedAt} KST`,
    "- 보고 범위: 국내 경제, 해외 경제, 한국은행 관련 기사",
    `- 수집 기사 수: ${report.article_count.toLocaleString()}건`,
    `- 국내 기사 수: ${report.domestic_count.toLocaleString()}건`,
    `- 해외 기사 수: ${report.global_count.toLocaleString()}건`,
    `- 한국은행 관련 기사 수: ${report.bok_count.toLocaleString()}건`,
    "- 주요 활용 목적: 당일 경제 흐름, 시장 영향, 정책 관련 확인 포인트 점검",
    "",
    "## 1. 종합 의견",
    "",
    "### 1.1 전체 시장 판단",
    markdownParagraph(summary.overview || fallbackOverview()),
    "",
    "### 1.2 주요 리스크",
    `- 물가: ${riskLine(inflationSignal, "물가 관련 보도는 금리 기대와 소비 심리에 직접 영향을 줄 수 있습니다.")}`,
    `- 금리: ${riskLine(rateSignal, "금리 뉴스는 채권가격, 성장주 밸류에이션, 대출 수요를 함께 흔들 수 있습니다.")}`,
    `- 환율: ${riskLine(fxSignal, "환율 변동은 수입물가, 외국인 수급, 기업 실적 전망에 영향을 줄 수 있습니다.")}`,
    `- 증시: ${riskLine(marketSignal, "증시는 금리와 실적 기대 변화에 민감하게 반응할 가능성이 있습니다.")}`,
    `- 부동산/가계부채: ${riskLine(realEstateSignal, "대출금리와 가계부채 부담은 소비 여력과 금융권 건전성 점검 요인입니다.")}`,
    `- 한국은행/통화정책: ${riskLine(bokSignal, "한국은행 및 금통위 발언은 기준금리 기대와 채권시장 방향성에 영향을 줄 수 있습니다.")}`,
    "",
    "### 1.3 단기 관전 포인트",
    "- 다음 물가 지표 확인 필요",
    "- 원/달러 환율 흐름 확인 필요",
    "- 한국은행 및 금통위 발언 확인 필요",
    "- 미국 Fed 관련 발언 및 금리 기대 변화 확인 필요",
    "",
    "## 2. 주요 키워드",
    "",
    "### 2.1 핵심 키워드",
    ...keywords.map((keyword) => `- ${keyword}`),
    "",
    "### 2.2 키워드별 해석",
    "#### 2.2.1 물가",
    keywordInterpretation("물가", inflationSignal, "물가 부담은 통화정책 완화 시점을 늦추고 소비 회복 속도를 제한할 수 있습니다."),
    "",
    "#### 2.2.2 금리",
    keywordInterpretation("금리", rateSignal, "금리 관련 뉴스는 채권, 성장주, 대출 수요에 직접 영향을 줍니다."),
    "",
    "#### 2.2.3 환율",
    keywordInterpretation("환율", fxSignal, "원화 약세 또는 달러 강세는 수입물가와 외국인 수급, 수출기업 실적 전망을 함께 바꿀 수 있습니다."),
    "",
    "## 3. 시장 신호 요약",
    "",
    marketSignalSection("3.1 물가 부담", inflationSignal, ["물가", "소비", "인플레이션"], "CPI, 기대인플레이션, 유가"),
    marketSignalSection("3.2 금리 부담", rateSignal, ["금리", "채권", "기준금리"], "국고채 금리, Fed 발언, 금통위 발언"),
    marketSignalSection("3.3 환율 부담", fxSignal, ["환율", "달러", "외환"], "원/달러 환율, 달러인덱스, 외국인 수급"),
    marketSignalSection("3.4 증시 방향성", marketSignal, ["증시", "실적", "위험선호"], "코스피·나스닥 흐름, 외국인 매매"),
    marketSignalSection("3.5 부동산/가계부채 부담", realEstateSignal, ["부동산", "가계부채", "대출"], "주택거래, 대출금리, 연체율"),
    marketSignalSection("3.6 산업/수출 개선 여부", industrySignal, ["산업", "수출", "반도체"], "수출 지표, 반도체 가격, 글로벌 수요"),
    "## 4. 핵심 파트별 요약",
    "",
    partSummary("4.1 국내 경제", domestic, "금리, 환율, 물가, 증시에 미치는 영향을 함께 확인해야 합니다.", "국내 물가 지표, 정책 발언, 금융시장 반응을 확인해야 합니다."),
    partSummary("4.2 해외 경제", global, "미국 금리, Fed, 인플레이션, 글로벌 증시 흐름이 국내 시장에 파급될 수 있습니다.", "미국 Fed 발언, 주요국 물가 지표, 글로벌 증시 반응을 확인해야 합니다."),
    partSummary("4.3 한국은행 관련 이슈", bok, "채권시장, 환율, 대출금리, 금융권 건전성에 대한 정책 기대가 조정될 수 있습니다.", "금통위 발언, 물가 지표, 환율 흐름을 함께 점검해야 합니다."),
    "## 5. 분야별 브리핑",
    "",
    briefingSection("5.1 증시", getReportSection(sectionMap, "markets", "증시"), "금리와 실적 기대 변화가 지수 방향성을 좌우할 수 있습니다.", "위험선호 둔화, 외국인 수급 변화", "주요국 증시와 외국인 매매 동향"),
    briefingSection("5.2 금리/채권", getReportSection(sectionMap, "rates_bonds", "금리/채권"), "기준금리 기대 변화가 채권금리와 대출금리에 반영될 수 있습니다.", "물가 재상승, 정책 발언 변화", "국고채 금리와 Fed 발언"),
    briefingSection("5.3 환율", getReportSection(sectionMap, "fx", "환율"), "환율 변동은 수입물가와 외국인 수급에 영향을 줄 수 있습니다.", "달러 강세, 지정학 리스크", "원/달러 환율과 달러인덱스"),
    briefingSection("5.4 부동산/가계부채", getReportSection(sectionMap, "real_estate_debt", "부동산/가계부채"), "대출금리와 부채 부담은 소비 및 금융권 건전성에 영향을 줄 수 있습니다.", "연체율 상승, 대출 규제 변화", "주택거래량, 대출금리, 연체율"),
    briefingSection("5.5 산업/수출", getReportSection(sectionMap, "industry_export", "산업/수출"), "수출과 산업 뉴스는 성장률 및 기업 실적 전망에 연결됩니다.", "글로벌 수요 둔화, 원자재 가격 변동", "수출입 지표와 반도체 업황"),
    briefingSection("5.6 금융/은행", getReportSection(sectionMap, "banking_finance", "금융/은행"), "은행권 수익성과 건전성은 금리·대출·연체 흐름에 따라 달라질 수 있습니다.", "부실채권 증가, 조달비용 상승", "은행 연체율과 예대금리차"),
    briefingSection("5.7 물가/소비", getReportSection(sectionMap, "inflation_consumption", "물가/소비"), "물가와 소비 뉴스는 실질 구매력과 내수 회복 판단에 중요합니다.", "생활물가 상승, 소비심리 둔화", "CPI, 소비심리, 소매판매"),
    "## 6. 시장 영향 체크리스트",
    "",
    "### 6.1 통화정책",
    `- 기준금리 기대 변화 여부: ${checklistLine(checklist, ["금리", "통화정책", "기준금리"], "기준금리 기대 변화 여부를 확인해야 합니다.")}`,
    `- 한국은행/금통위 발언 영향: ${checklistLine(checklist, ["한국은행", "금통위"], "한국은행과 금통위 발언의 시장 반응을 확인해야 합니다.")}`,
    `- 채권시장 반응: ${checklistLine(checklist, ["채권"], "국고채 금리와 장단기 금리차를 점검해야 합니다.")}`,
    "",
    "### 6.2 환율",
    `- 원/달러 환율 방향: ${checklistLine(checklist, ["환율", "원/달러"], "원/달러 환율 방향성을 확인해야 합니다.")}`,
    "- 수입물가 영향: 환율 상승 시 수입물가 부담 확대 여부를 확인해야 합니다.",
    "- 외국인 수급 영향: 환율 변동에 따른 외국인 주식·채권 수급 변화를 확인해야 합니다.",
    "",
    "### 6.3 물가/소비",
    "- 물가 압력 지속 여부: 생활물가와 기대인플레이션 흐름을 확인해야 합니다.",
    "- 소비 회복 지연 가능성: 고금리와 물가 부담이 소비 회복을 늦추는지 점검해야 합니다.",
    "- 금리 인하 기대 변화: 물가 뉴스가 금리 인하 기대를 되돌리는지 확인해야 합니다.",
    "",
    "### 6.4 부동산/가계부채",
    "- 대출금리 부담: 가계와 자영업자의 이자 부담 변화를 확인해야 합니다.",
    "- 가계소비 위축 가능성: 부채 부담이 소비 여력을 제한하는지 점검해야 합니다.",
    "- 금융권 건전성 영향: 연체율 및 부실채권 증가 여부를 확인해야 합니다.",
    "",
    "### 6.5 산업/수출",
    "- 반도체/수출 흐름: 반도체와 주요 수출품목의 회복 여부를 확인해야 합니다.",
    "- 원자재/유가 영향: 비용 부담과 무역수지 영향을 함께 확인해야 합니다.",
    "- 글로벌 수요 변화: 미국·중국·유럽 수요 변화가 국내 기업 실적에 미치는 영향을 점검해야 합니다.",
    "",
    "## 7. 주요 기사 검토",
    "",
    "### 7.1 한국경제 영향도 기준 TOP 10",
    "각 기사는 경제 전반 영향도와 중요도를 중심으로 검토했습니다.",
    "",
    ...articleBlocks(important.slice(0, 10), "impact"),
    "### 7.2 한국은행 관련도 기준 TOP 10",
    "각 기사는 한국은행 및 금통위 관련성과 시장 영향을 중심으로 검토했습니다.",
    "",
    ...articleBlocks(bokImportant.slice(0, 10), "bok"),
    "## 8. 최종 판단",
    "",
    "### 8.1 오늘의 핵심 결론",
    finalConclusion(summary.overview || fallbackOverview()),
    "",
    "### 8.2 단기 리스크",
    `- 상방 리스크: ${riskLine(inflationSignal, "물가와 환율 부담이 재확대될 경우 금리 인하 기대가 약해질 수 있습니다.")}`,
    `- 하방 리스크: ${riskLine(industrySignal, "수출과 소비 회복이 지연될 경우 성장 기대가 낮아질 수 있습니다.")}`,
    `- 정책 리스크: ${riskLine(bokSignal, "한국은행 및 주요국 중앙은행 발언에 따라 시장 기대가 빠르게 조정될 수 있습니다.")}`,
    `- 시장 리스크: ${riskLine(marketSignal, "금리와 환율 변동성이 확대되면 증시 위험선호가 약해질 수 있습니다.")}`,
    "",
    "### 8.3 내일 확인할 항목",
    "- 물가 관련 후속 보도",
    "- 환율 흐름",
    "- 채권금리 변화",
    "- 한국은행/금통위 발언",
    "- 미국 Fed 관련 발언",
    "- 주요국 증시 반응",
    ""
  ].join("\n");
}

function normalizedKeywords(summary: ReportSummary) {
  const defaults = ["물가", "금리", "환율", "기준금리", "은행", "Fed", "반도체", "수출"];
  const fromReport = (summary.keywords || []).map((keyword) => keyword.name).filter(Boolean);
  return Array.from(new Set([...fromReport, ...defaults])).slice(0, 12);
}

function emptySection(label: string): ReportSection {
  return {
    label,
    count: 0,
    topics: [],
    overview: "해당 범주의 주요 기사는 아직 제한적입니다.",
    articles: []
  };
}

function getReportSection(sectionMap: Record<string, ReportSection>, key: string, label: string) {
  return sectionMap[key] || emptySection(label);
}

function markdownParagraph(value: string) {
  return trimSentences(cleanMarkdownText(value), 4) || "확인된 주요 흐름이 제한적입니다.";
}

function cleanMarkdownText(value?: string | null) {
  return (value || "").replace(/\s+/g, " ").replace(/#/g, "").trim();
}

function trimSentences(value: string, maxSentences: number) {
  const text = cleanMarkdownText(value);
  if (!text) return "";
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [text];
  return sentences.slice(0, maxSentences).join(" ");
}

function findSignal(signals: SignalItem[], keywords: string[]) {
  return signals.find((signal) => {
    const text = `${signal.label} ${signal.headline} ${signal.keywords.join(" ")} ${signal.detail}`;
    return keywords.some((keyword) => text.includes(keyword));
  });
}

function riskLine(signal: SignalItem | undefined, fallback: string) {
  if (!signal) return fallback;
  return `${toneLabel(signal.tone)} 신호가 확인됩니다. ${trimSentences(signal.detail, 1)}`;
}

function keywordInterpretation(keyword: string, signal: SignalItem | undefined, fallback: string) {
  if (!signal) return fallback;
  return `${keyword} 관련 신호는 '${signal.headline}'으로 요약됩니다. ${trimSentences(signal.detail, 2)}`;
}

function marketSignalSection(title: string, signal: SignalItem | undefined, keywords: string[], indicators: string) {
  return [
    `### ${title}`,
    `- 관련 키워드: ${(signal?.keywords?.length ? signal.keywords : keywords).slice(0, 5).join(", ")}`,
    `- 현재 신호: ${signal ? `${toneLabel(signal.tone)} - ${signal.headline}` : "후속 보도 확인 필요"}`,
    `- 시장 영향: ${signal ? trimSentences(signal.detail, 2) : "아직 방향성은 제한적이나 관련 지표 발표 시 시장 반응이 커질 수 있습니다."}`,
    `- 확인 필요 지표: ${indicators}`,
    ""
  ].join("\n");
}

function partSummary(title: string, section: ReportSection, marketImpact: string, checkPoint: string) {
  return [
    `### ${title}`,
    "#### 주요 흐름",
    `${markdownParagraph(section.overview)} ${section.count > 0 ? `관련 기사는 ${section.count.toLocaleString()}건입니다.` : ""}`.trim(),
    "",
    "#### 시장 영향",
    marketImpact,
    "",
    "#### 확인 필요 사항",
    checkPoint,
    ""
  ].join("\n");
}

function briefingSection(title: string, section: ReportSection, marketImpact: string, risk: string, checkPoint: string) {
  const articleHint = section.articles?.length
    ? `관련 주요 기사: ${section.articles.slice(0, 2).map((article) => article.title).join(" / ")}`
    : "관련 주요 기사는 아직 제한적입니다.";
  return [
    `### ${title}`,
    "#### 주요 뉴스 흐름",
    `${markdownParagraph(section.overview)} ${articleHint}`,
    "",
    "#### 시장 영향",
    marketImpact,
    "",
    "#### 리스크 요인",
    risk,
    "",
    "#### 확인 필요 포인트",
    checkPoint,
    ""
  ].join("\n");
}

function checklistLine(items: MarketChecklistItem[], keywords: string[], fallback: string) {
  const item = items.find((row) => keywords.some((keyword) => `${row.label} ${row.detail}`.includes(keyword)));
  return item ? `${item.label} - ${trimSentences(item.detail, 1)}` : fallback;
}

function articleBlocks(articles: ReportArticle[], mode: "impact" | "bok") {
  if (articles.length === 0) {
    return ["검토 대상 기사가 아직 없습니다.", ""];
  }
  return articles.flatMap((article, index) => {
    const impactScore = article.impact_score ?? article.importance_score;
    return [
      `#### 7.${mode === "impact" ? "1" : "2"}.${index + 1} ${cleanMarkdownText(article.title)}`,
      `- 원문 제목: ${cleanMarkdownText(article.original_title || article.title)}`,
      `- 출처: ${article.source || "출처 미확인"}`,
      `- 영향도: ${percent(impactScore)}`,
      `- 중요도: ${percent(article.importance_score)}`,
      `- BOK 관련도: ${percent(article.bok_relevance_score)}`,
      `- 핵심 내용: ${markdownParagraph(article.summary || article.title)}`,
      mode === "bok"
        ? `- 한국은행/금통위 관련성: ${article.bok_relevance_score >= 0.6 ? "한국은행 및 통화정책 관련성이 높은 기사로 우선 점검이 필요합니다." : "직접 관련성은 제한적이나 정책 변수와의 연결 가능성을 확인해야 합니다."}`
        : null,
      `- 시장 영향: ${articleMarketImpact(article)}`,
      "- 확인 필요 사항: 후속 보도, 정책 당국 발언, 금융시장 반응을 함께 확인해야 합니다.",
      ""
    ].filter((line): line is string => Boolean(line));
  });
}

function articleMarketImpact(article: ReportArticle) {
  const impactScore = article.impact_score ?? article.importance_score;
  if (impactScore >= 0.8) return "한국 경제와 금융시장 전반에 영향을 줄 수 있어 우선 점검이 필요합니다.";
  if (impactScore >= 0.5) return "특정 시장 변수에 영향을 줄 수 있어 관련 지표와 후속 반응을 확인해야 합니다.";
  return "직접 영향은 제한적이나 관련 이슈 확산 여부를 관찰할 필요가 있습니다.";
}

function finalConclusion(overview: string) {
  const text = trimSentences(overview, 3);
  return text || "오늘은 금리, 환율, 물가, 한국은행 관련 신호를 중심으로 시장 반응을 확인해야 합니다.";
}

function waitForExportRender() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function buildStandaloneHtml(title: string, bodyHtml: string) {
  const styles = collectDocumentStyles();
  const rootClass = document.documentElement.className;
  return `<!doctype html>
<html lang="ko" class="${escapeHtml(rootClass)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
  <style>
    body { margin: 0; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

function collectDocumentStyles() {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      chunks.push(rules.map((rule) => rule.cssText).join("\n"));
    } catch {
      const href = sheet.href;
      if (href) {
        chunks.push(`@import url("${href}");`);
      }
    }
  }
  return chunks.join("\n");
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function collectPdfBreaks(target: HTMLElement, canvas: HTMLCanvasElement) {
  const targetRect = target.getBoundingClientRect();
  const scaleY = canvas.height / Math.max(1, target.scrollHeight);
  const elements = Array.from(target.querySelectorAll<HTMLElement>("section, .rounded-lg"));
  const breaks = elements
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const bottom = rect.bottom - targetRect.top + target.scrollTop;
      return Math.round(bottom * scaleY);
    })
    .filter((value) => value > 24 && value < canvas.height - 24)
    .sort((a, b) => a - b);
  return Array.from(new Set(breaks));
}

function pickPdfSliceHeight(sourceY: number, canvasHeight: number, maxHeight: number, pageBreaks: number[]) {
  const remaining = canvasHeight - sourceY;
  if (remaining <= maxHeight) return remaining;
  const minHeight = Math.floor(maxHeight * 0.58);
  const idealEnd = sourceY + maxHeight;
  const safeEnd = sourceY + maxHeight - 28;
  const candidates = pageBreaks.filter((breakPoint) => breakPoint > sourceY + minHeight && breakPoint <= safeEnd);
  if (candidates.length > 0) {
    return Math.max(1, candidates[candidates.length - 1] - sourceY);
  }
  return Math.min(remaining, maxHeight);
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function SignalBoard({ signals }: { signals: SignalItem[] }) {
  const rows = signals.length
    ? signals
    : [
        {
          label: "시장 방향",
          headline: "후속 신호 대기",
          tone: "watch" as const,
          strength: 35,
          keywords: ["금리", "환율", "물가"],
          detail: "아직 한쪽 방향으로 뚜렷한 신호가 적어 다음 지표와 후속 보도를 확인하는 구간입니다."
        }
      ];
  return (
    <section className="space-y-3">
      <SectionHeader title="한국 경제 영향 신호" subtitle="해외 변수를 포함해 한국 경제에 미치는 압력과 방향을 색상·키워드로 훑어봅니다." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((signal) => (
          <SignalCard key={signal.label} signal={signal} />
        ))}
      </div>
    </section>
  );
}

function SignalCard({ signal }: { signal: SignalItem }) {
  const tone = signalTone(signal.tone);
  const Icon = signal.tone === "positive" ? ArrowDownRight : signal.tone === "negative" ? TriangleAlert : TrendingUp;
  return (
    <Card className={cn("overflow-hidden border-l-4 p-4", tone.border)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{signal.label}</div>
          <div className={cn("mt-1 flex items-center gap-2 text-lg font-semibold", tone.text)}>
            <Icon size={18} />
            {signal.headline}
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.max(8, Math.min(100, signal.strength))}%` }} />
      </div>
      {signal.keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {signal.keywords.map((keyword) => (
            <span key={keyword} className={cn("rounded-md px-2 py-1 text-xs font-medium", tone.keyword)}>
              #{keyword}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{signal.detail}</p>
    </Card>
  );
}

function signalTone(tone: SignalItem["tone"]) {
  if (tone === "negative") {
    return {
      border: "border-l-red-500",
      text: "text-red-700 dark:text-red-300",
      badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      bar: "bg-red-500",
      keyword: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
    };
  }
  if (tone === "positive") {
    return {
      border: "border-l-emerald-500",
      text: "text-emerald-700 dark:text-emerald-300",
      badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
      bar: "bg-emerald-500",
      keyword: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    };
  }
  return {
    border: "border-l-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    bar: "bg-amber-500",
    keyword: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
  };
}

function InsightCard({ title, icon: Icon, section, tone }: { title: string; icon: typeof Home; section: ReportSection; tone: "primary" | "blue" | "green" }) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md", toneClass)}>
            <Icon size={17} />
          </span>
          <h3 className="font-semibold">{title}</h3>
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-sm font-semibold text-foreground">{section.count}건</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.overview}</p>
      {section.topics && section.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {section.topics.slice(0, 4).map((topic) => (
            <span key={topic} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              #{topic}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function TopicCard({ icon: Icon, section }: { icon: typeof BarChart3; section: ReportSection }) {
  return (
    <Card className="p-4 transition hover:border-primary/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
            <Icon size={17} />
          </span>
          <h3 className="font-semibold">{section.label}</h3>
        </div>
        <span className="rounded-md bg-primary px-2.5 py-1 text-sm font-bold text-primary-foreground">{section.count}건</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.overview}</p>
      <div className="mt-3 space-y-2">
        {section.articles.slice(0, 2).map((article) => (
          <Link key={article.id} to={`/articles/${article.id}`} className="block rounded-md border border-border bg-background p-2 text-sm hover:border-primary/50">
            <div className="line-clamp-2 font-medium">{article.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">영향 {percent(article.impact_score ?? article.importance_score)}</div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function ChecklistMemo({ items }: { items: MarketChecklistItem[] }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const rows = items.length
    ? items
    : [{ label: "시장 방향", detail: "오늘은 여러 경제 이슈가 분산되어 있어 금리·환율·증시 반응을 함께 보는 편이 좋습니다." }];
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      style={{ backgroundImage: "linear-gradient(rgba(120, 90, 20, 0.12) 1px, transparent 1px)", backgroundSize: "100% 32px" }}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <StickyNote size={16} /> 체크리스트 메모
      </div>
      <div className="space-y-2">
        {rows.map((item, index) => {
          const isChecked = Boolean(checked[index]);
          return (
            <button
              type="button"
              key={`${item.label}-${index}`}
              onClick={() => setChecked((current) => ({ ...current, [index]: !current[index] }))}
              className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition hover:bg-amber-100/70 dark:hover:bg-amber-900/30"
            >
              {isChecked ? <CheckCircle2 className="mt-0.5 shrink-0 text-amber-500" size={18} /> : <Circle className="mt-0.5 shrink-0 text-amber-500" size={18} />}
              <span className={cn("leading-6", isChecked && "opacity-70")}>
                <span className="font-semibold">{item.label}</span>
                <span className="ml-2 text-sm">{item.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PdfTopArticles({ important, bokImportant }: { important: ReportArticle[]; bokImportant: ReportArticle[] }) {
  return (
    <section className="space-y-4">
      <SectionHeader title="오늘 봐야 할 기사" subtitle="PDF에는 한국은행 비활성화 기준과 활성화 기준의 TOP 10을 모두 담습니다." />
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-900 dark:text-slate-200">한국은행 OFF</span>
          <h3 className="font-semibold">경제 영향도 기준 TOP 10</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {important.length === 0 && <div className="text-sm text-muted-foreground">조건에 맞는 주요 기사가 아직 없습니다.</div>}
          {important.slice(0, 10).map((article, index) => (
            <FeatureArticle key={`pdf-general-${article.id}-${index}`} article={article} rank={index + 1} />
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">한국은행 ON</span>
          <h3 className="font-semibold">한국은행 관련도 우선 TOP 10</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {bokImportant.length === 0 && <div className="text-sm text-muted-foreground">한국은행 기준 주요 기사가 아직 없습니다.</div>}
          {bokImportant.slice(0, 10).map((article, index) => (
            <FeatureArticle key={`pdf-bok-${article.id}-${index}`} article={article} rank={index + 1} />
          ))}
        </div>
      </Card>
    </section>
  );
}

function FeatureArticle({ article, rank }: { article: ReportArticle; rank: number }) {
  const impactScore = article.impact_score ?? article.importance_score;
  return (
    <Card className="overflow-hidden transition hover:border-primary/60">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">TOP {rank}</span>
          <span className="text-xs text-muted-foreground">{article.source}</span>
        </div>
      </div>
      <div className="p-4">
        <Link to={`/articles/${article.id}`} className="line-clamp-2 text-lg font-semibold leading-snug hover:text-primary">
          {article.title}
        </Link>
        {article.original_title !== article.title && <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">원문: {article.original_title}</div>}
        <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">{article.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">영향 {percent(impactScore)}</span>
          <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200">중요 {percent(article.importance_score)}</span>
          <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">BOK {percent(article.bok_relevance_score)}</span>
          <Link to={`/articles/${article.id}`} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
            기사 보기 <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </Card>
  );
}

function fallbackOverview() {
  return "오늘 수집된 국내외 경제 기사를 바탕으로 금리, 환율, 물가, 증시, 한국은행 관련 흐름을 정리했습니다. 개별 기사 제목보다 경제 전반에 영향을 줄 수 있는 변수와 앞으로 확인해야 할 지표를 중심으로 읽으면 좋습니다.";
}
