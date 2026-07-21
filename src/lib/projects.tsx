import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";
import type { Project } from "./types";

const ACTIVE_KEY = "seo_dash_active_project";

interface ProjectsContextValue {
  projects: Project[];
  activeProject: Project | null;
  activeId: string | null;
  setActiveId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | undefined>(undefined);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      setError(error.message);
      setProjects([]);
    } else {
      setProjects((data ?? []) as Project[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Keep active selection valid as the project list changes.
  useEffect(() => {
    if (loading) return;
    if (projects.length === 0) {
      setActiveIdState(null);
      return;
    }
    const stillExists = activeId && projects.some((p) => p.id === activeId);
    if (!stillExists) setActiveIdState(projects[0].id);
  }, [projects, loading, activeId]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeId,
      activeProject: projects.find((p) => p.id === activeId) ?? null,
      setActiveId,
      loading,
      error,
      reload,
    }),
    [projects, activeId, setActiveId, loading, error, reload]
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
