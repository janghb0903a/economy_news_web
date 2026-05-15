import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ArticlesPage from "./pages/ArticlesPage";
import ArticleDetailPage from "./pages/ArticleDetailPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import ReportsPage from "./pages/ReportsPage";
import EconomicIndicatorsPage from "./pages/EconomicIndicatorsPage";
import CompanyAnalysisPage from "./pages/CompanyAnalysisPage";

export default function App() {
  return (
    <>
      <ScrollToTop />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/indicators" element={<EconomicIndicatorsPage />} />
        <Route path="/company-analysis" element={<CompanyAnalysisPage />} />
        <Route path="/domestic" element={<ArticlesPage mode="domestic" />} />
        <Route path="/domestic/related/:relatedId" element={<ArticlesPage mode="domestic" />} />
        <Route path="/global" element={<ArticlesPage mode="global" />} />
        <Route path="/global/related/:relatedId" element={<ArticlesPage mode="global" />} />
        <Route path="/bok" element={<ArticlesPage mode="bok" />} />
        <Route path="/bok/related/:relatedId" element={<ArticlesPage mode="bok" />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/articles/:id" element={<ArticleDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </>
  );
}

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search]);

  return null;
}
