import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Link as MdastLink, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "../lib/router";

// Mirrors the server's TagParser: a "#" not preceded by a word character, "/", "#" or "&", followed by a letter,
// digit or underscore; nested tags use "/". Purely numeric tags ("#123") are left as text.
const TAG_PATTERN = /(?<![\p{L}\p{N}_/#&])#([\p{L}\p{N}_][\p{L}\p{N}_/-]{0,63})/gu;

/** Turns #tags in text into links to the tag's note list (never inside code or existing links). */
function remarkTags() {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        [
          TAG_PATTERN,
          (match: string, raw: string): MdastLink | false => {
            const tag = raw.replace(/[/-]+$/, "").toLowerCase();
            if (!tag || /^\d+$/.test(tag)) return false;
            return {
              type: "link",
              url: `/?tag=${encodeURIComponent(tag)}`,
              data: { hProperties: { className: ["tag"] } },
              children: [{ type: "text", value: match }],
            };
          },
        ],
      ],
      { ignore: ["link", "linkReference", "inlineCode", "code"] },
    );
  };
}

// The text of a list item, without its nested lists.
function itemText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";
  return node.children.map(itemText).join("");
}

/**
 * Marks each task-list checkbox with where its item starts in the Markdown (`data-task`) and names it after the item,
 * so a tick can change the right line of the note.
 */
function rehypeTasks() {
  const visit = (node: HastRoot | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const offset = child.position?.start.offset;
      if (child.tagName === "li" && offset !== undefined) {
        // A tight item starts with its checkbox; a loose one starts with a paragraph that does.
        const first = child.children.find((c) => c.type === "element");
        const box = first?.tagName === "p" ? first.children[0] : first;
        if (box?.type === "element" && box.tagName === "input" && box.properties.type === "checkbox") {
          box.properties.dataTask = offset;
          box.properties.ariaLabel = child.children.map(itemText).join("").replace(/\s+/g, " ").trim() || undefined;
        }
      }
      visit(child);
    }
  };
  return (tree: HastRoot) => visit(tree);
}

/** Ticks or unticks the task-list item whose marker starts at an offset in the rendered Markdown. */
const TaskToggle = createContext<((offset: number) => void) | null>(null);

function Input({ node: _node, ...props }: ComponentProps<"input"> & ExtraProps) {
  const toggle = useContext(TaskToggle);
  const offset = Number((props as Record<string, unknown>)["data-task"]);
  if (props.type !== "checkbox" || !toggle || !Number.isInteger(offset)) return <input {...props} />;
  return <input type="checkbox" checked={props.checked ?? false} aria-label={props["aria-label"]} onChange={() => toggle(offset)} />;
}

/** An address in the app itself: a path, but not `//host/…` or `/\host`, which browsers read as another site. */
const isAppPath = (href: string) => href.startsWith("/") && !/^\/[/\\]/.test(href);

/** The account's own attachments, the only images a note shows: no other request is made just by viewing a note. */
const ATTACHMENT_IMAGE = /^\/(?:api\/v1|e2ee)\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\?[\w=&.-]*)?$/i;

const components: Components = {
  input: Input,
  img({ src, alt }) {
    if (typeof src === "string" && ATTACHMENT_IMAGE.test(src)) return <img src={src} alt={alt ?? ""} loading="lazy" />;
    return alt ? <span>{alt}</span> : null;
  },
  a({ href = "", children, className }) {
    if (isAppPath(href)) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
};

/**
 * Renders note Markdown (GitHub-flavoured: task lists, tables, strikethrough, autolinks). Raw HTML in a note is never
 * rendered (react-markdown drops it), so a note cannot inject markup or scripts. With `onToggleTask`, task-list
 * checkboxes can be ticked; it gets the offset in `content` where the item's list marker starts (see toggleTask).
 */
export function Markdown({ content, onToggleTask }: { content: string; onToggleTask?: (offset: number) => void }) {
  return (
    <div className="markdown">
      <TaskToggle.Provider value={onToggleTask ?? null}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkTags]} rehypePlugins={[rehypeTasks]} components={components}>
          {content}
        </ReactMarkdown>
      </TaskToggle.Provider>
    </div>
  );
}
