import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: string | null) {
  if (!value) return "날짜 없음";
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+09:00`;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(normalized));
}

export function percent(value: number) {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${Math.round(normalized * 100)}%`;
}

export function stripHtml(value?: string | null) {
  if (!value) return "";
  const element = document.createElement("div");
  element.innerHTML = value;
  return (element.textContent || element.innerText || "").replace(/\s+/g, " ").trim();
}

export function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    domestic_economy: "국내 경제",
    global_economy: "해외 경제",
    bok: "한국은행",
    markets: "증시",
    rates_bonds: "금리·채권",
    fx: "환율",
    real_estate_debt: "부동산·부채",
    industry_export: "산업·수출",
    banking_finance: "금융",
    inflation_consumption: "물가·소비",
    politics: "정치",
    world: "세계",
    other: "기타"
  };
  return labels[value] || value;
}

export function conciseText(value?: string | null, maxChars = 520) {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const sentences = text.split(/(?<=[.!?。다])\s+/);
  let result = "";
  for (const sentence of sentences) {
    if ((result + " " + sentence).trim().length > maxChars) break;
    result = (result + " " + sentence).trim();
  }
  return result || `${text.slice(0, maxChars).trim()}...`;
}

export function isMostlyEnglish(value?: string | null) {
  if (!value) return false;
  const letters = value.match(/[A-Za-z]/g)?.length || 0;
  const korean = value.match(/[가-힣]/g)?.length || 0;
  return letters > 12 && letters > korean * 2;
}

export function titleKoreanHint(title: string) {
  if (!isMostlyEnglish(title)) return "";
  let text = title;
  const phrases: Array<[RegExp, string]> = [
    [/\bFederal Reserve\b/gi, "미 연준"],
    [/\bcentral banks?\b/gi, "중앙은행"],
    [/\binterest rates?\b/gi, "금리"],
    [/\bstock markets?\b/gi, "주식시장"],
    [/\bbond markets?\b/gi, "채권시장"],
    [/\bforeign exchange\b/gi, "외환"],
    [/\boil prices?\b/gi, "유가"],
    [/\bglobal economy\b/gi, "세계 경제"],
    [/\bWall Street\b/gi, "월가"],
    [/\bBank of Japan\b/gi, "일본은행"],
    [/\bEuropean Central Bank\b/gi, "유럽중앙은행"]
  ];
  const words: Array<[RegExp, string]> = [
    [/\bFed\b/gi, "연준"],
    [/\bECB\b/g, "ECB"],
    [/\bBOJ\b/g, "BOJ"],
    [/\binflation\b/gi, "인플레이션"],
    [/\beconomy\b/gi, "경제"],
    [/\bmarkets?\b/gi, "시장"],
    [/\bstocks?\b/gi, "주식"],
    [/\bbonds?\b/gi, "채권"],
    [/\brates?\b/gi, "금리"],
    [/\bdollar\b/gi, "달러"],
    [/\byen\b/gi, "엔화"],
    [/\boil\b/gi, "유가"],
    [/\bgold\b/gi, "금"],
    [/\btariffs?\b/gi, "관세"],
    [/\btrade\b/gi, "무역"],
    [/\bgrowth\b/gi, "성장"],
    [/\brecession\b/gi, "경기침체"],
    [/\bChina\b/g, "중국"],
    [/\bJapan\b/g, "일본"],
    [/\bEurope\b/g, "유럽"],
    [/\bUS\b/g, "미국"],
    [/\bU\.S\.\b/g, "미국"]
  ];
  for (const [pattern, replacement] of [...phrases, ...words]) {
    text = text.replace(pattern, replacement);
  }
  return text === title ? "" : text;
}
