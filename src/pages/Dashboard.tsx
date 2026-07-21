import { useState } from "react";
import {
  FileText,
  Lightbulb,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Plus,
  Globe,
  CalendarClock,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ProjectsProvider, useProjects } from "@/lib/projects";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type NavKey = "overview" | "posts" | "ideas" | "settings";

const NAV: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "סקירה", icon: LayoutDashboard },
  { key: "posts", label: "פוסטים", icon: FileText },
  { key: "ideas", label: "רעיונות", icon: Lightbulb },
  { key: "settings", label: "הגדרות", icon: Settings },
];

function Sidebar({ active, onNavigate }: { active: NavKey; onNavigate: (k: NavKey) => void }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand)] text-white">
          <Sparkles className="size-5" />
        </div>
        <span className="text-base font-bold text-[var(--text)]">SEO Dashboard</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onNavigate(key)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active === key
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function Topbar({ onAdd }: { onAdd: () => void }) {
  const { user, signOut } = useAuth();
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
      <ProjectSwitcher onAdd={onAdd} />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="mx-1 h-6 w-px bg-[var(--border)]" />
        <span className="hidden text-sm text-[var(--muted)] sm:block" dir="ltr">
          {user?.email}
        </span>
        <button
          onClick={() => void signOut()}
          className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--color-danger)]"
          aria-label="התנתקות"
          title="התנתקות"
        >
          <LogOut className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Globe className="size-8" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-[var(--text)]">ברוך הבא 👋</h2>
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

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6">
      <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <CalendarClock className="size-8 text-[var(--muted)]" />
        <h3 className="text-lg font-semibold text-[var(--text)]">{title}</h3>
        <p className="text-sm text-[var(--muted)]">המסך הזה ייבנה בשלב הבא של הפרויקט.</p>
      </Card>
    </div>
  );
}

function Overview() {
  const { activeProject } = useProjects();
  if (!activeProject) return null;
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text)]">{activeProject.name}</h1>
        <a
          href={activeProject.site_url}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="text-sm text-[var(--brand)] hover:underline"
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
            <p className="mt-2 text-2xl font-bold text-[var(--text)]">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <p className="text-sm text-[var(--muted)]">
          חיבור WordPress, עורך הפוסטים, יצירת תוכן ותמונות עם AI ומנוע הרעיונות —
          ייבנו בשלבים הבאים.
        </p>
      </Card>
    </div>
  );
}

function DashboardInner() {
  const { projects, loading } = useProjects();
  const [nav, setNav] = useState<NavKey>("overview");
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex h-full">
      <Sidebar active={nav} onNavigate={setNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onAdd={() => setAddOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-[var(--bg)]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-7" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} />
          ) : nav === "overview" ? (
            <Overview />
          ) : nav === "posts" ? (
            <Placeholder title="פוסטים" />
          ) : nav === "ideas" ? (
            <Placeholder title="רעיונות" />
          ) : (
            <Placeholder title="הגדרות" />
          )}
        </main>
      </div>
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
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
