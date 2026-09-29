# Maple Notes 1.2: development plan

Requested 2026-09-29. This plan adds per-account preferences, note titles, todo lists, quick notes, daily notes, an
Advanced settings section, and import (full restore) from exports. Work happens on the branch
`productivity-features`. Earlier plans: [PLAN.md](PLAN.md) (1.0) and [PLAN-E2EE.md](PLAN-E2EE.md) (1.1).

Every feature must work in all three encryption modes, including end-to-end, where the server never sees note text.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Where preferences live | On the server, per account (a JSON column on `Users`), returned with the signed-in user and changed with `PUT /api/v1/account/preferences`. | They follow the user to every device. They are layout choices, not content, so they need no encryption (listed in the threat model). |
| 2 | Note titles | A title is the note's first line written as a Markdown heading (`# Title`). The setting adds a separate title field to the editor and shows that heading as the note's title. | No change to how notes are stored or encrypted. Search, export, import and end-to-end encryption work unchanged, and export file names already come from the first line. Turning the setting off leaves every note intact. |
| 3 | Date in titles | With titles on, a second setting fills a new note's title with today's date, in a format the user picks from a list with a live preview (for example `2026-09-29`, `29/09/2026`, `Sep 29, 2026`, `Monday, 29 September 2026`). The same format names daily notes. | Presets are clear and cannot produce invalid output. English month and day names match the app's language. |
| 4 | Kinds of notes | Each note has a kind: `Note` (Home), `Todo` (a todo list) or `Quick` (a quick note), stored in plain form like the pinned and archived flags. | Todo lists and quick notes then reuse everything notes already have: encryption in every mode, attachments, archive, export and import. |
| 5 | Where each kind appears | Home shows notes, the Todo tab shows todo lists, and the Quick notes tab shows quick notes. Search, tag views and the archive span every enabled kind and label todo lists and quick notes. | Each tab stays focused, while finding things works everywhere. |
| 6 | Todo lists | Created in the Todo tab: a title and items to tick off, stored as Markdown (`# Title`, then `- [ ] item` lines). The tab edits them as checklists: add, tick, edit and remove items, clear completed ones, rename, pin, archive and delete lists. It is on by default. | Markdown task lists already render everywhere else (search results, exports). |
| 7 | Quick notes | A separate tab: a scratchpad composer and a list of quick notes kept out of Home. A quick note can be moved to Home, and back. It is on by default. | Short throwaway notes do not clutter the timeline. |
| 8 | Daily notes | When enabled, Home shows a "Today" card titled with the date. The note is saved the first time you write in it, so unused days leave no empty notes. Each account has at most one daily note per date (enforced by the server); the date is the browser's local date. Off by default. | This avoids empty notes and duplicates when two devices open Home on the same day. |
| 9 | Turning a feature off | Hides its tab and card. Nothing is deleted: its notes stay in search, exports and backups, and reappear when it is turned back on. | Settings should never destroy data. |
| 10 | Settings layout | Account and Password first, then "Writing" (titles and dates), "Features" (todo lists, quick notes, daily notes) and "Backup & restore" (export and import). A collapsible "Advanced" section holds Encryption, Recovery key, Sessions and Delete account; it opens by itself while a conversion is running. Administration stays last, for administrators only. | Everyday settings come first; rarely used and risky ones sit together behind one click. |
| 11 | Import | In the browser, for every account (so end-to-end accounts work too). Accepts Maple Notes export archives (`.zip`, any format and layout) with their attachments, and single `.md`, `.txt` and `.json` files. A ZIP without a manifest is read as a folder of such files. | One code path for all modes. The export's `manifest.json` lists every note's ID, so a restore can recognise notes the account already has, whatever the format. |
| 12 | What a restore keeps | Text, dates, pinned and archived state, kind, daily date and attachments; tags come from the text as usual. Notes the account already has (same ID) are skipped, so importing the same archive twice is safe. A note whose ID belongs to another account gets a new ID. | Full fidelity without ever overwriting or duplicating existing notes. |
| 13 | Exports carry the new data | Every format records the kind and the daily date, and todo lists and quick notes go into `todo/` and `quick-notes/` folders. The manifest moves to version 2. The server's and the browser's exports stay identical, checked by the shared export vectors. | Exports are the backup format, so a restore must be able to rebuild everything. |
| 14 | Version | 1.2.0: new features, no breaking API changes (new fields and parameters only). | Semantic versioning. |

## Design notes

### API changes (all additive)

- `GET /api/v1/notes` takes `kind` (`note`, `todo`, `quick`; repeatable; default `note`).
- Create requests take `kind` and `dailyDate`; `PATCH` can change the kind. Responses include `kind` and `dailyDate`.
- `GET /api/v1/notes/daily/{date}` returns the account's daily note for a date. Creating a second one for the same
  date answers 409 with the existing note's ID.
- `GET` and `PUT /api/v1/account/preferences` read and change preferences, which are also part of the signed-in
  user.
- `POST /api/v1/notes/import/existing` takes up to 500 IDs and returns those this account already has.
- `POST /api/v1/notes/import` creates one note with its original ID, timestamps, flags, kind and daily date:
  - plain text for server-side modes, ciphertext for end-to-end accounts;
  - end-to-end IDs may be old, but must be UUID version 7.

### What changes for end-to-end accounts

- The server additionally learns each note's kind and daily date, and the account's preferences.
- It still sees no text: titles and todo items are part of the encrypted note, and import encrypts in the browser
  before anything is sent.
- The threat model and the spec gain these items.

## Phases

Status is updated as each phase finishes. ✅ done · 🚧 in progress · ⏳ not started

| # | Phase | Done when | Status |
|---|---|---|---|
| F1 | Preferences and the Settings layout | Preferences are stored per account, returned with the user and changed through the API (validated, tested). Settings shows the new layout: the collapsible Advanced section with Encryption, Recovery key, Sessions and Delete account, and "Backup & restore" | ✅ Done |
| F2 | Note titles and dates in titles | With titles on, the editor has a title field for new and existing notes and cards show the title. Optional date prefill in the chosen format with a preview. Nothing changes with titles off; works for end-to-end accounts | ⏳ Not started |
| F3 | Kinds of notes and the Todo tab | Notes have a kind (migration, API filter, patch). The Todo tab creates and edits checklists that are encrypted like any note. Search, tags and the archive span enabled kinds with labels. The setting (on by default) shows or hides the tab | ⏳ Not started |
| F4 | Quick notes | The Quick notes tab with its own composer and list; moving a quick note to Home and back; the setting (on by default) | ⏳ Not started |
| F5 | Daily notes | Home's "Today" card creates the day's note on first write; one daily note per date is enforced; the setting (off by default) | ⏳ Not started |
| F6 | Exports with kinds and daily notes | Server and browser exports record kind and daily date, and place todo lists and quick notes in their folders (manifest version 2). The shared export vectors cover the new data | ⏳ Not started |
| F7 | Import and full restore | Export archives in every format and layout, and single `.md`/`.txt`/`.json` files, restore into any account, including end-to-end ones, with progress and a summary. Re-importing skips existing notes. Round-trip tests: export → import into a fresh account → identical export | ⏳ Not started |
| F8 | Documentation, hardening and release | README (features, screenshots), architecture, spec and threat model, CHANGELOG (1.2.0), versions and notices updated; clean-clone browser run passes | ⏳ Not started |

### Notes from the phases

- **F1:** preferences are stored as one JSON column, so fields added later take their defaults in older rows (a 1.0
  database upgraded in the tests gets the defaults too). The web app applies a change at once and sends changes one
  after another, each with every change made so far, so quick successive toggles cannot overwrite each other; a
  failed save rolls back. The Advanced section opens by itself while an encryption conversion is running, so its
  progress stays visible.

## Out of scope for 1.2.0

- Restoring a server database backup (`.db`) from the web app; this stays an operator task (see the README).
- Importing from other apps' formats beyond plain Markdown, text and JSON files.
- Recurring todo items, due dates and reminders.
- Templates for daily notes.
- Reordering todo items by dragging.
