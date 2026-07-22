import { Editor } from "@tinymce/tinymce-react";

// --- Self-hosted TinyMCE (no cloud API key) ---
import "tinymce/tinymce";
import "tinymce/models/dom/model.min.js";
import "tinymce/themes/silver/theme.min.js";
import "tinymce/icons/default/icons.min.js";
import "tinymce/skins/ui/oxide/skin.min.css";

// Plugins (Classic-Editor-like toolbar)
import "tinymce/plugins/advlist/plugin.min.js";
import "tinymce/plugins/autolink/plugin.min.js";
import "tinymce/plugins/lists/plugin.min.js";
import "tinymce/plugins/link/plugin.min.js";
import "tinymce/plugins/image/plugin.min.js";
import "tinymce/plugins/media/plugin.min.js";
import "tinymce/plugins/table/plugin.min.js";
import "tinymce/plugins/code/plugin.min.js";
import "tinymce/plugins/fullscreen/plugin.min.js";
import "tinymce/plugins/searchreplace/plugin.min.js";
import "tinymce/plugins/wordcount/plugin.min.js";
import "tinymce/plugins/directionality/plugin.min.js";

// Content styles (injected into the editor iframe)
import contentCss from "tinymce/skins/content/default/content.min.css?raw";
import contentUiCss from "tinymce/skins/ui/oxide/content.min.css?raw";

export function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  return (
    <Editor
      value={value}
      onEditorChange={onChange}
      licenseKey="gpl"
      init={{
        height: "100%",
        menubar: true,
        skin: false,
        content_css: false,
        directionality: "rtl",
        branding: false,
        promotion: false,
        content_style: [
          contentCss,
          contentUiCss,
          // Load Google Sans inside the editor iframe.
          "@font-face{font-family:'Google Sans';src:url('/fonts/GoogleSans.woff2') format('woff2');font-weight:100 900;font-display:swap}",
          // Font sizes matched to the live site rendering.
          "body{font-family:'Google Sans',Arial,sans-serif;direction:rtl;font-size:18px;line-height:1.7;margin:1rem}",
          "p{font-size:18px}",
          "h1{font-size:60px;line-height:1.1}",
          "h2{font-size:50px;line-height:1.15}",
          "h3{font-size:40px;line-height:1.2}",
          "h4{font-size:30px;line-height:1.25}",
          // Fit media to the editor width (no horizontal scroll).
          "img,video,iframe{max-width:100%;height:auto}",
          "table{max-width:100%;table-layout:fixed;word-break:break-word}",
        ].join("\n"),
        plugins: [
          "advlist",
          "autolink",
          "lists",
          "link",
          "image",
          "media",
          "table",
          "code",
          "fullscreen",
          "searchreplace",
          "wordcount",
          "directionality",
        ],
        toolbar:
          "undo redo | blocks | bold italic underline | forecolor backcolor | " +
          "alignright aligncenter alignleft | bullist numlist | link image media table | " +
          "ltr rtl | removeformat code fullscreen",
        block_formats:
          "פסקה=p; כותרת 2=h2; כותרת 3=h3; כותרת 4=h4; ציטוט=blockquote",
      }}
    />
  );
}
