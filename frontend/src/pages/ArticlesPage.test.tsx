import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ArticlesPage from "./ArticlesPage";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    articles: vi.fn()
  }
}));

test("renders BOK filter", async () => {
  vi.mocked(api.articles).mockResolvedValue({ items: [], total: 0 });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ArticlesPage mode="bok" />
      </MemoryRouter>
    </QueryClientProvider>
  );
  expect(await screen.findByText("한국은행 관련 기사")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("검색어")).toBeInTheDocument();
});
