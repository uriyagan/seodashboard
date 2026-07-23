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
import "tinymce/plugins/quickbars/plugin.min.js";

// Content styles (injected into the editor iframe)
import contentCss from "tinymce/skins/content/default/content.min.css?raw";
import contentUiCss from "tinymce/skins/ui/oxide/content.min.css?raw";

export interface RichEditorHandle {
  selection: { getContent: () => string };
  insertContent: (html: string) => void;
  getContent: () => string;
  /** Uploads any pending blob/data images to WordPress and rewrites their src. */
  uploadImages: () => Promise<unknown>;
}

export function RichEditor({
  value,
  onChange,
  onInit,
  onUploadImage,
}: {
  value: string;
  onChange: (html: string) => void;
  onInit?: (editor: RichEditorHandle) => void;
  /** Uploads an image to WordPress media and returns its public URL. */
  onUploadImage?: (base64: string, filename: string, mimeType: string) => Promise<{ url: string }>;
}) {
  return (
    <Editor
      value={value}
      onEditorChange={onChange}
      onInit={(_evt, editor) => onInit?.(editor as never)}
      licenseKey="gpl"
      init={{
        height: "100%",
        menubar: true,
        skin: false,
        content_css: false,
        directionality: "rtl",
        branding: false,
        promotion: false,
        // Let the browser's/OS native spellcheck underline + suggest corrections.
        browser_spellcheck: true,
        contextmenu: false,
        // Body-image handling: paste/drop/upload go to the WordPress media library.
        automatic_uploads: true,
        paste_data_images: true,
        image_caption: true,
        image_title: true,
        file_picker_types: "image",
        images_upload_handler: onUploadImage
          ? (blobInfo: { base64: () => string; filename: () => string; blob: () => Blob }) =>
              onUploadImage(blobInfo.base64(), blobInfo.filename(), blobInfo.blob().type).then(
                (r) => r.url
              )
          : undefined,
        file_picker_callback: (cb: (url: string, meta?: { title?: string }) => void) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const ed = (window as unknown as { tinymce?: { activeEditor?: any } }).tinymce?.activeEditor;
              const id = `blobid${Date.now()}`;
              const base64 = String(reader.result).split(",")[1] ?? "";
              const blobCache = ed?.editorUpload?.blobCache;
              const blobItem = blobCache?.create(id, file, base64);
              blobCache?.add(blobItem);
              cb(blobItem.blobUri(), { title: file.name });
            };
            reader.readAsDataURL(file);
          };
          input.click();
        },
        quickbars_insert_toolbar: false,
        quickbars_selection_toolbar: false,
        quickbars_image_toolbar:
          "alignleft aligncenter alignright | image | removeimage openimage",
        setup: (editor: any) => {
          editor.ui.registry.addButton("removeimage", {
            icon: "remove",
            tooltip: "הסרת התמונה",
            onAction: () => editor.execCommand("mceRemoveNode", false, editor.selection.getNode()),
          });
          editor.ui.registry.addButton("openimage", {
            icon: "fullscreen",
            tooltip: "פתיחה בגודל מלא",
            onAction: () => {
              const src = (editor.selection.getNode() as HTMLImageElement)?.src;
              if (src) window.open(src, "_blank", "noopener");
            },
          });
        },
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
          "figure.image{display:table;margin:1rem auto}",
          "figure.image figcaption{font-size:14px;color:#666;text-align:center;margin-top:.4rem}",
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
          "quickbars",
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
