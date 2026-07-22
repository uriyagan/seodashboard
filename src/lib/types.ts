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
  created_at: string;
  updated_at: string;
}

export interface Admin {
  id: string;
  email: string;
  full_name: string | null;
}
