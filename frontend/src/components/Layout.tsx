import { BarChart3, ChevronDown, Copyright, FileText, Moon, Newspaper, Settings, Sun, TrendingUp, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { COPYRIGHT_HOLDERS, COPYRIGHT_LINE, COPYRIGHT_NOTICE } from "../lib/copyright";
import { cn } from "../lib/utils";

const navGroups = [
  {
    label: "메인",
    icon: BarChart3,
    paths: ["/", "/indicators", "/company-analysis"],
    items: [
      { to: "/", label: "대시보드", description: "뉴스 요약과 수집 현황" },
      { to: "/indicators", label: "주요지표", description: "경제 지표 일정과 시장 영향" },
      { to: "/company-analysis", label: "기업 분석", description: "기사와 주가 기반 기업 분석" }
    ]
  },
  {
    label: "기사",
    icon: Newspaper,
    paths: ["/domestic", "/global", "/bok", "/search"],
    items: [
      { to: "/domestic", label: "국내", description: "국내 경제 기사" },
      { to: "/global", label: "해외", description: "해외 경제 기사" },
      { to: "/bok", label: "한국은행", description: "BOK 관련 기사" },
      { to: "/search", label: "검색", description: "전체 기사 검색" }
    ]
  }
];

const directLinks = [
  { to: "/reports", label: "보고서", icon: FileText },
  { to: "/settings", label: "설정", icon: Settings }
];

export default function Layout() {
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [copyrightOpen, setCopyrightOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp size={19} />
            </div>
            <div>
              <div className="text-base font-semibold">Economy News</div>
              <div className="text-xs text-muted-foreground">Local dashboard</div>
            </div>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {navGroups.map((group) => {
              const Icon = group.icon;
              const isActive = group.paths.some((path) => (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path)));
              return (
                <div key={group.label} className="group relative py-1">
                  <button
                    className={cn(
                      "inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                      isActive && "bg-muted text-foreground"
                    )}
                  >
                    <Icon size={15} />
                    {group.label}
                    <ChevronDown size={14} className="transition group-hover:rotate-180" />
                  </button>
                  <div className="invisible absolute left-0 top-full z-50 w-64 rounded-lg border border-border bg-card p-2 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
                    {group.items.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn("block rounded-md px-3 py-2 hover:bg-muted", location.pathname === item.to && "bg-muted")}
                      >
                        <div className="text-sm font-medium text-foreground">{item.label}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{item.description}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
            {directLinks.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    cn("inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground", isActive && "bg-muted text-foreground")
                  }
                >
                  <Icon size={15} />
                  {link.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="relative flex items-center gap-2">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setCopyrightOpen((value) => !value)}
              aria-label="copyright"
              aria-expanded={copyrightOpen}
            >
              <Copyright size={17} />
            </button>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setDark((value) => !value)}
              aria-label="theme"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {copyrightOpen ? (
              <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-sm shadow-xl">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">Copyright</div>
                    <div className="text-xs text-muted-foreground">Rights holder information</div>
                  </div>
                  <button
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setCopyrightOpen(false)}
                    aria-label="close copyright"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="space-y-2 rounded-md bg-muted/50 p-3">
                  {COPYRIGHT_HOLDERS.map((holder) => (
                    <div key={`${holder.company}-${holder.name}`} className="grid grid-cols-[8.5rem_1fr] gap-3">
                      <span className="text-muted-foreground">{holder.company}</span>
                      <span className="font-medium text-foreground">{holder.name}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs font-medium text-foreground">{COPYRIGHT_LINE}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{COPYRIGHT_NOTICE}</p>
              </div>
            ) : null}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {[...navGroups.flatMap((group) => group.items), ...directLinks].map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => cn("shrink-0 rounded-md px-3 py-2 text-sm", isActive ? "bg-muted" : "text-muted-foreground")}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
