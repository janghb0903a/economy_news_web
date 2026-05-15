import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Info, LineChart as LineChartIcon, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
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

type SummaryModalState = {
  label: string;
  value: number;
  icon: typeof CalendarClock;
  items: IndicatorEvent[];
} | null;

type HeaderBlockProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  compact?: boolean;
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

function ActualValueCell({ event, loading }: { event: IndicatorEvent; loading: boolean }) {
  if (loading) return <LoadingValue />;
  const value = formatActualValue(event);
  const isEmpty = value === "-";
  return (
    <span
      className={cn(
        "inline-flex min-w-[66px] items-center justify-center rounded-md border px-2.5 py-1 text-sm font-bold shadow-sm",
        isEmpty
          ? "border-border bg-muted text-muted-foreground"
          : "border-primary/25 bg-primary/10 text-primary dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200"
      )}
    >
      {value}
    </span>
  );
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

function normalizeMonthlySeries(
  event: IndicatorEvent,
  rows: { label: string; date?: string | null; value: number }[]
) {
  const byMonth = new Map<string, { label: string; date?: string | null; value: number; sortTime: number }>();
  rows.forEach((point, index) => {
    const pointDate = parseSeriesDate(point, event);
    if (!pointDate) {
      const fallbackKey = `unknown-${index}`;
      byMonth.set(fallbackKey, { ...point, label: chartMonthLabel(point.label), sortTime: index });
      return;
    }
    const key = `${pointDate.getFullYear()}-${String(pointDate.getMonth() + 1).padStart(2, "0")}`;
    const sortTime = pointDate.getTime();
    const existing = byMonth.get(key);
    if (!existing || sortTime >= existing.sortTime) {
      byMonth.set(key, {
        label: `${pointDate.getMonth() + 1}월`,
        date: point.date,
        value: point.value,
        sortTime
      });
    }
  });
  return Array.from(byMonth.values())
    .sort((a, b) => a.sortTime - b.sortTime)
    .slice(-12)
    .map(({ sortTime: _sortTime, ...point }) => point);
}

function applyObservation(event: IndicatorEvent, observation?: EconomicIndicatorObservation): IndicatorEvent {
  if (!hasLiveObservation(observation)) {
    return observation ? { ...event, observation } : event;
  }
  const rawSeries = observation.series.map((point) => ({ label: point.label, date: point.date, value: point.value }));
  const series = normalizeMonthlySeries(event, rawSeries);
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
  const fixedDate = (year: number, month: number, day: number, hour: number, minute = 0) => {
    const next = new Date(year, month - 1, day);
    next.setHours(hour, minute, 0, 0);
    return next;
  };
  const events: IndicatorEvent[] = [
    {
      code: "KR_BASE_RATE",
      nameKo: "한국 기준금리",
      nameEn: "Bank of Korea Base Rate",
      country: "KR",
      category: "rates",
      description: "한국은행 기준금리 결정은 국내 채권금리, 대출금리, 은행 수익성, 부동산 심리에 직접적인 영향을 줍니다.",
      eventDate: fixedDate(2026, 5, 28, 10),
      periodLabel: "5월 금통위",
      importance: "high",
      status: "scheduled",
      relatedMarkets: ["KR_BOND", "USDKRW", "BANK", "REAL_ESTATE"],
      keywords: ["한국은행", "기준금리", "금통위", "통화정책", "채권", "대출금리"],
      sourceName: "BOK ECOS / config",
      sourceStatus: "API 키 연결 전, config 일정 기준",
      actualValue: null,
      previousValue: 2.5,
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
      eventDate: fixedDate(2026, 5, 4, 8),
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
      eventDate: fixedDate(2026, 5, 12, 21, 30),
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
      eventDate: fixedDate(2026, 5, 21, 9),
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
      eventDate: fixedDate(2026, 6, 18, 3),
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
      eventDate: fixedDate(2026, 5, 8, 21, 30),
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
      eventDate: fixedDate(2026, 5, 29, 21, 30),
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

  const setSchedule = (code: string, schedules: Array<{ eventDate: Date; periodLabel: string; status?: EventStatus; dateOnly?: boolean }>) => {
    const base = events.find((event) => event.code === code);
    if (!base) return;
    schedules.forEach((schedule) => {
      const exists = events.some((event) => event.code === code && event.eventDate.getTime() === schedule.eventDate.getTime());
      if (exists) {
        events.forEach((event) => {
          if (event.code === code && event.eventDate.getTime() === schedule.eventDate.getTime()) {
            event.periodLabel = schedule.periodLabel;
            event.status = schedule.status ?? (schedule.eventDate.getTime() <= today.getTime() ? "released" : "scheduled");
            event.dateOnly = schedule.dateOnly;
          }
        });
        return;
      }
      events.push({
        ...base,
        eventDate: schedule.eventDate,
        periodLabel: schedule.periodLabel,
        status: schedule.status ?? (schedule.eventDate.getTime() <= today.getTime() ? "released" : "scheduled"),
        dateOnly: schedule.dateOnly
      });
    });
  };

  setSchedule("KR_BASE_RATE", [
    { eventDate: fixedDate(2026, 1, 15, 10), periodLabel: "1월 금통위" },
    { eventDate: fixedDate(2026, 2, 25, 10), periodLabel: "2월 금통위" },
    { eventDate: fixedDate(2026, 4, 10, 10), periodLabel: "4월 금통위" },
    { eventDate: fixedDate(2026, 5, 28, 10), periodLabel: "5월 금통위" },
    { eventDate: fixedDate(2026, 7, 9, 10), periodLabel: "7월 금통위" },
    { eventDate: fixedDate(2026, 8, 27, 10), periodLabel: "8월 금통위" },
    { eventDate: fixedDate(2026, 10, 1, 10), periodLabel: "10월 금통위" },
    { eventDate: fixedDate(2026, 11, 26, 10), periodLabel: "11월 금통위" }
  ]);

  setSchedule("US_CPI", [
    { eventDate: fixedDate(2026, 1, 13, 22, 30), periodLabel: "2025년 12월" },
    { eventDate: fixedDate(2026, 2, 13, 22, 30), periodLabel: "1월" },
    { eventDate: fixedDate(2026, 3, 11, 21, 30), periodLabel: "2월" },
    { eventDate: fixedDate(2026, 4, 10, 21, 30), periodLabel: "3월" },
    { eventDate: fixedDate(2026, 5, 12, 21, 30), periodLabel: "4월" },
    { eventDate: fixedDate(2026, 6, 10, 21, 30), periodLabel: "5월" },
    { eventDate: fixedDate(2026, 7, 14, 21, 30), periodLabel: "6월" },
    { eventDate: fixedDate(2026, 8, 12, 21, 30), periodLabel: "7월" },
    { eventDate: fixedDate(2026, 9, 11, 21, 30), periodLabel: "8월" },
    { eventDate: fixedDate(2026, 10, 14, 21, 30), periodLabel: "9월" },
    { eventDate: fixedDate(2026, 11, 10, 22, 30), periodLabel: "10월" },
    { eventDate: fixedDate(2026, 12, 10, 22, 30), periodLabel: "11월" }
  ]);

  setSchedule("US_NFP", [
    { eventDate: fixedDate(2026, 1, 9, 22, 30), periodLabel: "2025년 12월" },
    { eventDate: fixedDate(2026, 2, 11, 22, 30), periodLabel: "1월" },
    { eventDate: fixedDate(2026, 3, 6, 22, 30), periodLabel: "2월" },
    { eventDate: fixedDate(2026, 4, 3, 21, 30), periodLabel: "3월" },
    { eventDate: fixedDate(2026, 5, 8, 21, 30), periodLabel: "4월" },
    { eventDate: fixedDate(2026, 6, 5, 21, 30), periodLabel: "5월" },
    { eventDate: fixedDate(2026, 7, 2, 21, 30), periodLabel: "6월" },
    { eventDate: fixedDate(2026, 8, 7, 21, 30), periodLabel: "7월" },
    { eventDate: fixedDate(2026, 9, 4, 21, 30), periodLabel: "8월" },
    { eventDate: fixedDate(2026, 10, 2, 21, 30), periodLabel: "9월" },
    { eventDate: fixedDate(2026, 11, 6, 22, 30), periodLabel: "10월" },
    { eventDate: fixedDate(2026, 12, 4, 22, 30), periodLabel: "11월" }
  ]);

  setSchedule("FOMC", [
    { eventDate: fixedDate(2026, 1, 29, 4), periodLabel: "1월 FOMC" },
    { eventDate: fixedDate(2026, 3, 19, 3), periodLabel: "3월 FOMC" },
    { eventDate: fixedDate(2026, 4, 30, 3), periodLabel: "4월 FOMC" },
    { eventDate: fixedDate(2026, 6, 18, 3), periodLabel: "6월 FOMC" },
    { eventDate: fixedDate(2026, 7, 30, 3), periodLabel: "7월 FOMC" },
    { eventDate: fixedDate(2026, 9, 17, 3), periodLabel: "9월 FOMC" },
    { eventDate: fixedDate(2026, 10, 29, 3), periodLabel: "10월 FOMC" },
    { eventDate: fixedDate(2026, 12, 10, 4), periodLabel: "12월 FOMC" }
  ]);

  setSchedule("US_PCE", [
    { eventDate: fixedDate(2026, 1, 22, 24), periodLabel: "2025년 10~11월" },
    { eventDate: fixedDate(2026, 2, 20, 22, 30), periodLabel: "2025년 12월" },
    { eventDate: fixedDate(2026, 3, 13, 21, 30), periodLabel: "1월" },
    { eventDate: fixedDate(2026, 4, 9, 21, 30), periodLabel: "2월" },
    { eventDate: fixedDate(2026, 4, 30, 21, 30), periodLabel: "3월" },
    { eventDate: fixedDate(2026, 5, 28, 21, 30), periodLabel: "4월" },
    { eventDate: fixedDate(2026, 6, 25, 21, 30), periodLabel: "5월" },
    { eventDate: fixedDate(2026, 7, 30, 21, 30), periodLabel: "6월" },
    { eventDate: fixedDate(2026, 8, 26, 21, 30), periodLabel: "7월" },
    { eventDate: fixedDate(2026, 9, 30, 21, 30), periodLabel: "8월" },
    { eventDate: fixedDate(2026, 10, 29, 21, 30), periodLabel: "9월" },
    { eventDate: fixedDate(2026, 11, 25, 22, 30), periodLabel: "10월" },
    { eventDate: fixedDate(2026, 12, 23, 22, 30), periodLabel: "11월" }
  ]);

  setSchedule("KR_CPI", [
    { eventDate: fixedDate(2026, 5, 4, 8), periodLabel: "4월" }
  ]);

  setSchedule("KR_EXPORTS", [
    { eventDate: fixedDate(2026, 5, 1, 9), periodLabel: "4월 전체" },
    { eventDate: fixedDate(2026, 5, 11, 9), periodLabel: "5월 1~10일" },
    { eventDate: fixedDate(2026, 5, 21, 9), periodLabel: "5월 1~20일" }
  ]);

  return events.sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
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
      ? "border border-rose-200 bg-gradient-to-r from-orange-100 to-rose-100 text-rose-800 shadow-sm dark:border-rose-900/70 dark:from-orange-950 dark:to-rose-950 dark:text-rose-200"
      : importance === "medium"
        ? "border border-amber-200 bg-gradient-to-r from-yellow-50 to-amber-100 text-amber-800 dark:border-amber-900/70 dark:from-yellow-950 dark:to-amber-950 dark:text-amber-200"
        : "border border-emerald-200 bg-gradient-to-r from-emerald-50 to-lime-100 text-emerald-800 dark:border-emerald-900/70 dark:from-emerald-950 dark:to-lime-950 dark:text-emerald-200";
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

function HeaderBlock({ title, description, actions, compact = false }: HeaderBlockProps) {
  const Heading = compact ? "h2" : "h1";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading className={cn("heading-title", compact ? "heading-title-section" : "heading-title-page")}>{title}</Heading>
        <p className={cn("heading-description", compact && "heading-description-section")}>{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  items = [],
  onOpen
}: {
  label: string;
  value: number;
  icon: typeof CalendarClock;
  items?: IndicatorEvent[];
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full rounded-md text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
      aria-label={`${label} 목록 보기`}
    >
      <Card className="relative overflow-hidden p-4 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/60 group-hover:bg-primary/5 group-hover:shadow-lg group-hover:shadow-primary/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/70 via-sky-400/70 to-lime-400/70 opacity-0 transition group-hover:opacity-100" />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-semibold">{value}</div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition group-hover:bg-primary group-hover:text-primary-foreground">
              클릭해서 목록 보기
            </div>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon size={22} />
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">{items.length > 0 ? `관련 지표 ${items.length}개` : "해당 지표 없음"}</div>
      </Card>
    </button>
  );
}

function SummaryListModal({
  data,
  onClose,
  onSelect
}: {
  data: NonNullable<SummaryModalState>;
  onClose: () => void;
  onSelect: (event: IndicatorEvent) => void;
}) {
  const Icon = data.icon;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="border-b border-border bg-muted/35 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Icon size={21} />
              </span>
              <div>
                <div className="text-sm font-semibold text-primary">{data.label}</div>
                <h3 className="text-xl font-semibold">지표 목록 {data.value}개</h3>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="닫기">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-5">
          {data.items.length > 0 ? (
            <div className="grid gap-2">
              {data.items.map((event) => (
                <button
                  key={eventKey(event)}
                  type="button"
                  onClick={() => onSelect(event)}
                  className="group rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/60 hover:bg-primary/5 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">{event.country}</span>
                        <span className="text-base font-semibold group-hover:text-primary">{event.nameKo}</span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{event.category} · {event.periodLabel}</div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-semibold">{formatDateTime(event.eventDate, event.dateOnly)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">클릭하여 상세 보기</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ImportanceBadge importance={event.importance} />
                    <StatusBadge status={event.status} />
                    <DirectionBadge direction={directionOf(event)} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">해당 조건의 지표가 없습니다.</div>
          )}
        </div>
        <div className="flex justify-end border-t border-border bg-muted/25 px-5 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-border bg-background px-4 text-sm font-semibold transition hover:bg-muted">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function calendarMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
}

function sameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventKey(event: IndicatorEvent) {
  return `${event.code}-${event.eventDate.toISOString()}-${event.periodLabel}`;
}

function buildCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const prefixBlanks = firstDay.getDay();
  const monthDays = Array.from({ length: lastDay.getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
  return [...Array.from({ length: prefixBlanks }, () => null), ...monthDays];
}

function CalendarScheduleModal({
  events,
  month,
  onMonthChange,
  onClose,
  onSelect
}: {
  events: IndicatorEvent[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onClose: () => void;
  onSelect: (event: IndicatorEvent) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingYear, setPendingYear] = useState(month.getFullYear());
  const [pendingMonth, setPendingMonth] = useState(month.getMonth());
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const days = buildCalendarDays(month);
  const today = new Date();
  const eventsByDay = useMemo(() => {
    const map = new Map<string, IndicatorEvent[]>();
    events.forEach((event) => {
      const key = event.eventDate.toDateString();
      map.set(key, [...(map.get(key) || []), event]);
    });
    return map;
  }, [events]);
  const moveMonth = (offset: number) => {
    setPickerOpen(false);
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  };
  const years = Array.from({ length: 11 }, (_, index) => today.getFullYear() - 5 + index);
  const months = Array.from({ length: 12 }, (_, index) => index);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
      <Card className="max-h-[94vh] w-full max-w-6xl overflow-hidden shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <HeaderBlock
            compact
            title="경제 지표 발표 캘린더"
            description="월별 발표 예정 지표와 발표 완료 지표를 일정표로 확인합니다."
            actions={
              <button className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" onClick={onClose} aria-label="닫기">
                <X size={18} />
              </button>
            }
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <GhostButton className="h-8 px-2" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={16} /> 이전
          </GhostButton>
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => {
                if (!pickerOpen) {
                  setPendingYear(month.getFullYear());
                  setPendingMonth(month.getMonth());
                }
                setPickerOpen((value) => !value);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-base font-semibold shadow-sm transition hover:bg-muted"
              aria-expanded={pickerOpen}
            >
              {calendarMonthLabel(month)}
              <ChevronDown size={16} className={cn("transition", pickerOpen && "rotate-180")} />
            </button>
            {pickerOpen && (
              <div className="absolute left-1/2 top-full z-[80] mt-2 grid w-80 -translate-x-1/2 grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 shadow-2xl">
                <div>
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">연도</div>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {years.map((year) => (
                      <button
                        key={year}
                        type="button"
                        onClick={() => setPendingYear(year)}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted",
                          year === pendingYear && "bg-primary text-primary-foreground hover:bg-primary"
                        )}
                      >
                        {year}년
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">월</div>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {months.map((monthIndex) => (
                      <button
                        key={monthIndex}
                        type="button"
                        onClick={() => setPendingMonth(monthIndex)}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted",
                          monthIndex === pendingMonth && "bg-primary text-primary-foreground hover:bg-primary"
                        )}
                      >
                        {monthIndex + 1}월
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="text-xs text-muted-foreground">
                    선택: <span className="font-semibold text-foreground">{pendingYear}년 {pendingMonth + 1}월</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="h-8 rounded-md border border-border px-3 text-xs font-semibold transition hover:bg-muted"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onMonthChange(new Date(pendingYear, pendingMonth, 1));
                        setPickerOpen(false);
                      }}
                      className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      확인
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <GhostButton className="h-8 px-2" onClick={() => moveMonth(1)}>
            다음 <ChevronRight size={16} />
          </GhostButton>
        </div>

        <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
            <div
              key={day}
              className={cn(
                "px-2 py-2",
                index === 0 && "text-rose-500 dark:text-rose-300",
                index === 6 && "text-sky-500 dark:text-sky-300"
              )}
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            if (!day) {
              return <div key={`blank-${index}`} className="min-h-[92px] border-b border-r border-border bg-transparent p-1.5" aria-hidden />;
            }
            const dayEvents = eventsByDay.get(day.toDateString()) || [];
            const isToday = sameDate(day, today);
            const weekday = day.getDay();
            return (
              <div key={day.toISOString()} className="min-h-[92px] border-b border-r border-border p-1.5">
                <div
                  className={cn(
                    "mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                    weekday === 0 && !isToday && "text-rose-500 dark:text-rose-300",
                    weekday === 6 && !isToday && "text-sky-500 dark:text-sky-300",
                    isToday && "bg-primary text-primary-foreground"
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {dayEvents.map((event) => (
                    <button
                      key={eventKey(event)}
                      className={cn(
                        "block w-full rounded-md border px-1.5 py-1 text-left text-xs transition hover:border-primary hover:bg-primary/5",
                        event.importance === "high" && "border-rose-200 bg-gradient-to-r from-orange-50 to-rose-50 text-rose-900 dark:border-rose-900 dark:from-orange-950 dark:to-rose-950 dark:text-rose-100",
                        event.importance === "medium" && "border-amber-200 bg-gradient-to-r from-yellow-50 to-amber-50 text-amber-900 dark:border-amber-900 dark:from-yellow-950 dark:to-amber-950 dark:text-amber-100",
                        event.importance === "low" && "border-emerald-200 bg-gradient-to-r from-emerald-50 to-lime-50 text-emerald-900 dark:border-emerald-900 dark:from-emerald-950 dark:to-lime-950 dark:text-emerald-100"
                      )}
                      onClick={() => onSelect(event)}
                    >
                      <div className="truncate text-[11px] font-semibold">{event.nameKo}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] opacity-80">
                        <span>{event.dateOnly ? "종일" : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(event.eventDate)}</span>
                        <span>{event.status === "released" ? "발표완료" : "예정"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
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
  const [summaryModal, setSummaryModal] = useState<SummaryModalState>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const today = useMemo(() => new Date(), []);
  const { data: articleData } = useQuery({ queryKey: ["indicator-related-articles"], queryFn: () => api.articles({ limit: 120 }) });
  const { data: apiStatuses = [], isLoading: apiStatusLoading, refetch: refetchApiStatus, isFetching: apiStatusFetching } = useQuery({
    queryKey: ["economic-api-status"],
    queryFn: api.economicApiStatus,
    staleTime: 1000 * 60 * 5
  });
  const articles = articleData?.items || [];
  const allBaseEvents = useMemo(() => {
    return buildEvents(today).sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [today]);
  const baseEvents = useMemo(() => {
    const start = addDays(today, -7);
    const end = addDays(today, 7);
    return allBaseEvents
      .filter((event) => event.eventDate >= start && event.eventDate <= end)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [allBaseEvents, today]);
  const eventCodes = useMemo(() => Array.from(new Set(allBaseEvents.map((event) => event.code))), [allBaseEvents]);
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
    const rows = isInitialObservationLoading ? baseEvents : baseEvents.map((event) => applyObservation(event, observationMap[event.code]));
    return [...rows].sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [baseEvents, isInitialObservationLoading, observationMap]);
  const calendarEvents = useMemo(() => {
    const rows = isInitialObservationLoading ? allBaseEvents : allBaseEvents.map((event) => applyObservation(event, observationMap[event.code]));
    return [...rows].sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [allBaseEvents, isInitialObservationLoading, observationMap]);

  const summary = {
    today: events.filter((event) => event.eventDate.toDateString() === today.toDateString()).length,
    released: events.filter((event) => event.status === "released").length,
    highImpact: events.filter((event) => event.importance === "high").length,
    manual: events.filter((event) => event.status === "manual_check_required").length
  };
  const summaryItems = {
    today: events.filter((event) => event.eventDate.toDateString() === today.toDateString()),
    released: events.filter((event) => event.status === "released"),
    highImpact: events.filter((event) => event.importance === "high"),
    manual: events.filter((event) => event.status === "manual_check_required")
  };
  const tableRows = useMemo(() => {
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = addDays(todayStart, 1);
    const beforeToday = events.filter((event) => event.eventDate.getTime() < todayStart.getTime());
    const todayEvents = events.filter((event) => event.eventDate.getTime() >= todayStart.getTime() && event.eventDate.getTime() < tomorrowStart.getTime());
    const afterToday = events.filter((event) => event.eventDate.getTime() >= tomorrowStart.getTime());
    return [
      ...beforeToday,
      { type: "today" as const },
      ...todayEvents,
      ...afterToday
    ];
  }, [events, today]);
  const connectedApiCount = apiStatuses.filter((source) => source.configured && source.status === "connected").length;
  const configuredApiCount = apiStatuses.filter((source) => source.configured).length;
  const errorApiCount = apiStatuses.filter((source) => source.configured && source.status === "error").length;
  const sortedApiStatuses = [...apiStatuses].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    if (a.status !== b.status) return a.status === "connected" ? -1 : b.status === "connected" ? 1 : a.status.localeCompare(b.status);
    return a.label.localeCompare(b.label);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selected) {
        setSelected(null);
        return;
      }
      if (summaryModal) {
        setSummaryModal(null);
        return;
      }
      if (calendarOpen) {
        setCalendarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calendarOpen, selected, summaryModal]);

  return (
    <div className="space-y-6">
      <HeaderBlock
        title="주요 경제 지표"
        description="오늘 기준 D-7 ~ D+7 발표 일정과 실제치, 시장 영향 해석을 함께 봅니다."
        actions={
          <>
            <GhostButton onClick={() => {
              const now = new Date();
              setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setCalendarOpen(true);
            }}>
              <CalendarDays size={16} /> 일정 달력
            </GhostButton>
            <GhostButton onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>
              <Info size={16} /> 데이터 소스 상태
            </GhostButton>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="오늘 발표" value={summary.today} icon={CalendarClock} items={summaryItems.today} onOpen={() => setSummaryModal({ label: "오늘 발표", value: summary.today, icon: CalendarClock, items: summaryItems.today })} />
        <SummaryCard label="발표 완료" value={summary.released} icon={CheckCircle2} items={summaryItems.released} onOpen={() => setSummaryModal({ label: "발표 완료", value: summary.released, icon: CheckCircle2, items: summaryItems.released })} />
        <SummaryCard label="시장 영향 큰 지표" value={summary.highImpact} icon={ShieldAlert} items={summaryItems.highImpact} onOpen={() => setSummaryModal({ label: "시장 영향 큰 지표", value: summary.highImpact, icon: ShieldAlert, items: summaryItems.highImpact })} />
        <SummaryCard label="수동 확인 필요" value={summary.manual} icon={Search} items={summaryItems.manual} onOpen={() => setSummaryModal({ label: "수동 확인 필요", value: summary.manual, icon: Search, items: summaryItems.manual })} />
      </div>

      <Card>
        <div className="border-b border-border p-4">
          <HeaderBlock
            compact
            title="이번 주 주요 지표"
            description="일정은 config 보완과 공식 API 연동을 분리해서 관리하며, 실제 연결 상태는 하단에서 확인합니다."
          />
          {isInitialObservationLoading ? (
            <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
              공식 API에서 지표 정보를 가져오는 중입니다. 불러오기가 끝난 뒤 실데이터가 없거나 미설정인 지표만 샘플 데이터로 표시합니다.
            </div>
          ) : null}
        </div>
        <div className="overflow-visible">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[6%]" />
              <col className="w-[20%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
            </colgroup>
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
                <th className="whitespace-nowrap px-4 py-3">연결 뉴스</th>
                <th className="whitespace-nowrap px-4 py-3">상세</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, index) => {
                if ("type" in row) {
                  return (
                    <tr key="today-marker" className="border-t border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/50">
                      <td colSpan={10} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white shadow-sm">Today</span>
                          <span className="font-semibold text-sky-950 dark:text-sky-100">
                            {new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(today)}
                          </span>
                          <span className="ml-auto grid grid-cols-2 overflow-hidden rounded-full border border-sky-200 bg-white text-xs font-bold shadow-sm dark:border-sky-800 dark:bg-sky-950">
                            <span className="inline-flex items-center justify-center gap-1 bg-emerald-100 px-3 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                              <ArrowUp size={13} /> 발표 완료 구간
                            </span>
                            <span className="inline-flex items-center justify-center gap-1 bg-sky-100 px-3 py-1 text-sky-800 dark:bg-sky-900 dark:text-sky-100">
                              발표 예정 구간 <ArrowDown size={13} />
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }
                const event = row;
                const related = getRelatedArticles(event, articles);
                const direction = directionOf(event);
                const isTodayEvent = sameDate(event.eventDate, today);
                const previousRow = tableRows[index - 1];
                const followsTodayMarker = Boolean(previousRow && "type" in previousRow);
                return (
                  <tr
                    key={`${eventKey(event)}-${index}`}
                    className={cn(
                      "border-t border-border align-top hover:bg-muted/30",
                      isTodayEvent && "border-sky-200 bg-sky-50/80 hover:bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/45 dark:hover:bg-sky-950/70",
                      followsTodayMarker && "border-t-0"
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(event.eventDate, event.dateOnly)}</td>
                    <td className="px-4 py-3"><Badge>{event.country}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap font-semibold">{event.nameKo}</div>
                      <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{categoryLabel[event.category] || event.category} · {event.periodLabel}</div>
                    </td>
                    <td className="px-4 py-3"><ImportanceBadge importance={event.importance} /></td>
                    <td className="px-4 py-3"><StatusBadge status={event.status} /></td>
                    <td className="px-4 py-3"><ActualValueCell event={event} loading={isInitialObservationLoading} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{isInitialObservationLoading ? <LoadingValue /> : formatValue(event.previousValue, event.unit)}</td>
                    <td className="px-4 py-3">
                      {isInitialObservationLoading ? <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">확인 중</Badge> : <DirectionBadge direction={direction} />}
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
            <Card key={eventKey(event)} className="p-4">
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
        <HeaderBlock
          compact
          title="데이터 소스 상태"
          description=".env에 입력한 API 키 기준으로 실제 테스트 요청을 보내 연결 가능 여부를 확인합니다."
          actions={
            <>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">연결 {connectedApiCount}/{configuredApiCount || apiStatuses.length}</Badge>
                {errorApiCount > 0 ? <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">오류 {errorApiCount}</Badge> : null}
              </div>
              <GhostButton onClick={() => refetchApiStatus()} disabled={apiStatusFetching}>
                <RefreshCw size={15} className={cn(apiStatusFetching && "animate-spin")} />
                상태 새로고침
              </GhostButton>
            </>
          }
        />
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

      {calendarOpen ? (
        <CalendarScheduleModal
          events={calendarEvents}
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
          onClose={() => setCalendarOpen(false)}
          onSelect={(event) => {
            setSelected(event);
          }}
        />
      ) : null}
      {summaryModal ? (
        <SummaryListModal
          data={summaryModal}
          onClose={() => setSummaryModal(null)}
          onSelect={(event) => {
            setSummaryModal(null);
            setSelected(event);
          }}
        />
      ) : null}
      {selected ? <IndicatorDetailModal event={selected} articles={articles} apiStatuses={apiStatuses} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
