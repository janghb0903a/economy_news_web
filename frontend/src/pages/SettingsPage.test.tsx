import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./SettingsPage";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    settings: vi.fn(),
    sources: vi.fn(),
    updateSettings: vi.fn(),
    createSource: vi.fn(),
    deleteSource: vi.fn(),
    ingest: vi.fn(),
    runPostprocess: vi.fn(),
    runBodyPostprocess: vi.fn(),
    runAiPostprocess: vi.fn(),
    postprocessStatus: vi.fn(),
    ingestLogs: vi.fn(),
    ingestSchedule: vi.fn()
  }
}));

test("renders settings sub menu and provider switch", async () => {
  vi.mocked(api.settings).mockResolvedValue({
    ai_provider: "disabled",
    ai_model: "",
    news_fetch_interval_minutes: 10,
    article_retention_days: 14,
    report_retention_days: 30,
    report_final_time: "18:00",
    report_email_enabled: false,
    report_email_time: "18:10",
    report_email_recipients: [],
    report_email_formats: ["md", "html"],
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    smtp_from_email: "",
    smtp_from_name: "Economy News Dashboard",
    smtp_use_tls: true,
    smtp_use_ssl: false,
    smtp_password_configured: false,
    enable_browser_notifications: true,
    enable_collect_domestic: true,
    enable_collect_global: true,
    enable_collect_bok: true,
    enable_ai_boost: false,
    enable_ai_summary_postprocess: false,
    enable_title_translation_postprocess: false
  });
  vi.mocked(api.sources).mockResolvedValue([]);
  vi.mocked(api.ingestLogs).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 1, hours: 12 });
  vi.mocked(api.ingestSchedule).mockResolvedValue({
    running: true,
    interval_minutes: 10,
    next_run_at: new Date(Date.now() + 600000).toISOString(),
    now: new Date().toISOString()
  });
  vi.mocked(api.postprocessStatus).mockResolvedValue({
    running: false,
    stage: "대기",
    processed: 0,
    total: 0,
    updated: 0,
    current_article_id: null,
    current_title: "",
    message: "대기 중",
    started_at: "",
    updated_at: ""
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );

  expect(await screen.findByText("AI Provider")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "꺼짐" })).toBeInTheDocument();
  expect(screen.getByText("현재 provider: disabled")).toBeInTheDocument();
  expect(screen.getByText("AI 기능이 꺼져 있어 Boost를 켤 수 없습니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /알람 및 수집/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /소스/ })).toBeInTheDocument();
});
