import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ImagePlus,
  Maximize2,
  Package,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { TermSelect, type Term } from "@/components/TermSelect";
import { RichEditor } from "@/components/RichEditor";
import { YoastAnalysis } from "@/components/YoastAnalysis";
import { InternalLinks } from "@/components/InternalLinks";
import { measureTitleWidth } from "@/lib/yoast";

/** Approximate the post slug from its title (keeps Hebrew letters). */
function slugify(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

interface PickedProduct {
  wp_id: number;
  name: string;
  image_url: string;
}

/** Modal grid to pick up to 3 category products for image generation (spec §5.3). */
function ProductPicker({
  projectId,
  categoryId,
  selected,
  onClose,
  onConfirm,
}: {
  projectId: string;
  categoryId: number | null;
  selected: PickedProduct[];
  onClose: () => void;
  onConfirm: (products: PickedProduct[]) => void;
}) {
  const [products, setProducts] = useState<PickedProduct[] | null>(null);
  const [picked, setPicked] = useState<PickedProduct[]>(selected);

  useEffect(() => {
    const q = categoryId ? `?categoryId=${categoryId}` : "";
    api<{ products: PickedProduct[] }>(
      `/api/projects/${projectId}/category-products${q}`,
      undefined,
      "GET"
    )
      .then((r) => setProducts(r.products))
      .catch(() => setProducts([]));
  }, [projectId, categoryId]);

  function toggle(p: PickedProduct) {
    setPicked((prev) =>
      prev.some((x) => x.wp_id === p.wp_id)
        ? prev.filter((x) => x.wp_id !== p.wp_id)
        : prev.length >= 3
          ? prev
          : [...prev, p]
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-bold text-[var(--text)]">בחירת מוצרים לשילוב בתמונה</h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-3 text-sm text-[var(--muted)]">בחר עד 3 מוצרים ({picked.length}/3).</p>
          {!products && (
            <div className="flex justify-center py-10">
              <Spinner className="size-6" />
            </div>
          )}
          {products && products.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              אין מוצרים במלאי לקטגוריה זו. ודא שהאתר מסונכרן.
            </p>
          )}
          {products && products.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {products.map((p) => {
                const on = picked.some((x) => x.wp_id === p.wp_id);
                return (
                  <button
                    key={p.wp_id}
                    onClick={() => toggle(p)}
                    className={`group flex flex-col overflow-hidden rounded-lg border-2 text-right transition-colors ${
                      on ? "border-[var(--brand)]" : "border-[var(--border)] hover:border-[var(--muted)]"
                    }`}
                  >
                    <img src={p.image_url} alt={p.name} className="aspect-square w-full object-cover" />
                    <span className="line-clamp-2 p-1.5 text-xs text-[var(--text)]">{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button variant="ghost" onClick={onClose}>ביטול</Button>
          <Button onClick={() => onConfirm(picked)}>
            אישור ({picked.length})
          </Button>
        </div>
      </div>
    </div>
  );
}

interface EditorState {
  id: string | null;
  wp_post_id: number | null;
  title: string;
  content_html: string;
  status: string;
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
  featured_image_url: string;
  featured_media: number | null;
  categories: Term[];
  tags: Term[];
  product_category_id: number | null;
  product_category_name: string | null;
  product_names: string[];
}

const BLANK: EditorState = {
  id: null,
  wp_post_id: null,
  title: "",
  content_html: "",
  status: "draft",
  focus_keyword: "",
  seo_title: "",
  meta_description: "",
  featured_image_url: "",
  featured_media: null,
  categories: [],
  tags: [],
  product_category_id: null,
  product_category_name: null,
  product_names: [],
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "טיוטה" },
  { value: "publish", label: "מפורסם" },
  { value: "pending", label: "ממתין לבדיקה" },
  { value: "private", label: "פרטי" },
];

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
  const [busy, setBusy] = useState<null | "save" | "push" | "write" | "image" | "upload">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [productRef, setProductRef] = useState<{
    base64: string;
    mimeType: string;
    preview: string;
  } | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [pickedProducts, setPickedProducts] = useState<PickedProduct[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  function removeFeatured() {
    setState((s) => ({ ...s, featured_image_url: "", featured_media: null }));
  }

  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  /** Wrap the first non-linked occurrence of `anchor` in the content with a link. */
  function applyLinkSuggestion(anchor: string, url: string) {
    setState((s) => {
      const parts = s.content_html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
      let done = false;
      for (let i = 0; i < parts.length && !done; i++) {
        if (/^<a\b/i.test(parts[i])) continue; // don't touch existing links
        const idx = parts[i].indexOf(anchor);
        if (idx !== -1) {
          parts[i] =
            parts[i].slice(0, idx) +
            `<a href="${url}">${anchor}</a>` +
            parts[i].slice(idx + anchor.length);
          done = true;
        }
      }
      return done ? { ...s, content_html: parts.join("") } : s;
    });
  }

  // Load existing post (local row; fetch WP content if empty).
  useEffect(() => {
    if (!postId || !activeProject) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("posts").select("*").eq("id", postId).single();
      if (data) {
        let content = data.content_html as string;
        let featuredUrl = (data.featured_image_url as string) ?? "";
        let featuredMedia: number | null = null;
        // For synced posts (no local content yet) pull full content + featured image.
        if ((!content || !featuredUrl) && data.wp_post_id) {
          try {
            const r = await api<{
              ok: boolean;
              post?: {
                content_html: string;
                focus_keyword: string;
                seo_title: string;
                meta_description: string;
                featured_image_url: string;
                featured_media: number;
              };
            }>(`/api/projects/${activeProject.id}/posts/${data.wp_post_id}`, undefined, "GET");
            if (r.ok && r.post) {
              content = content || r.post.content_html;
              featuredUrl = featuredUrl || r.post.featured_image_url;
              featuredMedia = r.post.featured_media || null;
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
          status: data.wp_status ?? "draft",
          focus_keyword: data.focus_keyword ?? "",
          seo_title: data.seo_title ?? "",
          meta_description: data.meta_description ?? "",
          featured_image_url: featuredUrl,
          featured_media: featuredMedia,
          categories: (data.categories ?? []) as Term[],
          tags: (data.tags ?? []) as Term[],
          product_category_id: (data.product_category_id as number | null) ?? null,
          product_category_name: (data.product_category_name as string | null) ?? null,
          product_names: (data.product_names as string[] | null) ?? [],
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
      wp_status: state.status,
      local_status: "editing",
      product_category_id: state.product_category_id,
      product_category_name: state.product_category_name,
      product_names: state.product_names,
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
      setNotice("נשמר מקומית.");
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
      const r = await api<{ ok: boolean; wpId?: number; status?: string; error?: string }>(
        `/api/projects/${activeProject!.id}/posts/push`,
        {
          postId: state.id,
          wpId: state.wp_post_id,
          title: state.title,
          content_html: state.content_html,
          status: state.status,
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
      const label = STATUS_OPTIONS.find((s) => s.value === state.status)?.label ?? "";
      setNotice(`נשמר ל-WordPress (${label}) בהצלחה ✓`);
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
      const r = await api<{
        ok: boolean;
        article?: {
          title: string;
          content_html: string;
          focus_keyword: string;
          seo_title: string;
          meta_description: string;
        };
        category_id?: number | null;
        category_name?: string | null;
        product_names?: string[];
        error?: string;
      }>(`/api/projects/${activeProject!.id}/ai/write`, {
        topic: state.title.trim(),
        categoryId: state.product_category_id ?? undefined,
      });
      if (!r.ok || !r.article) throw new Error(r.error || "יצירת התוכן נכשלה");
      const a = r.article;
      setState((s) => ({
        ...s,
        title: a.title || s.title,
        content_html: a.content_html,
        focus_keyword: a.focus_keyword,
        seo_title: a.seo_title,
        meta_description: a.meta_description,
        product_category_id: r.category_id ?? s.product_category_id,
        product_category_name: r.category_name ?? s.product_category_name,
        product_names: r.product_names ?? s.product_names,
      }));
      setNotice(
        r.category_name ? `התוכן נוצר עם Gemini · קטגוריה: ${r.category_name} ✓` : "התוכן נוצר עם Gemini ✓"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת התוכן נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await api<{ ok: boolean; url?: string; mediaId?: number; error?: string }>(
        `/api/projects/${activeProject!.id}/media`,
        { base64, mimeType: file.type || "image/png", filename: file.name || "image.png" }
      );
      if (!r.ok || !r.url) throw new Error(r.error || "ההעלאה נכשלה");
      set("featured_image_url", r.url);
      set("featured_media", r.mediaId ?? null);
      setNotice("התמונה הועלתה ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ההעלאה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function onAttachProduct(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setProductRef({ base64, mimeType: file.type || "image/png", preview: URL.createObjectURL(file) });
  }

  async function onGenImage() {
    setBusy("image");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ ok: boolean; url?: string; mediaId?: number; error?: string }>(
        `/api/projects/${activeProject!.id}/ai/image`,
        {
          specific: `תמונה ראשית לפוסט: ${state.title}`,
          role: "featured",
          upload: true,
          refImages: productRef ? [{ base64: productRef.base64, mimeType: productRef.mimeType }] : [],
          refImageUrls: pickedProducts.map((p) => p.image_url).filter(Boolean),
        }
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-8 sm:py-4 lg:px-[60px]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--text)]"
        >
          <ArrowRight className="size-4" />
          חזרה לפוסטים
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-[var(--muted)] sm:inline">סטטוס:</span>
            <select
              value={state.status}
              onChange={(e) => set("status", e.target.value)}
              className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--brand)]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={onSave} loading={busy === "save"}>
            <Save className="size-4" />
            שמירה מקומית
          </Button>
          <Button onClick={onPush} loading={busy === "push"}>
            <UploadCloud className="size-4" />
            שמירה ל-WordPress
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col p-5 sm:p-8 lg:p-[60px]">
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
            {state.product_category_name && (
              <span className="flex w-fit items-center gap-1 rounded-md bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--muted)]">
                <Package className="size-3.5" />
                קטגוריית מוצרים: {state.product_category_name}
              </span>
            )}
            <Button variant="outline" onClick={onWriteAI} loading={busy === "write"} className="w-full">
              <Wand2 className="size-4" />
              כתוב את הפוסט עם Gemini (לפי הכותרת)
            </Button>
            <div className="min-h-0 flex-1">
              <RichEditor
                value={state.content_html}
                onChange={(html) => set("content_html", html)}
              />
            </div>
          </div>

          {/* Sidebar — scrolls independently */}
          <div className="space-y-4 overflow-y-auto">
            {/* Featured image */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">תמונה ראשית</h3>
              {state.featured_image_url ? (
                <div className="group relative mb-3">
                  <img
                    src={state.featured_image_url}
                    alt="תמונה ראשית"
                    onClick={() => setLightbox(true)}
                    className="w-full cursor-zoom-in rounded-lg border border-[var(--border)]"
                  />
                  <div className="absolute left-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setLightbox(true)}
                      className="flex size-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black/80"
                      title="הגדלה"
                      aria-label="הגדלת התמונה"
                    >
                      <Maximize2 className="size-4" />
                    </button>
                    <button
                      onClick={removeFeatured}
                      className="flex size-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black/80"
                      title="הסרת התמונה"
                      aria-label="הסרת התמונה"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-3 flex h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)]">
                  <ImagePlus className="size-6" />
                </div>
              )}
              <div className="space-y-2">
                {/* Optional product reference for AI generation */}
                <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-2">
                  {productRef ? (
                    <img
                      src={productRef.preview}
                      alt="מוצר"
                      className="size-10 shrink-0 rounded-md border border-[var(--border)] object-cover"
                    />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[var(--muted)]">
                      <Package className="size-4" />
                    </div>
                  )}
                  <button
                    onClick={() => productInputRef.current?.click()}
                    className="flex-1 text-right text-xs text-[var(--brand)] hover:underline"
                  >
                    {productRef ? "החלף מוצר לשילוב" : "צרף מוצר לשילוב בתמונה"}
                  </button>
                  {productRef && (
                    <button
                      onClick={() => setProductRef(null)}
                      className="text-[var(--muted)] hover:text-[var(--text)]"
                      aria-label="הסרה"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                  <input
                    ref={productInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onAttachProduct}
                  />
                </div>

                {/* Pick products from the store's catalog (§5.3) */}
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full rounded-lg border border-[var(--border)] p-2 text-xs text-[var(--brand)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  {pickedProducts.length
                    ? `נבחרו ${pickedProducts.length} מוצרים מהחנות`
                    : "בחר מוצרים מהחנות לשילוב בתמונה"}
                </button>
                {pickedProducts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pickedProducts.map((p) => (
                      <div key={p.wp_id} className="relative">
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="size-10 rounded-md border border-[var(--border)] object-cover"
                        />
                        <button
                          onClick={() =>
                            setPickedProducts((prev) => prev.filter((x) => x.wp_id !== p.wp_id))
                          }
                          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-black/70 text-white"
                          aria-label="הסרה"
                        >
                          <X className="size-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <Button variant="outline" onClick={onGenImage} loading={busy === "image"} className="w-full">
                  <Sparkles className="size-4" />
                  צור תמונה (Nano Banana 2)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  loading={busy === "upload"}
                  className="w-full"
                >
                  <Upload className="size-4" />
                  {state.featured_image_url ? "החלף תמונה" : "העלה תמונה"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onUploadImage}
                />
              </div>
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
                <p className="mt-1 text-xs text-[var(--muted)]">{state.focus_keyword.length} תווים</p>
              </div>
              <div>
                <Label htmlFor="st">כותרת SEO</Label>
                <Input id="st" value={state.seo_title} onChange={(e) => set("seo_title", e.target.value)} />
                <p className="mt-1 text-xs text-[var(--muted)]">{state.seo_title.length} תווים · אידיאלי 50–60</p>
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

            {/* Internal link suggestions */}
            <Card className="p-4">
              <InternalLinks
                projectId={activeProject.id}
                content={state.content_html}
                title={state.title || state.seo_title}
                onApply={applyLinkSuggestion}
              />
            </Card>

            {/* Live Yoast analysis */}
            <Card className="p-4">
              <YoastAnalysis
                input={{
                  content: state.content_html,
                  keyword: state.focus_keyword,
                  title: state.seo_title || state.title,
                  description: state.meta_description,
                  slug: slugify(state.seo_title || state.title),
                  siteUrl: activeProject.site_url,
                  titleWidth: measureTitleWidth(state.seo_title || state.title),
                }}
              />
            </Card>
          </div>
        </div>
      </div>

      {/* Product picker for image generation */}
      {pickerOpen && (
        <ProductPicker
          projectId={activeProject.id}
          categoryId={state.product_category_id}
          selected={pickedProducts}
          onClose={() => setPickerOpen(false)}
          onConfirm={(products) => {
            setPickedProducts(products);
            setPickerOpen(false);
          }}
        />
      )}

      {/* Featured-image lightbox */}
      {lightbox && state.featured_image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(false)}
        >
          <img
            src={state.featured_image_url}
            alt="תמונה ראשית"
            className="max-h-full max-w-full rounded-lg"
          />
          <button
            onClick={() => setLightbox(false)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
