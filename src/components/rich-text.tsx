import DOMPurify from "isomorphic-dompurify";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { Bold, Italic, List, ListOrdered, Code } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "a",
  "blockquote",
];

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

/** Renders stored report HTML after sanitising it again (defence in depth). */
export function SafeHtml({ html, className }: { html: string; className?: string }) {
  if (!html.trim()) return null;
  return (
    <div
      className={`prose-sm max-w-none space-y-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, disabled, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
      }),
    ],
    content: sanitizeHtml(value),
    editorProps: {
      attributes: {
        class:
          "min-h-24 rounded-b-md px-3 py-2 text-sm outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "aria-label": placeholder ?? "Rich text",
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.isEmpty ? "" : sanitizeHtml(instance.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync when the parent swaps the saved report (different day).
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) editor.commands.setContent(sanitizeHtml(value), { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const tool = (active: boolean, label: string, run: () => void, icon: React.ReactNode) => (
    <Button
      type="button"
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="size-7"
      aria-label={label}
      disabled={disabled}
      onClick={run}
    >
      {icon}
    </Button>
  );

  return (
    <div className="rounded-md border bg-background">
      <div className="flex gap-1 border-b p-1">
        {tool(
          editor.isActive("bold"),
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          <Bold className="size-4" />,
        )}
        {tool(
          editor.isActive("italic"),
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          <Italic className="size-4" />,
        )}
        {tool(
          editor.isActive("bulletList"),
          "Bullet list",
          () => editor.chain().focus().toggleBulletList().run(),
          <List className="size-4" />,
        )}
        {tool(
          editor.isActive("orderedList"),
          "Numbered list",
          () => editor.chain().focus().toggleOrderedList().run(),
          <ListOrdered className="size-4" />,
        )}
        {tool(
          editor.isActive("code"),
          "Code",
          () => editor.chain().focus().toggleCode().run(),
          <Code className="size-4" />,
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
