export type Article = {
  id: number;
  source_name: string;
  title: string;
  translated_title: string;
  url: string;
  published_at: string | null;
  summary: string;
  category: string;
  region: "domestic" | "global";
  is_bok_related: boolean;
  bok_relevance_score: number;
  importance_score: number;
  tags: string[];
  bok_keywords: string[];
  bok_keyword_groups: string[];
  is_saved: boolean;
  is_read: boolean;
  is_ai_analyzed: boolean;
  similar_article_count: number;
  similar_article_titles: string[];
  related_group_id: string;
  related_group_label: string;
  related_group_size: number;
};

export type ArticleDetail = Article & {
  content: string;
  sanitized_html: string;
  author: string;
  fetched_at: string;
  ai?: {
    translated_title: string;
    summary: string;
    bullet_points: string[];
    category: string;
    tags: string[];
    importance_score: number;
    bok_relevance_score: number;
    bok_reason: string;
    market_impact: Record<string, string>;
  } | null;
};

export type ArticleListResponse = {
  items: Article[];
  total: number;
};

export type DashboardSummary = {
  today_count: number;
  domestic_count: number;
  global_count: number;
  bok_count: number;
  important_count: number;
  latest: Article[];
  important: Article[];
  bok_preview: Article[];
  keywords: { name: string; count: number }[];
  chart: { name: string; value: number }[];
};

export type Source = {
  id: number;
  name: string;
  url: string;
  region: string;
  category: string;
  language: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type FetchLog = {
  id: number;
  source_name: string;
  status: string;
  message: string;
  fetched_count: number;
  new_count: number;
  created_at: string;
};

export type PostprocessStatus = {
  running: boolean;
  stage: string;
  processed: number;
  total: number;
  updated: number;
  current_article_id: number | null;
  current_title: string;
  message: string;
  started_at: string;
  updated_at: string;
};

export type IngestSchedule = {
  running: boolean;
  interval_minutes: number;
  next_run_at: string | null;
  now: string;
};

export type EconomicApiStatus = {
  source: string;
  label: string;
  configured: boolean;
  status: "connected" | "error" | "missing";
  message: string;
  sample: string;
  checked_at: string;
};

export type EconomicObservationPoint = {
  label: string;
  date: string | null;
  value: number;
};

export type EconomicIndicatorObservation = {
  code: string;
  source: string;
  source_label: string;
  status: "connected" | "unavailable" | "error";
  is_sample: boolean;
  message: string;
  unit: string;
  actual_value: number | null;
  previous_value: number | null;
  direction: "up" | "down" | "flat" | "none";
  latest_date: string | null;
  previous_date: string | null;
  series: EconomicObservationPoint[];
  fetched_at: string;
};

export type CompanyAnalysisArticle = {
  id: number;
  title: string;
  original_title: string;
  source_name: string;
  published_at: string | null;
  summary: string;
  url: string;
  sentiment: "positive" | "negative" | "neutral";
  score: number;
  importance_score: number;
  positive_keywords: string[];
  negative_keywords: string[];
};

export type CompanyQuote = {
  symbol: string;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change_abs: number;
  change_pct: number;
  source: string;
};

export type CompanyAnalysis = {
  company_name: string;
  resolved_name: string;
  market: "AUTO" | "KR" | "US";
  article_count: number;
  sentiment: {
    positive_count: number;
    negative_count: number;
    neutral_count: number;
    sentiment_score: number;
    label: string;
  };
  stock: {
    company_name: string;
    symbol: string;
    quote: CompanyQuote | null;
    peers: CompanyQuote[];
    peer_average_change_pct: number | null;
    message: string;
  };
  memo: {
    ai_available: boolean;
    overall_view: string;
    investment_view: string;
    positive_factors: string[];
    negative_factors: string[];
    watch_points: string[];
    economic_context: string;
    message: string;
  };
  articles: CompanyAnalysisArticle[];
};

export type CompanyAnalysisJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  logs: { time: string; message: string }[];
  result: CompanyAnalysis | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportArticle = {
  id: number;
  title: string;
  original_title: string;
  source: string;
  summary: string;
  importance_score: number;
  bok_relevance_score: number;
  impact_score?: number;
  url: string;
};

export type Report = {
  id: number | null;
  report_date: string;
  status: "draft" | "final";
  title: string;
  content_markdown: string;
  summary: Record<string, unknown>;
  source_article_ids: number[];
  article_count: number;
  domestic_count: number;
  global_count: number;
  bok_count: number;
  important_count: number;
  generated_at: string;
  finalized_at: string | null;
  model_provider: string;
  model_name: string;
};

export type ReportListItem = {
  id: number;
  report_date: string;
  title: string;
  article_count: number;
  domestic_count: number;
  global_count: number;
  bok_count: number;
  important_count: number;
  generated_at: string;
  finalized_at: string | null;
};

export type Settings = {
  ai_provider: string;
  ai_model: string;
  news_fetch_interval_minutes: number;
  article_retention_days: number;
  report_retention_days: number;
  report_final_time: string;
  enable_browser_notifications: boolean;
  enable_ai_summary_postprocess: boolean;
  enable_title_translation_postprocess: boolean;
};
