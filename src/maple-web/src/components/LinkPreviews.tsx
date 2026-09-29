import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { api } from "../lib/api";
import { linksIn } from "../lib/links";

function LinkPreviewCard({ url }: { url: string }) {
  const preview = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => api.linkPreview(url),
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
  if (!preview.data) return null;
  const { title, description, siteName } = preview.data;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="block rounded-xl border border-stone-200 px-3 py-2.5 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/60"
    >
      <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{siteName}</span>
      </span>
      <span className="mt-0.5 block font-medium leading-snug text-stone-900 dark:text-stone-100">{title}</span>
      {description && <span className="mt-0.5 line-clamp-2 block text-sm text-stone-600 dark:text-stone-300">{description}</span>}
    </a>
  );
}

/** Previews of the first links in a note (title, description, site), for accounts that turned them on. */
export function LinkPreviews({ content }: { content: string }) {
  const links = linksIn(content);
  if (links.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" aria-label="Link previews">
      {links.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
    </div>
  );
}
