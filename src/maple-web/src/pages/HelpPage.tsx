import { Markdown } from "../components/Markdown";
import { VersionNote } from "../components/VersionNote";
import { GUIDE } from "../help/guide";
import { useBranding } from "../lib/branding";

/** The user guide: a contents list, then every section. It ships with the app, so it also works offline. */
export function HelpPage() {
  const { appName } = useBranding();
  const named = (text: string) => text.replaceAll("Maple Notes", appName); // the guide speaks of the app by its name

  function jump(id: string) {
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById(`help-${id}`)?.focus({ preventScroll: true });
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Help</h1>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">How to get the most out of {appName}.</p>

      <nav aria-label="Contents" className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-2 text-sm font-semibold">Contents</h2>
        <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {GUIDE.map((section) => (
            <li key={section.id}>
              <a
                href={`#help-${section.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  jump(section.id);
                }}
                className="text-maple-700 underline decoration-maple-700/30 underline-offset-2 hover:decoration-maple-700 dark:text-maple-400"
              >
                {named(section.title)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-4">
        {GUIDE.map((section) => (
          <section
            key={section.id}
            id={`help-${section.id}`}
            tabIndex={-1}
            aria-labelledby={`help-${section.id}-title`}
            className="scroll-mt-20 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm outline-none dark:border-stone-800 dark:bg-stone-900"
          >
            <h2 id={`help-${section.id}-title`} className="mb-2 text-base font-semibold">
              {named(section.title)}
            </h2>
            <Markdown content={named(section.body)} />
          </section>
        ))}
      </div>
      <VersionNote />
    </>
  );
}
