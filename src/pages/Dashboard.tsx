import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import {
  FileText,
  Lightbulb,
  LayoutDashboard,
  Link2,
  LogOut,
  Settings,
  Plus,
  Globe,
  CalendarClock,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { ProjectsProvider, useProjects } from "@/lib/projects";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { AddSiteWizard } from "@/components/AddSiteWizard";
import { PostsList } from "@/components/PostsList";
import { IdeasList } from "@/components/IdeasList";
import { LinksPage } from "@/components/LinksPage";
import { ProjectSettings } from "@/components/ProjectSettings";
import { OrganicOverview } from "@/components/OrganicOverview";
import { ThemeToggle } from "@/components/ThemeToggle";

// TinyMCE is heavy — load the editor only when needed.
const PostEditor = lazy(() =>
  import("@/components/PostEditor").then((m) => ({ default: m.PostEditor }))
);
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type NavKey = "overview" | "posts" | "ideas" | "links" | "settings";

const NAV: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "סקירה", icon: LayoutDashboard },
  { key: "posts", label: "פוסטים", icon: FileText },
  { key: "ideas", label: "רעיונות", icon: Lightbulb },
  { key: "links", label: "קישורים פנימיים", icon: Link2 },
  { key: "settings", label: "הגדרות", icon: Settings },
];

const NAV_PATH: Record<NavKey, string> = {
  overview: "/",
  posts: "/posts",
  ideas: "/ideas",
  links: "/links",
  settings: "/settings",
};
function pathToNav(pathname: string): NavKey {
  if (pathname.startsWith("/posts")) return "posts";
  if (pathname.startsWith("/ideas")) return "ideas";
  if (pathname.startsWith("/links")) return "links";
  if (pathname.startsWith("/settings")) return "settings";
  return "overview";
}

/** Right sidebar: logo, nav, and (bottom) project switcher + theme + logout.
 *  Static on lg+; a slide-in drawer (with backdrop) on smaller screens. */
function Sidebar({
  active,
  onNavigate,
  onAdd,
  open,
  onClose,
}: {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  onAdd: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const { user, signOut } = useAuth();
  return (
    <>
      {/* Backdrop (mobile only) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-64 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo — stretched to the sidebar width; close button on mobile */}
        <div className="flex h-[76px] shrink-0 items-center gap-2 border-b border-[var(--border)] px-5">
          <Logo className="w-full text-[var(--text)]" />
          <button
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] lg:hidden"
            aria-label="סגירת תפריט"
          >
            <X className="size-5" />
          </button>
        </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onNavigate(key)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active === key
                ? "bg-[var(--brand-soft)] text-[var(--text)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </button>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="space-y-2 border-t border-[var(--border)] p-3">
        <ProjectSwitcher onAdd={onAdd} openUp />
        <div className="flex items-center justify-between px-1">
          <span className="truncate text-xs text-[var(--muted)]" dir="ltr">
            {user?.email}
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => void signOut()}
              className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              aria-label="התנתקות"
              title="התנתקות"
            >
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </div>
      </aside>
    </>
  );
}

/** Desktop top bar — page title + active project context (hidden on mobile). */
function Topbar({ nav }: { nav: NavKey }) {
  const { activeProject } = useProjects();
  const label = NAV.find((n) => n.key === nav)?.label ?? "";
  return (
    <header className="hidden h-[76px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-8 lg:flex lg:px-[60px]">
      <h1 className="text-lg font-semibold text-[var(--text)]">{label}</h1>
      {activeProject && (
        <>
          <span className="text-[var(--border)]">|</span>
          <span className="text-sm text-[var(--muted)]">{activeProject.name}</span>
        </>
      )}
    </header>
  );
}

/** Mobile top bar — hamburger + logo (hidden on lg+). */
function MobileBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:hidden">
      <button
        onClick={onMenu}
        className="flex size-9 items-center justify-center rounded-lg text-[var(--text)] hover:bg-[var(--surface-2)]"
        aria-label="פתיחת תפריט"
      >
        <Menu className="size-5" />
      </button>
      <Logo className="h-6 text-[var(--text)]" />
    </header>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 sm:p-10 lg:p-[60px]">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--text)]">
          <Globe className="size-8" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-[var(--text)]">ברוך הבא 👋</h2>
        <p className="mb-6 text-sm text-[var(--muted)]">
          עדיין לא חובר אף אתר. הוסף את הלקוח הראשון כדי להתחיל לנהל פוסטים,
          תוכן ותמונות.
        </p>
        <Button size="lg" onClick={onAdd}>
          <Plus className="size-4" />
          הוסף אתר חדש
        </Button>
      </div>
    </div>
  );
}

function Overview() {
  const { activeProject } = useProjects();
  const [counts, setCounts] = useState<{ posts: number; ideas: number } | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    setCounts(null);
    Promise.all([
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("project_id", activeProject.id),
      supabase
        .from("ideas")
        .select("id", { count: "exact", head: true })
        .eq("project_id", activeProject.id)
        .eq("status", "suggested"),
    ]).then(([p, i]) => setCounts({ posts: p.count ?? 0, ideas: i.count ?? 0 }));
  }, [activeProject]);

  if (!activeProject) return null;
  const fmt = (n: number | undefined) => (counts ? String(n ?? 0) : "…");
  return (
    <div className="p-5 sm:p-8 lg:p-[60px]">
      <div className="mb-8">
        <a
          href={activeProject.site_url}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="text-sm text-[var(--muted)] hover:text-[var(--text)] hover:underline"
        >
          {activeProject.site_url}
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "פוסטים", value: fmt(counts?.posts), icon: FileText },
          { label: "רעיונות פתוחים", value: fmt(counts?.ideas), icon: Lightbulb },
          { label: "קצב שבועי", value: `${activeProject.cadence_per_week}/שבוע`, icon: CalendarClock },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--muted)]">{label}</span>
              <Icon className="size-5 text-[var(--muted)]" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <OrganicOverview projectId={activeProject.id} />
      </div>
    </div>
  );
}

/** Post editor route — reads the :id param ("new" or absent → a new post). */
function EditorRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const postId = !id || id === "new" ? null : id;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-7" />
        </div>
      }
    >
      <PostEditor postId={postId} onBack={() => navigate("/posts")} />
    </Suspense>
  );
}

function DashboardInner() {
  const { projects, loading } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const nav = pathToNav(location.pathname);
  const isEditor = /^\/posts\/.+/.test(location.pathname);

  // Complete the Google Search Console OAuth round-trip: the worker callback
  // bounces back to "/?gsc_code=…&gsc_state=…"; exchange it, then open Settings.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("gsc_code");
    const err = params.get("gsc_error");
    if (!code && !err) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (err) {
      alert(`חיבור Google Search Console נכשל: ${err}`);
      return;
    }
    api("/api/gsc/exchange", { code, state: params.get("gsc_state") })
      .then(() => navigate("/settings"))
      .catch((e) => alert(`חיבור Google Search Console נכשל: ${e.message}`));
  }, [navigate]);

  function go(k: NavKey) {
    navigate(NAV_PATH[k]);
    setSidebarOpen(false);
  }

  const showTopbar = !isEditor && projects.length > 0;

  return (
    <div className="flex h-full">
      <Sidebar
        active={nav}
        onNavigate={go}
        onAdd={() => setAddOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar onMenu={() => setSidebarOpen(true)} />
        {showTopbar && <Topbar nav={nav} />}
        <main className="flex-1 overflow-y-auto bg-[var(--bg)]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-7" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} />
          ) : (
            <Routes>
              <Route index element={<Overview />} />
              <Route
                path="posts"
                element={
                  <PostsList
                    onNew={() => navigate("/posts/new")}
                    onEdit={(pid) => navigate(`/posts/${pid}`)}
                  />
                }
              />
              <Route path="posts/new" element={<EditorRoute />} />
              <Route path="posts/:id" element={<EditorRoute />} />
              <Route
                path="ideas"
                element={<IdeasList onEditPost={(pid) => navigate(`/posts/${pid}`)} />}
              />
              <Route path="links" element={<LinksPage />} />
              <Route path="settings" element={<ProjectSettings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
      {addOpen && <AddSiteWizard onClose={() => setAddOpen(false)} />}
    </div>
  );
}

export function DashboardPage() {
  return (
    <ProjectsProvider>
      <DashboardInner />
    </ProjectsProvider>
  );
}
