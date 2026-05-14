import type { ArticleDetail, ArticleListResponse, CompanyAnalysis, CompanyAnalysisJob, DashboardSummary, EconomicApiStatus, EconomicIndicatorObservation, FetchLog, IngestSchedule, PostprocessStatus, Report, ReportListItem, Settings, Source } from "./types";

const API_BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const data = JSON.parse(text) as { detail?: string };
      message = data.detail || text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export type ArticleParams = Record<string, string | number | boolean | undefined | null>;

function toQuery(params: ArticleParams = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const api = {
  dashboard: () => request<DashboardSummary>("/api/dashboard/summary"),
  articles: (params?: ArticleParams) => request<ArticleListResponse>(`/api/articles${toQuery(params)}`),
  article: (id: string | number) => request<ArticleDetail>(`/api/articles/${id}`),
  markRead: (id: string | number) => request<{ ok: boolean }>(`/api/articles/${id}/read`, { method: "POST" }),
  save: (id: string | number) => request<{ ok: boolean; is_saved: boolean }>(`/api/articles/${id}/save`, { method: "POST" }),
  addTag: (id: string | number, tag: string) => request(`/api/articles/${id}/tags`, { method: "POST", body: JSON.stringify({ tag }) }),
  deleteTag: (id: string | number, tag: string) => request(`/api/articles/${id}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }),
  markBok: (id: string | number) => request<{ ok: boolean }>(`/api/articles/${id}/mark-bok`, { method: "POST" }),
  analyze: (id: string | number) => request(`/api/articles/${id}/ai/analyze`, { method: "POST" }),
  ingest: () => request<{ results: unknown[] }>("/api/ingest/run", { method: "POST" }),
  runPostprocess: () => request<{ ok: boolean }>("/api/postprocess/run", { method: "POST" }),
  postprocessStatus: () => request<PostprocessStatus>("/api/postprocess/status"),
  ingestLogs: () => request<FetchLog[]>("/api/ingest/logs"),
  ingestSchedule: () => request<IngestSchedule>("/api/ingest/schedule"),
  companyAnalysis: (payload: { company_name: string; symbol?: string; market?: string }) => request<CompanyAnalysis>("/api/company-analysis", { method: "POST", body: JSON.stringify(payload) }),
  startCompanyAnalysis: (payload: { company_name: string; symbol?: string; market?: string }) => request<{ job_id: string }>("/api/company-analysis/jobs", { method: "POST", body: JSON.stringify(payload) }),
  companyAnalysisJob: (jobId: string) => request<CompanyAnalysisJob>(`/api/company-analysis/jobs/${jobId}`),
  economicApiStatus: () => request<EconomicApiStatus[]>("/api/economic-api/status"),
  economicIndicatorObservations: (codes: string[]) => request<EconomicIndicatorObservation[]>(`/api/economic-indicators/observations${toQuery({ codes: codes.join(",") })}`),
  reports: () => request<ReportListItem[]>("/api/reports"),
  todayReport: () => request<Report>("/api/reports/today"),
  generateReport: () => request<Report>("/api/reports/generate", { method: "POST" }),
  finalReport: (date: string) => request<Report>(`/api/reports/final/${date}`),
  finalizeReport: () => request<Report>("/api/reports/finalize", { method: "POST" }),
  sources: () => request<Source[]>("/api/sources"),
  createSource: (source: Partial<Source>) => request<Source>("/api/sources", { method: "POST", body: JSON.stringify(source) }),
  updateSource: (id: number, source: Partial<Source>) => request<Source>(`/api/sources/${id}`, { method: "PUT", body: JSON.stringify(source) }),
  deleteSource: (id: number) => request<{ ok: boolean }>(`/api/sources/${id}`, { method: "DELETE" }),
  testSource: (id: number) => request(`/api/sources/${id}/test`, { method: "POST" }),
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (settings: Partial<Settings>) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) })
};
