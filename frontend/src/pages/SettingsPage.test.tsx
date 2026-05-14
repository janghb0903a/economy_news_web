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
    postprocessStatus: vi.fn(),
    ingestLogs: vi.fn(),
    ingestSchedule: vi.fn()
  }
}));

test("renders provider switch", async () => {
  vi.mocked(api.settings).mockResolvedValue({
    ai_provider: "disabled",
    ai_model: "",
    news_fetch_interval_minutes: 10,
    article_retention_days: 180,
    report_retention_days: 30,
    report_final_time: "18:00",
    enable_browser_notifications: true,
    enable_ai_summary_postprocess: false,
    enable_title_translation_postprocess: false
  });
  vi.mocked(api.sources).mockResolvedValue([]);
  vi.mocked(api.ingestLogs).mockResolvedValue([]);
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
  expect(await screen.findByText("AI provider")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "비활성화" })).toBeInTheDocument();
  expect(screen.getByText("현재 provider: disabled")).toBeInTheDocument();
});
