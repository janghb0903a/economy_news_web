import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, CheckCircle2, Clock, ExternalLink, Info, LineChart as LineChartIcon, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, GhostButton } from "../components/ui";
import { api } from "../lib/api";
import type { Article, EconomicApiStatus, EconomicIndicatorObservation } from "../lib/types";
import { cn } from "../lib/utils";

type Importance = "high" | "medium" | "low";
type EventStatus = "scheduled" | "released" | "delayed" | "manual_check_required";
type Direction = "up" | "down" | "flat" | "none";

type IndicatorEvent = {
  code: string;
  nameKo: string;
  nameEn: string;
  country: "KR" | "US" | "GLOBAL";
  category: string;
  description: string;
  eventDate: Date;
  dateOnly?: boolean;
  periodLabel: string;
  importance: Importance;
  status: EventStatus;
  relatedMarkets: string[];
  keywords: string[];
  sourceName: string;
  sourceStatus: string;
  actualValue: number | null;
  previousValue: number | null;
  unit: string;
  interpretation: Record<Exclude<Direction, "none">, string>;
  series: { label: string; date?: string | null; value: number }[];
  observation?: EconomicIndicatorObservation;
};

const importanceLabel: Record<Importance, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음"
};

const statusLabel: Record<EventStatus, string> = {
  scheduled: "예정",
  released: "발표완료",
  delayed: "지연",
  manual_check_required: "수동확인필요"
};

const categoryLabel: Record<string, string> = {
  inflation: "물가",
  rates: "금리",
  fx: "환율",
  trade: "수출입",
  employment: "고용",
  market: "시장",
  policy: "통화정책"
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function withTime(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function formatDateTime(date: Date, dateOnly?: boolean) {
  if (dateOnly) {
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function chartMonthLabel(value: string | null | undefined) {
  if (!value) return "";
  const text = String(value);
  const compact = text.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${Number(compact[2])}월`;
  const dashed = text.match(/^(\d{4})[-./](\d{1,2})(?:[-./]\d{1,2})?/);
  if (dashed) return `${Number(dashed[2])}월`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return `${parsed.getMonth() + 1}월`;
  const koreanMonth = text.match(/(\d{1,2})\s*월/);
  if (koreanMonth) return `${Number(koreanMonth[1])}월`;
  return text;
}

function formatValue(value: number | null, unit: string) {
  if (value === null || value === undefined) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
}

function formatActualValue(event: IndicatorEvent) {
  if (event.status !== "released") return "-";
  return formatValue(event.actualValue, event.unit);
}

function LoadingValue() {
  return <span className="inline-block h-4 w-14 animate-pulse rounded bg-muted align-middle" aria-label="정보를 가져오는 중입니다." />;
}

function directionOf(event: IndicatorEvent): Direction {
  if (event.status !== "released") return "none";
  if (event.actualValue === null || event.previousValue === null) return "none";
  if (event.actualValue > event.previousValue) return "up";
  if (event.actualValue < event.previousValue) return "down";
  return "flat";
}

function directionLabel(direction: Direction) {
  if (direction === "up") return "상승";
  if (direction === "down") return "하락";
  if (direction === "flat") return "보합";
  return "미정";
}

function directionIcon(direction: Direction) {
  if (direction === "up") return <ArrowUp size={14} />;
  if (direction === "down") return <ArrowDown size={14} />;
  if (direction === "flat") return <ArrowRight size={14} />;
  return <Clock size={14} />;
}

function hasLiveObservation(observation?: EconomicIndicatorObservation): observation is EconomicIndicatorObservation {
  return Boolean(observation && !observation.is_sample && observation.status === "connected" && observation.series.length > 0);
}

function isFutureEvent(event: IndicatorEvent) {
  const now = new Date();
  if (event.dateOnly) {
    const eventDay = new Date(event.eventDate);
    eventDay.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return eventDay.getTime() > today.getTime();
  }
  return event.eventDate.getTime() > now.getTime();
}

function eventPeriodStart(event: IndicatorEvent) {
  const periodMonth = event.periodLabel.match(/(\d{1,2})\s*월/);
  if (!periodMonth) return new Date(event.eventDate.getFullYear(), event.eventDate.getMonth(), 1);
  const monthIndex = Math.max(0, Math.min(11, Number(periodMonth[1]) - 1));
  const eventMonth = event.eventDate.getMonth();
  const year = monthIndex <= eventMonth ? event.eventDate.getFullYear() : event.eventDate.getFullYear() - 1;
  return new Date(year, monthIndex, 1);
}

function parseSeriesDate(point: { label: string; date?: string | null }, event: IndicatorEvent) {
  const text = point.date || point.label;
  if (!text) return null;
  const compact = text.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
  if (compact) return new Date(Number(compact[1]), Number(compact[2]) - 1, 1);
  const dashed = text.match(/^(\d{4})[-./](\d{1,2})(?:[-./]\d{1,2})?/);
  if (dashed) return new Date(Number(dashed[1]), Number(dashed[2]) - 1, 1);
  const koreanMonth = text.match(/(\d{1,2})\s*월/);
  if (koreanMonth) {
    const monthIndex = Number(koreanMonth[1]) - 1;
    const eventPeriod = eventPeriodStart(event);
    const year = monthIndex <= event.eventDate.getMonth() ? event.eventDate.getFullYear() : event.eventDate.getFullYear() - 1;
    if (monthIndex === eventPeriod.getMonth()) return eventPeriod;
    return new Date(year, monthIndex, 1);
  }
  return null;
}

function removeUnreleasedPeriod(
  event: IndicatorEvent,
  series: { label: string; date?: string | null; value: number }[]
) {
  const cutoff = eventPeriodStart(event).getTime();
  return series.filter((point) => {
    const pointDate = parseSeriesDate(point, event);
    return pointDate ? pointDate.getTime() < cutoff : true;
  });
}

function applyObservation(event: IndicatorEvent, observation?: EconomicIndicatorObservation): IndicatorEvent {
  if (!hasLiveObservation(observation)) {
    return observation ? { ...event, observation } : event;
  }
  const series = observation.series.map((point) => ({ label: chartMonthLabel(point.date || point.label), date: point.date, value: point.value }));
  if (isFutureEvent(event)) {
    const releasedSeries = removeUnreleasedPeriod(event, series);
    const previousReleasedValue = releasedSeries.length > 0 ? releasedSeries[releasedSeries.length - 1].value : observation.previous_value ?? event.previousValue;
    return {
      ...event,
      observation,
      status: "scheduled",
      sourceName: observation.source_label || event.sourceName,
      sourceStatus: observation.message || event.sourceStatus,
      actualValue: null,
      previousValue: previousReleasedValue,
      unit: observation.unit || event.unit,
      series: releasedSeries
    };
  }
  return {
    ...event,
    observation,
    status: observation.actual_value === null ? event.status : "released",
    sourceName: observation.source_label || event.sourceName,
    sourceStatus: observation.message || event.sourceStatus,
    actualValue: observation.actual_value,
    previousValue: observation.previous_value,
    unit: observation.unit || event.unit,
    series
  };
}

function buildSeries(base: number, step: number, wave = 0.15) {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    const value = base + step * index + Math.sin(index * 0.9) * wave;
    return {
      label: new Intl.DateTimeFormat("ko-KR", { month: "short" }).format(month),
      value: Number(value.toFixed(2))
    };
  });
}

function buildEvents(today: Date): IndicatorEvent[] {
  const date = (offset: number, hour: number, minute = 0) => withTime(addDays(today, offset), hour, minute);
  return [
    {
      code: "KR_BASE_RATE",
      nameKo: "한국 기준금리",
      nameEn: "Bank of Korea Base Rate",
      country: "KR",
      category: "rates",
      description: "한국은행 기준금리 결정은 국내 채권금리, 대출금리, 은행 수익성, 부동산 심리에 직접적인 영향을 줍니다.",
      eventDate: date(1, 10),
      periodLabel: "5월 금통위",
      importance: "high",
      status: "scheduled",
      relatedMarkets: ["KR_BOND", "USDKRW", "BANK", "REAL_ESTATE"],
      keywords: ["한국은행", "기준금리", "금통위", "통화정책", "채권", "대출금리"],
      sourceName: "BOK ECOS / config",
      sourceStatus: "API 키 연결 전, config 일정 기준",
      actualValue: null,
      previousValue: 3.5,
      unit: "%",
      interpretation: {
        up: "기준금리 인상은 채권금리와 대출금리 부담을 키우고 부동산 및 가계소비에 압박으로 작용할 수 있습니다.",
        down: "기준금리 인하는 경기 부양 기대를 높일 수 있으나 은행 순이자마진에는 부담이 될 수 있습니다.",
        flat: "기준금리 동결은 물가와 경기 사이에서 관망 기조가 유지되는 신호입니다."
      },
      series: buildSeries(3.55, -0.01, 0.04)
    },
    {
      code: "KR_CPI",
      nameKo: "한국 CPI",
      nameEn: "Korea Consumer Price Index",
      country: "KR",
      category: "inflation",
      description: "한국 소비자물가는 한국은행 통화정책과 실질소비 흐름을 판단하는 핵심 지표입니다.",
      eventDate: date(-6, 8),
      periodLabel: "4월",
      importance: "high",
      status: "released",
      relatedMarkets: ["KR_BOND", "USDKRW", "KOSPI", "BANK_LOAN_RATE"],
      keywords: ["소비자물가", "물가", "근원물가", "생활물가", "통계청", "한국은행", "기준금리"],
      sourceName: "KOSIS / KOSTAT",
      sourceStatus: "MVP 샘플 데이터",
      actualValue: 2.1,
      previousValue: 2.3,
      unit: "%",
      interpretation: {
        up: "한국 CPI 상승은 한국은행의 금리 인하 여지를 제한하고 채권시장과 가계소비에 부담으로 작용할 수 있습니다.",
        down: "한국 CPI 둔화는 물가 부담 완화 신호이나 경기 둔화와 동반되는지 함께 확인해야 합니다.",
        flat: "물가 보합은 추가 지표 확인 전까지 통화정책 기대를 크게 바꾸기 어렵습니다."
      },
      series: buildSeries(2.8, -0.05, 0.18)
    },
    {
      code: "US_CPI",
      nameKo: "미국 CPI",
      nameEn: "US Consumer Price Index",
      country: "US",
      category: "inflation",
      description: "미국 CPI는 Fed 금리 기대, 미국 국채금리, 달러, 원/달러 환율에 영향을 주는 핵심 이벤트입니다.",
      eventDate: date(-1, 21, 30),
      periodLabel: "4월",
      importance: "high",
      status: "released",
      relatedMarkets: ["USDKRW", "US10Y", "KR_BOND", "KOSPI", "NASDAQ"],
      keywords: ["CPI", "Consumer Price Index", "inflation", "core CPI", "미국 물가", "인플레이션", "Fed", "금리 인하"],
      sourceName: "BLS / FRED",
      sourceStatus: "MVP 샘플 데이터",
      actualValue: 3.4,
      previousValue: 3.2,
      unit: "%",
      interpretation: {
        up: "미국 CPI 상승은 Fed 금리 인하 기대를 약화시키고 달러 및 금리 상승 압력으로 작용할 수 있습니다.",
        down: "미국 CPI 둔화는 Fed 금리 인하 기대를 강화하고 달러 강세 압력을 완화할 수 있습니다.",
        flat: "미국 CPI 보합은 시장이 근원물가와 Fed 발언을 추가로 확인하게 만드는 구간입니다."
      },
      series: buildSeries(3.7, -0.03, 0.22)
    },
    {
      code: "KR_EXPORTS",
      nameKo: "한국 수출입",
      nameEn: "Korea Exports and Trade Balance",
      country: "KR",
      category: "trade",
      description: "한국 수출입 지표는 제조업 경기, 무역수지, 원화 흐름, 반도체 업황 판단에 중요합니다.",
      eventDate: date(6, 9),
      dateOnly: true,
      periodLabel: "5월 1~20일",
      importance: "high",
      status: "scheduled",
      relatedMarkets: ["USDKRW", "KOSPI", "SEMICONDUCTOR", "AUTO"],
      keywords: ["수출", "수입", "무역수지", "반도체", "자동차", "관세청", "산업통상부"],
      sourceName: "Customs / data.go.kr",
      sourceStatus: "API 키 연결 필요",
      actualValue: null,
      previousValue: 12.8,
      unit: "%",
      interpretation: {
        up: "수출 증가는 제조업 경기와 외화 유입 측면에서 긍정적이며 국내 증시와 원화 흐름에 우호적일 수 있습니다.",
        down: "수출 감소는 대외 수요 둔화와 원화 약세 압력으로 이어질 수 있습니다.",
        flat: "수출 보합은 품목별 차별화와 반도체 회복 여부를 따로 확인해야 합니다."
      },
      series: buildSeries(5.2, 0.62, 1.2)
    },
    {
      code: "FOMC",
      nameKo: "미국 FOMC",
      nameEn: "Federal Open Market Committee",
      country: "US",
      category: "policy",
      description: "FOMC 결과와 성명서 문구는 글로벌 달러 유동성, 미국 국채금리, 국내 채권시장에 직접적인 영향을 줍니다.",
      eventDate: date(4, 3),
      periodLabel: "5월 FOMC",
      importance: "high",
      status: "scheduled",
      relatedMarkets: ["USDKRW", "US10Y", "KOSPI", "NASDAQ", "KR_BOND"],
      keywords: ["FOMC", "Fed", "Federal Reserve", "Powell", "점도표", "SEP", "의사록", "금리 동결", "금리 인하"],
      sourceName: "Federal Reserve calendar",
      sourceStatus: "config 일정 기준",
      actualValue: null,
      previousValue: 5.25,
      unit: "%",
      interpretation: {
        up: "FOMC 인상은 달러와 미국 금리 상승 요인으로 국내 환율과 채권시장에 부담이 될 수 있습니다.",
        down: "FOMC 인하는 위험자산 선호를 자극할 수 있으나 경기 둔화 신호인지 함께 봐야 합니다.",
        flat: "FOMC 동결은 성명서와 기자회견의 매파·비둘기파 뉘앙스가 핵심입니다."
      },
      series: buildSeries(5.4, -0.01, 0.03)
    },
    {
      code: "US_NFP",
      nameKo: "미국 고용지표",
      nameEn: "US Nonfarm Payrolls",
      country: "US",
      category: "employment",
      description: "미국 고용은 Fed 정책 기대와 글로벌 위험자산 선호를 움직이는 대표 지표입니다.",
      eventDate: date(-5, 21, 30),
      periodLabel: "4월",
      importance: "medium",
      status: "released",
      relatedMarkets: ["US10Y", "USDKRW", "NASDAQ", "KOSPI"],
      keywords: ["고용", "비농업", "실업률", "임금", "payroll", "jobs", "labor market"],
      sourceName: "BLS",
      sourceStatus: "MVP 샘플 데이터",
      actualValue: 175,
      previousValue: 303,
      unit: "K",
      interpretation: {
        up: "고용 증가는 경기 견조 신호지만 임금 압력과 금리 부담을 키울 수 있습니다.",
        down: "고용 둔화는 금리 인하 기대를 키울 수 있으나 경기 둔화 리스크도 함께 부각됩니다.",
        flat: "고용 보합은 임금과 실업률 세부 지표 확인이 필요합니다."
      },
      series: buildSeries(210, -2.4, 38)
    },
    {
      code: "US_PCE",
      nameKo: "미국 PCE",
      nameEn: "US Personal Consumption Expenditures Price Index",
      country: "US",
      category: "inflation",
      description: "미국 PCE는 Fed가 중시하는 물가 지표로 금리 기대와 달러 흐름에 영향을 줍니다.",
      eventDate: date(7, 21, 30),
      periodLabel: "4월",
      importance: "high",
      status: "scheduled",
      relatedMarkets: ["USDKRW", "US10Y", "NASDAQ", "KR_BOND"],
      keywords: ["PCE", "core PCE", "개인소비지출", "Fed", "inflation", "물가"],
      sourceName: "BEA",
      sourceStatus: "API 키 연결 필요",
      actualValue: null,
      previousValue: 2.8,
      unit: "%",
      interpretation: {
        up: "PCE 상승은 Fed의 금리 인하 기대를 약화시키고 달러와 금리에 부담으로 작용할 수 있습니다.",
        down: "PCE 둔화는 인플레이션 압력 완화와 금리 인하 기대를 강화할 수 있습니다.",
        flat: "PCE 보합은 서비스 물가와 소비 지출 세부 항목 확인이 필요합니다."
      },
      series: buildSeries(3.1, -0.03, 0.16)
    },
    {
      code: "US10Y",
      nameKo: "미국 10년물 국채금리",
      nameEn: "US 10-Year Treasury Yield",
      country: "US",
      category: "market",
      description: "미국 10년물 금리는 글로벌 할인율과 달러 흐름, 국내 채권금리의 기준점으로 작동합니다.",
      eventDate: date(0, 7),
      periodLabel: "일일",
      importance: "medium",
      status: "released",
      relatedMarkets: ["USDKRW", "KR_BOND", "KOSPI", "NASDAQ"],
      keywords: ["미국 10년물", "US10Y", "Treasury", "국채금리", "채권금리", "금리"],
      sourceName: "FRED",
      sourceStatus: "MVP 샘플 데이터",
      actualValue: 4.48,
      previousValue: 4.42,
      unit: "%",
      interpretation: {
        up: "미국 10년물 금리 상승은 성장주 밸류에이션과 국내 채권시장에 부담으로 작용할 수 있습니다.",
        down: "미국 10년물 금리 하락은 할인율 부담 완화와 위험자산 선호에 우호적일 수 있습니다.",
        flat: "미국 10년물 금리 보합은 다음 물가·고용 이벤트 전 관망으로 해석할 수 있습니다."
      },
      series: buildSeries(4.1, 0.03, 0.18)
    }
  ];
}

function StatusBadge({ status }: { status: EventStatus }) {
  const className =
    status === "released"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "scheduled"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
        : status === "delayed"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
  return <Badge className={className}>{statusLabel[status]}</Badge>;
}

function ImportanceBadge({ importance }: { importance: Importance }) {
  const className =
    importance === "high"
      ? "bg-primary/15 text-primary"
      : importance === "medium"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return <Badge className={className}>{importanceLabel[importance]}</Badge>;
}

function DirectionBadge({ direction }: { direction: Direction }) {
  return (
    <Badge
      className={cn(
        "gap-1",
        direction === "up" && "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
        direction === "down" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        direction === "flat" && "bg-muted text-muted-foreground"
      )}
    >
      {directionIcon(direction)}
      {directionLabel(direction)}
    </Badge>
  );
}

function ApiStatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">연결됨</Badge>;
  }
  if (status === "missing") {
    return <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">키 없음</Badge>;
  }
  return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">오류</Badge>;
}

function sourceKeysForEvent(code: string) {
  const map: Record<string, string[]> = {
    KR_BASE_RATE: ["bok_ecos"],
    KR_CPI: ["kosis"],
    US_CPI: ["bls", "fred"],
    KR_EXPORTS: ["data_go_kr"],
    FOMC: ["fred"],
    US_NFP: ["bls"],
    US_PCE: ["fred", "bea"],
    US10Y: ["fred"]
  };
  return map[code] || [];
}

function RelatedSourceStatus({ event, apiStatuses }: { event: IndicatorEvent; apiStatuses: EconomicApiStatus[] }) {
  const keys = sourceKeysForEvent(event.code);
  const matched = apiStatuses.filter((status) => keys.includes(status.source));
  if (matched.length === 0) {
    return (
      <div className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
        이 일정은 config 기반 보완 항목입니다. 공식 API 일정 수집기는 이후 확장할 수 있습니다.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {matched.map((source) => (
        <div key={source.source} className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{source.label}</span>
            <ApiStatusBadge status={source.status} />
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{source.message}</div>
          {source.sample ? <div className="mt-1 text-xs text-muted-foreground">샘플: {source.sample}</div> : null}
        </div>
      ))}
    </div>
  );
}

function relationScore(article: Article, event: IndicatorEvent) {
  const text = [article.title, article.translated_title, article.summary, article.tags.join(" ")].join(" ").toLowerCase();
  const matched = event.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  if (matched.length === 0) return null;
  return {
    article,
    matched,
    score: matched.length * 0.5 + article.importance_score * 0.3 + (article.is_bok_related ? 0.1 : 0)
  };
}

function getRelatedArticles(event: IndicatorEvent, articles: Article[]) {
  return articles
    .map((article) => relationScore(article, event))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof CalendarClock }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-semibold">{value}</div>
        </div>
        <Icon className="text-primary" size={22} />
      </div>
    </Card>
  );
}

function IndicatorDetailModal({ event, articles, apiStatuses, onClose }: { event: IndicatorEvent; articles: Article[]; apiStatuses: EconomicApiStatus[]; onClose: () => void }) {
  const direction = directionOf(event);
  const related = getRelatedArticles(event, articles);
  const liveObservation = hasLiveObservation(event.observation);
  const dataBadge = liveObservation ? (
    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">실데이터</Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">샘플 결과</Badge>
  );
  const interpretation = direction === "none" ? "아직 실제치가 없어 발표 후 이전치 또는 최근 추세와 비교해 해석해야 합니다." : event.interpretation[direction];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="max-h-[88vh] w-full max-w-5xl overflow-y-auto p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{event.country}</Badge>
              <ImportanceBadge importance={event.importance} />
              <StatusBadge status={event.status} />
            </div>
            <h2 className="mt-3 text-2xl font-semibold">{event.nameKo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{event.nameEn}</p>
          </div>
          <GhostButton onClick={onClose}>닫기</GhostButton>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card className="p-4 shadow-none">
              <h3 className="mb-2 text-base font-semibold">지표 설명</h3>
              <p className="text-sm leading-6 text-muted-foreground">{event.description}</p>
            </Card>

            <Card className="p-4 shadow-none">
              <div className="mb-3 flex items-center gap-2">
                <LineChartIcon size={17} className="text-primary" />
                <h3 className="text-base font-semibold">최근 1년 추이</h3>
                {dataBadge}
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={event.series} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
                    <XAxis
                      dataKey="label"
                      tickFormatter={(value) => chartMonthLabel(value)}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#334155", fontSize: 12, fontWeight: 600 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#334155", fontSize: 12, fontWeight: 600 }}
                      width={42}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}${event.unit}`, event.nameKo]}
                      labelFormatter={(value) => chartMonthLabel(String(value))}
                      contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, color: "#0f172a", boxShadow: "0 8px 24px rgb(15 23 42 / 0.16)" }}
                      labelStyle={{ color: "#0f172a", fontWeight: 700 }}
                      itemStyle={{ color: "#0f172a" }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 shadow-none">
              <h3 className="mb-2 text-base font-semibold">자동 해석</h3>
              <p className="text-sm leading-6 text-muted-foreground">{interpretation}</p>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="p-4 shadow-none">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">최근 발표 정보</h3>
                {dataBadge}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">발표일</span><b>{formatDateTime(event.eventDate, event.dateOnly)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">대상 기간</span><b>{event.periodLabel}</b></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">실제치</span><b>{formatActualValue(event)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">이전치</span><b>{formatValue(event.previousValue, event.unit)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">방향</span><DirectionBadge direction={direction} /></div>
              </div>
            </Card>

            <Card className="p-4 shadow-none">
              <h3 className="mb-3 text-base font-semibold">관련 시장</h3>
              <div className="flex flex-wrap gap-2">
                {event.relatedMarkets.map((market) => <Badge key={market}>{market}</Badge>)}
              </div>
            </Card>

            <Card className="p-4 shadow-none">
              <h3 className="mb-3 text-base font-semibold">데이터 소스</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">소스</span><b>{event.sourceName}</b></div>
                <RelatedSourceStatus event={event} apiStatuses={apiStatuses} />
              </div>
            </Card>
          </aside>
        </div>

        <Card className="mt-4 p-4 shadow-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">관련 뉴스</h3>
            <Badge>{related.length}건</Badge>
          </div>
          {related.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {related.map(({ article, matched }) => (
                <Link key={article.id} to={`/articles/${article.id}`} className="rounded-md border border-border p-3 transition hover:border-primary/60 hover:bg-muted/40">
                  <div className="line-clamp-2 text-sm font-semibold">{article.translated_title || article.title}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{article.source_name}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {matched.slice(0, 3).map((keyword) => <Badge key={keyword}>{keyword}</Badge>)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">현재 수집된 기사 중 직접 매칭되는 뉴스가 없습니다.</p>
          )}
        </Card>
      </Card>
    </div>
  );
}

export default function EconomicIndicatorsPage() {
  const [selected, setSelected] = useState<IndicatorEvent | null>(null);
  const today = useMemo(() => new Date(), []);
  const { data: articleData } = useQuery({ queryKey: ["indicator-related-articles"], queryFn: () => api.articles({ limit: 120 }) });
  const { data: apiStatuses = [], isLoading: apiStatusLoading, refetch: refetchApiStatus, isFetching: apiStatusFetching } = useQuery({
    queryKey: ["economic-api-status"],
    queryFn: api.economicApiStatus,
    staleTime: 1000 * 60 * 5
  });
  const articles = articleData?.items || [];
  const baseEvents = useMemo(() => {
    const start = addDays(today, -7);
    const end = addDays(today, 7);
    return buildEvents(today)
      .filter((event) => event.eventDate >= start && event.eventDate <= end)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [today]);
  const eventCodes = useMemo(() => baseEvents.map((event) => event.code), [baseEvents]);
  const { data: observationRows = [], isLoading: observationsLoading, isFetching: observationsFetching } = useQuery({
    queryKey: ["economic-indicator-observations", eventCodes.join(",")],
    queryFn: () => api.economicIndicatorObservations(eventCodes),
    enabled: eventCodes.length > 0,
    staleTime: 1000 * 60 * 10
  });
  const isInitialObservationLoading = observationsLoading || (observationsFetching && observationRows.length === 0);
  const observationMap = useMemo(() => {
    return Object.fromEntries(observationRows.map((row) => [row.code, row] as const));
  }, [observationRows]);
  const events = useMemo(() => {
    if (isInitialObservationLoading) return baseEvents;
    return baseEvents.map((event) => applyObservation(event, observationMap[event.code]));
  }, [baseEvents, isInitialObservationLoading, observationMap]);

  const summary = {
    today: events.filter((event) => event.eventDate.toDateString() === today.toDateString()).length,
    released: events.filter((event) => event.status === "released").length,
    highImpact: events.filter((event) => event.importance === "high").length,
    manual: events.filter((event) => event.status === "manual_check_required").length
  };
  const connectedApiCount = apiStatuses.filter((source) => source.configured && source.status === "connected").length;
  const configuredApiCount = apiStatuses.filter((source) => source.configured).length;
  const errorApiCount = apiStatuses.filter((source) => source.configured && source.status === "error").length;
  const sortedApiStatuses = [...apiStatuses].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    if (a.status !== b.status) return a.status === "connected" ? -1 : b.status === "connected" ? 1 : a.status.localeCompare(b.status);
    return a.label.localeCompare(b.label);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">주요 경제 지표</h1>
          <p className="mt-1 text-sm text-muted-foreground">오늘 기준 D-7 ~ D+7 발표 일정과 실제치, 시장 영향 해석을 함께 봅니다.</p>
        </div>
        <GhostButton onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>
          <Info size={16} /> 데이터 소스 상태
        </GhostButton>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="오늘 발표" value={summary.today} icon={CalendarClock} />
        <SummaryCard label="발표 완료" value={summary.released} icon={CheckCircle2} />
        <SummaryCard label="시장 영향 큰 지표" value={summary.highImpact} icon={ShieldAlert} />
        <SummaryCard label="수동 확인 필요" value={summary.manual} icon={Search} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="text-lg font-semibold">이번 주 주요 지표</h2>
          <p className="mt-1 text-sm text-muted-foreground">일정은 config 보완과 공식 API 연동을 분리해서 관리하며, 실제 연결 상태는 하단에서 확인합니다.</p>
          {isInitialObservationLoading ? (
            <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
              공식 API에서 지표 정보를 가져오는 중입니다. 불러오기가 끝난 뒤 실데이터가 없거나 미설정인 지표만 샘플 데이터로 표시합니다.
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1240px] w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">일시</th>
                <th className="whitespace-nowrap px-4 py-3">국가</th>
                <th className="whitespace-nowrap px-4 py-3">지표</th>
                <th className="whitespace-nowrap px-4 py-3">중요도</th>
                <th className="whitespace-nowrap px-4 py-3">상태</th>
                <th className="whitespace-nowrap px-4 py-3">실제치</th>
                <th className="whitespace-nowrap px-4 py-3">이전치</th>
                <th className="whitespace-nowrap px-4 py-3">방향</th>
                <th className="whitespace-nowrap px-4 py-3">관련 시장</th>
                <th className="whitespace-nowrap px-4 py-3">연결 뉴스</th>
                <th className="whitespace-nowrap px-4 py-3">상세</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const related = getRelatedArticles(event, articles);
                const direction = directionOf(event);
                return (
                  <tr key={event.code} className="border-t border-border align-top hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(event.eventDate, event.dateOnly)}</td>
                    <td className="px-4 py-3"><Badge>{event.country}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap font-semibold">{event.nameKo}</div>
                      <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{categoryLabel[event.category] || event.category} · {event.periodLabel}</div>
                    </td>
                    <td className="px-4 py-3"><ImportanceBadge importance={event.importance} /></td>
                    <td className="px-4 py-3"><StatusBadge status={event.status} /></td>
                    <td className="px-4 py-3 font-medium">{isInitialObservationLoading ? <LoadingValue /> : formatActualValue(event)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{isInitialObservationLoading ? <LoadingValue /> : formatValue(event.previousValue, event.unit)}</td>
                    <td className="px-4 py-3">
                      {isInitialObservationLoading ? <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">확인 중</Badge> : <DirectionBadge direction={direction} />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {event.relatedMarkets.slice(0, 3).map((market) => <Badge key={market}>{market}</Badge>)}
                        {event.relatedMarkets.length > 3 ? <Badge>+{event.relatedMarkets.length - 3}</Badge> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{related.length}건</td>
                    <td className="px-4 py-3">
                      <Button onClick={() => setSelected(event)} className="h-8 min-w-12 whitespace-nowrap px-3">보기</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-3">
        {events.filter((event) => event.importance === "high").slice(0, 3).map((event) => {
          const direction = directionOf(event);
          const interpretation = direction === "none" ? "발표 전 구간입니다. 예정 시각 이후 실제치와 이전치를 비교해 시장 영향을 확인해야 합니다." : event.interpretation[direction];
          return (
            <Card key={event.code} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Badge>{event.country}</Badge>
                {isInitialObservationLoading ? <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">확인 중</Badge> : <DirectionBadge direction={direction} />}
              </div>
              <h3 className="text-base font-semibold">{event.nameKo}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{interpretation}</p>
              <button className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary" onClick={() => setSelected(event)}>
                상세 보기 <ExternalLink size={14} />
              </button>
            </Card>
          );
        })}
      </section>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">데이터 소스 상태</h2>
            <p className="mt-1 text-sm text-muted-foreground">.env에 입력한 API 키 기준으로 실제 테스트 요청을 보내 연결 가능 여부를 확인합니다.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">연결 {connectedApiCount}/{configuredApiCount || apiStatuses.length}</Badge>
              {errorApiCount > 0 ? <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">오류 {errorApiCount}</Badge> : null}
            </div>
          </div>
          <GhostButton onClick={() => refetchApiStatus()} disabled={apiStatusFetching}>
            <RefreshCw size={15} className={cn(apiStatusFetching && "animate-spin")} />
            상태 새로고침
          </GhostButton>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {apiStatusLoading && apiStatuses.length === 0 ? (
            <div className="text-sm text-muted-foreground">경제 데이터 API 연결 상태를 확인하는 중입니다.</div>
          ) : (
            sortedApiStatuses.map((source) => (
              <div key={source.source} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{source.label}</div>
                  <ApiStatusBadge status={source.status} />
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{source.message}</div>
                {source.sample ? <div className="mt-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{source.sample}</div> : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {selected ? <IndicatorDetailModal event={selected} articles={articles} apiStatuses={apiStatuses} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
