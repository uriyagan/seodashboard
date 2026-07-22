import { lazy, Suspense, useState } from "react";
import {
  FileText,
  Lightbulb,
  LayoutDashboard,
  LogOut,
  Settings,
  Plus,
  Globe,
  CalendarClock,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { ProjectsProvider, useProjects } from "@/lib/projects";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { AddSiteWizard } from "@/components/AddSiteWizard";
import { PostsList } from "@/components/PostsList";
import { IdeasList } from "@/components/IdeasList";
import { ProjectSettings } from "@/components/ProjectSettings";
import { ThemeToggle } from "@/components/ThemeToggle";

// TinyMCE is heavy — load the editor only when needed.
const PostEditor = lazy(() =>
  import("@/components/PostEditor").then((m) => ({ default: m.PostEditor }))
);
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type NavKey = "overview" | "posts" | "ideas" | "settings";

const NAV: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "סקירה", icon: LayoutDashboard },
  { key: "posts", label: "פוסטים", icon: FileText },
  { key: "ideas", label: "רעיונות", icon: Lightbulb },
  { key: "settings", label: "הגדרות", icon: Settings },
];

/** Right sidebar: logo, nav, and (bottom) project switcher + theme + logout. */
function Sidebar({
  active,
  onNavigate,
  onAdd,
}: {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  onAdd: () => void;
}) {
  const { user, signOut } = useAuth();
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      {/* Logo */}
      <div className="flex h-[76px] shrink-0 items-center border-b border-[var(--border)] px-5">
        <Logo className="h-5 w-auto text-[var(--text)]" />
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
  );
}

/** Top bar header — page title + active project context. */
function Topbar({ nav }: { nav: NavKey }) {
  const { activeProject } = useProjects();
  const label = NAV.find((n) => n.key === nav)?.label ?? "";
  return (
    <header className="flex h-[76px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-[60px]">
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-[60px]">
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
  if (!activeProject) return null;
  return (
    <div className="p-[60px]">
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
          { label: "פוסטים", value: "—", icon: FileText },
          { label: "רעיונות פתוחים", value: "—", icon: Lightbulb },
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
    </div>
  );
}

function DashboardInner() {
  const { projects, loading } = useProjects();
  const [nav, setNavState] = useState<NavKey>("overview");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ postId: string | null } | null>(null);
  const [listKey, setListKey] = useState(0);

  function setNav(k: NavKey) {
    setEditing(null);
    setNavState(k);
  }
  function openEditor(postId: string | null) {
    setEditing({ postId });
  }
  function closeEditor() {
    setEditing(null);
    setListKey((k) => k + 1);
  }

  function renderContent() {
    if (editing !== null) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-7" />
            </div>
          }
        >
          <PostEditor postId={editing.postId} onBack={closeEditor} />
        </Suspense>
      );
    }
    switch (nav) {
      case "overview":
        return <Overview />;
      case "posts":
        return <PostsList key={listKey} onNew={() => openEditor(null)} onEdit={openEditor} />;
      case "ideas":
        return <IdeasList key={listKey} onEditPost={openEditor} />;
      case "settings":
        return <ProjectSettings />;
    }
  }

  const showTopbar = editing === null && projects.length > 0;

  return (
    <div className="flex h-full">
      <Sidebar active={nav} onNavigate={setNav} onAdd={() => setAddOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {showTopbar && <Topbar nav={nav} />}
        <main className="flex-1 overflow-y-auto bg-[var(--bg)]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-7" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} />
          ) : (
            renderContent()
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
