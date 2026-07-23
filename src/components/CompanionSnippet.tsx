import { useState } from "react";
import { Check, Copy, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";

/** The companion snippet with the project's token filled in, plus a copy button. */
export function CompanionSnippet({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const snippet = `add_action('init', function () {
    foreach (['_yoast_wpseo_focuskw','_yoast_wpseo_title','_yoast_wpseo_metadesc'] as $k) {
        register_post_meta('post', $k, ['show_in_rest'=>true,'single'=>true,'type'=>'string',
            'auth_callback'=>function(){return current_user_can('edit_posts');}]);
    }
});
add_action('rest_api_init', function(){
    register_rest_route('seodash/v1','/sync',['methods'=>'GET',
        'permission_callback'=>function(){return current_user_can('edit_posts');},
        'callback'=>'seo_dash_full_sync']);
});
function seo_dash_terms($tax){ $o=[]; if(!taxonomy_exists($tax)) return $o; foreach(get_terms(['taxonomy'=>$tax,'hide_empty'=>false]) as $t){ if(is_wp_error($t)) continue; $o[]=['id'=>$t->term_id,'name'=>$t->name,'slug'=>$t->slug,'link'=>get_term_link($t)]; } return $o; }
function seo_dash_full_sync(){
    $posts=[];
    foreach(get_posts(['post_type'=>'post','post_status'=>['publish','draft','pending','private','future'],'numberposts'=>-1]) as $p){
        $posts[]=['id'=>$p->ID,'title'=>$p->post_title,'status'=>$p->post_status,'link'=>get_permalink($p->ID),
            'image'=>get_the_post_thumbnail_url($p->ID,'medium')?:'',
            'date'=>mysql2date('c',$p->post_date_gmt),'modified'=>mysql2date('c',$p->post_modified_gmt),
            'categories'=>wp_get_post_categories($p->ID),'tags'=>wp_get_post_tags($p->ID,['fields'=>'ids'])];
    }
    $pages=[]; foreach(get_posts(['post_type'=>'page','post_status'=>'publish','numberposts'=>-1]) as $p){ $pages[]=['id'=>$p->ID,'title'=>$p->post_title,'link'=>get_permalink($p->ID)]; }
    return ['posts'=>$posts,'categories'=>seo_dash_terms('category'),'tags'=>seo_dash_terms('post_tag'),
        'product_categories'=>seo_dash_terms('product_cat'),'product_tags'=>seo_dash_terms('product_tag'),
        'products'=>seo_dash_products(),'pages'=>$pages,'yoast'=>defined('WPSEO_VERSION')];
}
function seo_dash_products(){
    if(!function_exists('wc_get_products')) return [];
    $out=[]; $page=1;
    do {
        $q=wc_get_products(['status'=>'publish','limit'=>200,'page'=>$page,'orderby'=>'date','order'=>'DESC']);
        if(empty($q)) break;
        foreach($q as $p){
            $dc=$p->get_date_created();
            $out[]=['id'=>$p->get_id(),'name'=>$p->get_name(),'sku'=>$p->get_sku(),
                'stock_status'=>$p->get_stock_status(),'total_sales'=>(int)$p->get_total_sales(),
                'price'=>$p->get_price(),'date_created'=>$dc?$dc->date('c'):null,
                'image'=>($p->get_image_id()?wp_get_attachment_image_url($p->get_image_id(),'medium'):'')?:'',
                'categories'=>$p->get_category_ids()];
        }
        if(count($q)<200) break;
        $page++;
    } while($page<=25);
    return $out;
}
add_filter('cron_schedules', function($s){ $s['seo_dash_min']=['interval'=>60,'display'=>'SEO Dashboard']; return $s; });
add_action('init', function(){ if(!wp_next_scheduled('seo_dash_poll')) wp_schedule_event(time()+10,'seo_dash_min','seo_dash_poll'); });
add_action('init', function(){ if(time()-(int)get_transient('seo_dash_last_poll')>=5){ set_transient('seo_dash_last_poll',time(),60); seo_dash_run_jobs(); } });
add_action('seo_dash_poll','seo_dash_run_jobs');
function seo_dash_post($p,$d){ return wp_remote_post('https://seo.uriyaganor.com'.$p,['headers'=>['Content-Type'=>'application/json'],'body'=>wp_json_encode($d),'timeout'=>20]); }
function seo_dash_run_jobs(){
    $token='${token}';
    $res=seo_dash_post('/api/companion/claim',['token'=>$token,'limit'=>10]);
    if(is_wp_error($res)) return;
    $jobs=json_decode(wp_remote_retrieve_body($res),true)['jobs']??[];
    if(!$jobs) return;
    $a=get_users(['role'=>'administrator','number'=>1,'fields'=>'ID']); if($a) wp_set_current_user((int)$a[0]);
    $server=rest_get_server();
    foreach($jobs as $j){
        $r=$j['request']; $req=new WP_REST_Request(strtoupper($r['method']??'GET'),$r['route']??'/');
        if(!empty($r['query'])) foreach($r['query'] as $k=>$v) $req->set_param($k,$v);
        if(isset($r['body'])){ $req->set_body(wp_json_encode($r['body'])); $req->set_header('Content-Type','application/json'); }
        $resp=rest_do_request($req);
        seo_dash_post('/api/companion/complete',['token'=>$token,'jobId'=>$j['id'],
            'result'=>['status'=>$resp->get_status(),'headers'=>$resp->get_headers(),'body'=>$server->response_to_data($resp,false)]]);
    }
}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          חומת האש של האתר (SiteGround) חוסמת גישה ישירה. הדבק את הסניפט הבא בסוף
          <b> functions.php של תבנית הבן</b> (או ב-mu-plugin) — הוא מחבר את האתר לדשבורד.
        </span>
      </div>

      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          onClick={copy}
          className="absolute left-2 top-2 z-10"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "הועתק" : "העתק"}
        </Button>
        <pre
          dir="ltr"
          className="max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left text-xs leading-relaxed text-[var(--text)]"
        >
          <code>{snippet}</code>
        </pre>
      </div>
      <p className="text-xs text-[var(--muted)]">
        טיפ: לאמינות מלאה, הוסף ב-SiteGround → Site Tools → Cron Jobs משימה שמריצה את
        <span dir="ltr"> wp-cron.php </span> כל דקה.
      </p>
    </div>
  );
}
