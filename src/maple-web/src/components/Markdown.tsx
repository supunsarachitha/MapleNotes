import type { Link as MdastLink, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import ReactMarkdown, { type Components } from "react-markdown";
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

const components: Components = {
  a({ href = "", children, className }) {
    if (href.startsWith("/")) {
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
 * rendered (react-markdown drops it), so a note cannot inject markup or scripts.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkTags]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
