import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    dashboard: vi.fn(),
    ingest: vi.fn()
  }
}));

test("renders dashboard metrics", async () => {
  vi.mocked(api.dashboard).mockResolvedValue({
    today_count: 2,
    domestic_count: 3,
    global_count: 4,
    bok_count: 1,
    important_count: 1,
    latest: [],
    important: [],
    bok_preview: [],
    keywords: [{ name: "금리", count: 2 }],
    chart: []
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  expect(await screen.findByText("메인 대시보드")).toBeInTheDocument();
  expect(screen.getByText("오늘 기사")).toBeInTheDocument();
});
