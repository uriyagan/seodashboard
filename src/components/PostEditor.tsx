import { useEffect, useState } from "react";
import {
  ArrowRight,
  ImagePlus,
  Save,
  Sparkles,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { TermSelect, type Term } from "@/components/TermSelect";
import { RichEditor } from "@/components/RichEditor";

interface EditorState {
  id: string | null;
  wp_post_id: number | null;
  title: string;
  content_html: string;
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
  featured_image_url: string;
  featured_media: number | null;
  categories: Term[];
  tags: Term[];
}

const BLANK: EditorState = {
  id: null,
  wp_post_id: null,
  title: "",
  content_html: "",
  focus_keyword: "",
  seo_title: "",
  meta_description: "",
  featured_image_url: "",
  featured_media: null,
  categories: [],
  tags: [],
};

export function PostEditor({
  postId,
  onBack,
}: {
  postId: string | null;
  onBack: () => void;
}) {
  const { activeProject } = useProjects();
  const [state, setState] = useState<EditorState>(BLANK);
  const [loading, setLoading] = useState(Boolean(postId));
  const [busy, setBusy] = useState<null | "save" | "push" | "write" | "image">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  // Load existing post (local row; fetch WP content if empty).
  useEffect(() => {
    if (!postId || !activeProject) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("posts").select("*").eq("id", postId).single();
      if (data) {
        let content = data.content_html as string;
        if (!content && data.wp_post_id) {
          try {
            const r = await api<{ ok: boolean; post?: { content_html: string; focus_keyword: string; seo_title: string; meta_description: string } }>(
              `/api/projects/${activeProject.id}/posts/${data.wp_post_id}`,
              undefined,
              "GET"
            );
            if (r.ok && r.post) {
              content = r.post.content_html;
              data.focus_keyword ||= r.post.focus_keyword;
              data.seo_title ||= r.post.seo_title;
              data.meta_description ||= r.post.meta_description;
            }
          } catch { /* keep empty */ }
        }
        setState({
          id: data.id,
          wp_post_id: data.wp_post_id,
          title: data.title ?? "",
          content_html: content ?? "",
          focus_keyword: data.focus_keyword ?? "",
          seo_title: data.seo_title ?? "",
          meta_description: data.meta_description ?? "",
          featured_image_url: data.featured_image_url ?? "",
          featured_media: null,
          categories: (data.categories ?? []) as Term[],
          tags: (data.tags ?? []) as Term[],
        });
      }
      setLoading(false);
    })();
  }, [postId, activeProject]);

  if (!activeProject) return null;

  async function saveLocal(): Promise<string | null> {
    const row = {
      id: state.id ?? undefined,
      project_id: activeProject!.id,
      wp_post_id: state.wp_post_id,
      title: state.title,
      content_html: state.content_html,
      focus_keyword: state.focus_keyword,
      seo_title: state.seo_title,
      meta_description: state.meta_description,
      featured_image_url: state.featured_image_url || null,
      categories: state.categories,
      tags: state.tags,
      local_status: "editing",
    };
    const { data, error } = await supabase.from("posts").upsert(row).select("id").single();
    if (error) throw error;
    if (data?.id && !state.id) set("id", data.id);
    return data?.id ?? state.id;
  }

  async function onSave() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      await saveLocal();
      setNotice("הטיוטה נשמרה מקומית.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onPush() {
    setBusy("push");
    setError(null);
    setNotice(null);
    try {
      await saveLocal();
      const r = await api<{ ok: boolean; wpId?: number; error?: string }>(
        `/api/projects/${activeProject!.id}/posts/push`,
        {
          postId: state.id,
          wpId: state.wp_post_id,
          title: state.title,
          content_html: state.content_html,
          categories: state.categories,
          tags: state.tags,
          featured_media: state.featured_media,
          featured_image_url: state.featured_image_url || null,
          focus_keyword: state.focus_keyword,
          seo_title: state.seo_title,
          meta_description: state.meta_description,
        }
      );
      if (!r.ok) throw new Error(r.error || "הדחיפה נכשלה");
      if (r.wpId) set("wp_post_id", r.wpId);
      setNotice("נדחף ל-WordPress כטיוטה בהצלחה ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "הדחיפה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onWriteAI() {
    if (!state.title.trim()) {
      setError("הזן כותרת / נושא לפני יצירת תוכן עם AI.");
      return;
    }
    setBusy("write");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ ok: boolean; article?: EditorState; error?: string }>(
        `/api/projects/${activeProject!.id}/ai/write`,
        { topic: state.title.trim() }
      );
      if (!r.ok || !r.article) throw new Error(r.error || "יצירת התוכן נכשלה");
      const a = r.article as unknown as {
        title: string;
        content_html: string;
        focus_keyword: string;
        seo_title: string;
        meta_description: string;
      };
      setState((s) => ({
        ...s,
        title: a.title || s.title,
        content_html: a.content_html,
        focus_keyword: a.focus_keyword,
        seo_title: a.seo_title,
        meta_description: a.meta_description,
      }));
      setNotice("התוכן נוצר עם Gemini ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת התוכן נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onGenImage() {
    setBusy("image");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ ok: boolean; url?: string; mediaId?: number; error?: string }>(
        `/api/projects/${activeProject!.id}/ai/image`,
        { specific: `תמונה ראשית לפוסט: ${state.title}`, role: "featured", upload: true }
      );
      if (!r.ok || !r.url) throw new Error(r.error || "יצירת התמונה נכשלה");
      set("featured_image_url", r.url);
      set("featured_media", r.mediaId ?? null);
      setNotice("תמונה ראשית נוצרה והועלתה ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת התמונה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-[60px] py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--text)]"
        >
          <ArrowRight className="size-4" />
          חזרה לפוסטים
        </button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSave} loading={busy === "save"}>
            <Save className="size-4" />
            שמירת טיוטה
          </Button>
          <Button onClick={onPush} loading={busy === "push"}>
            <UploadCloud className="size-4" />
            דחיפה ל-WordPress
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col p-[60px]">
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        {notice && <div className="mb-4"><Alert variant="success">{notice}</Alert></div>}

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[1fr_340px]">
          {/* Main — fills to the bottom; the editor scrolls internally */}
          <div className="flex min-h-0 flex-col gap-4">
            <Input
              value={state.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="כותרת הפוסט"
              className="h-14 !text-xl font-bold"
            />
            <Button variant="outline" onClick={onWriteAI} loading={busy === "write"} className="w-full">
              <Wand2 className="size-4" />
              כתוב את הפוסט עם Gemini (לפי הכותרת)
            </Button>
            <div className="min-h-0 flex-1">
              <RichEditor value={state.content_html} onChange={(html) => set("content_html", html)} />
            </div>
          </div>

          {/* Sidebar — scrolls independently */}
          <div className="space-y-4 overflow-y-auto">
            {/* Featured image */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">תמונה ראשית</h3>
              {state.featured_image_url ? (
                <img
                  src={state.featured_image_url}
                  alt="תמונה ראשית"
                  className="mb-3 w-full rounded-lg border border-[var(--border)]"
                />
              ) : (
                <div className="mb-3 flex h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)]">
                  <ImagePlus className="size-6" />
                </div>
              )}
              <Button variant="outline" onClick={onGenImage} loading={busy === "image"} className="w-full">
                <Sparkles className="size-4" />
                צור תמונה (Nano Banana 2)
              </Button>
              <Input
                dir="ltr"
                className="mt-2"
                placeholder="או הדבק כתובת תמונה"
                value={state.featured_image_url}
                onChange={(e) => set("featured_image_url", e.target.value)}
              />
            </Card>

            {/* Taxonomies */}
            <Card className="space-y-4 p-4">
              <TermSelect
                projectId={activeProject.id}
                taxonomy="category"
                apiTaxonomy="categories"
                label="קטגוריות"
                selected={state.categories}
                onChange={(t) => set("categories", t)}
              />
              <TermSelect
                projectId={activeProject.id}
                taxonomy="post_tag"
                apiTaxonomy="tags"
                label="תגיות"
                selected={state.tags}
                onChange={(t) => set("tags", t)}
              />
            </Card>

            {/* Yoast SEO */}
            <Card className="space-y-3 p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">Yoast SEO</h3>
              <div>
                <Label htmlFor="fk">מילת מפתח (Focus Keyword)</Label>
                <Input id="fk" value={state.focus_keyword} onChange={(e) => set("focus_keyword", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="st">כותרת SEO</Label>
                <Input id="st" value={state.seo_title} onChange={(e) => set("seo_title", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="md">תיאור מטא</Label>
                <textarea
                  id="md"
                  rows={3}
                  value={state.meta_description}
                  onChange={(e) => set("meta_description", e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                />
                <p className="mt-1 text-xs text-[var(--muted)]">{state.meta_description.length} תווים</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
