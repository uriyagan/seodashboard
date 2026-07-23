export interface Project {
  id: string;
  name: string;
  site_url: string;
  wp_username: string | null;
  content_prompt: string;
  image_prompt: string;
  keywords: string[];
  cadence_per_week: number;
  stuck_draft_days: number;
  last_post_at: string | null;
  yoast_ready: boolean;
  companion_token: string | null;
  gsc_property: string | null;
  ga_property: string | null;
  is_active: boolean;
  links_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ---- Internal-links feature ---- */

export type LinkSourceType = "post" | "page" | "product" | "product_cat" | "product_tag";

export interface SiteLink {
  id: string;
  source_type: LinkSourceType;
  source_wp_id: number;
  source_title: string;
  source_url: string;
  target_url: string;
  anchor_text: string;
  is_internal: boolean;
}

export interface LinkCheck {
  url: string;
  http_status: number | null;
  result: "ok" | "broken" | "error";
  error: string | null;
  checked_at: string;
}

export interface LinkOpportunity {
  id: string;
  source_type: Exclude<LinkSourceType, "product">;
  source_wp_id: number;
  source_title: string;
  source_url: string;
  anchor_text: string;
  target_url: string;
  target_title: string;
  target_type: string;
  reason: string;
  status: "suggested" | "applied" | "dismissed" | "failed";
  error: string | null;
  applied_at: string | null;
  created_at: string;
}

export interface LinksRefreshResponse {
  ok: boolean;
  done: boolean;
  cursor: { phase: string; page: number };
  progress: { phase: string; page: number; totalPages: number; inserted: number };
}

export interface LinksScanResponse {
  ok: boolean;
  done: boolean;
  cursor: { offset: number };
  progress: { index: number; total: number; found: number };
}

export interface Admin {
  id: string;
  email: string;
  full_name: string | null;
}
