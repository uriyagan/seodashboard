import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProductRow {
  wp_id: number;
  name: string;
  stock_status: string;
  total_sales: number;
  date_created: string | null;
  category_ids: number[];
  image_url: string | null;
}

/** Loads all synced products for a project (RLS-scoped). */
export async function loadProducts(sb: SupabaseClient, projectId: string): Promise<ProductRow[]> {
  const { data } = await sb
    .from("products")
    .select("wp_id, name, stock_status, total_sales, date_created, category_ids, image_url")
    .eq("project_id", projectId);
  return (data ?? []) as ProductRow[];
}

/** In-stock products of a category. */
function inStockForCategory(products: ProductRow[], catId: number): ProductRow[] {
  return products.filter(
    (p) => p.stock_status === "instock" && p.category_ids.includes(catId)
  );
}

export interface CategoryStat {
  id: number;
  name: string;
  count: number;
}

/**
 * Product categories that have at least `min` in-stock products — the ones
 * eligible for idea generation (spec 1.6). Sorted by product count desc.
 */
export function eligibleCategories(
  products: ProductRow[],
  names: Map<number, string>,
  min = 5
): CategoryStat[] {
  const counts = new Map<number, number>();
  for (const p of products) {
    if (p.stock_status !== "instock") continue;
    for (const cid of p.category_ids) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  const out: CategoryStat[] = [];
  for (const [id, count] of counts) {
    if (count >= min && names.has(id)) out.push({ id, name: names.get(id)!, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Up to `limit` top product names for a category (spec 1.4): 80% by sales
 * volume + 20% newest products, in-stock only, de-duplicated.
 */
export function topProductsForCategory(
  products: ProductRow[],
  catId: number,
  limit = 50
): string[] {
  const inStock = inStockForCategory(products, catId);
  const bySales = [...inStock].sort((a, b) => b.total_sales - a.total_sales);
  const byNew = [...inStock].sort((a, b) =>
    (b.date_created ?? "").localeCompare(a.date_created ?? "")
  );
  const nSales = Math.round(limit * 0.8);
  const picked = new Map<number, string>();
  for (const p of bySales) {
    if (picked.size >= nSales) break;
    if (p.name) picked.set(p.wp_id, p.name);
  }
  for (const p of byNew) {
    if (picked.size >= limit) break;
    if (!picked.has(p.wp_id) && p.name) picked.set(p.wp_id, p.name);
  }
  return [...picked.values()];
}
