import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import SearchPage from "./SearchPage";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    articles: vi.fn()
  }
}));

test("submits search filter", async () => {
  vi.mocked(api.articles).mockResolvedValue({ items: [], total: 0 });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await userEvent.type(screen.getByPlaceholderText("검색어"), "한국은행");
  await userEvent.click(screen.getByText("검색"));
  expect(api.articles).toHaveBeenCalled();
});
