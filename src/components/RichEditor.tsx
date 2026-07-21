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
        height: 520,
        menubar: true,
        skin: false,
        content_css: false,
        directionality: "rtl",
        branding: false,
        promotion: false,
        content_style: [
          contentCss,
          contentUiCss,
          "body{font-family:Assistant,Arial,sans-serif;direction:rtl;font-size:16px;line-height:1.7}",
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
