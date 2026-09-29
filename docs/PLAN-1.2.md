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
| 15 | Calendar | A month calendar in the side menu (under the navigation, also in the phone drawer). Days with notes get a dot, today is outlined, and choosing a day opens that day's notes, like a tag view. Days follow the device's time zone; the week starts on the locale's first day. | Browsing by date is how people find "what did I write that week". Note dates are already visible to the server, so the calendar reveals nothing new in end-to-end mode. |
| 16 | Appearance | Theme (System, Light, Dark) and an accent colour (Maple, Ocean, Forest, Teal, Plum, Amber, Slate) are preferences, applied by the web app. Each accent replaces the six brand shades the interface uses; the device remembers the last choice so the sign-in screen and the first paint match. | The brand colours were already design tokens, so accents are a token swap; checking contrast per accent keeps the app readable. |
| 17 | Images | A lightbox built on the existing accessible dialog: the image fitted to the screen, arrows and swipes between a note's images, Esc to close, and a download link. Attachment images keep their aspect ratio and fill the width available. | No new dependency, and end-to-end images work because the viewer uses the same decrypted image sources as the note. |

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

At the end of every phase the preview container (`maple-notes-preview`, port 8092, volume `maple-preview-data`) is
rebuilt from the branch, so each phase can be tried as it lands (from F5 on).

| # | Phase | Done when | Status |
|---|---|---|---|
| F1 | Preferences and the Settings layout | Preferences are stored per account, returned with the user and changed through the API (validated, tested). Settings shows the new layout: the collapsible Advanced section with Encryption, Recovery key, Sessions and Delete account, and "Backup & restore" | ✅ Done (`8230325`) |
| F2 | Note titles and dates in titles | With titles on, the editor has a title field for new and existing notes and cards show the title. Optional date prefill in the chosen format with a preview. Nothing changes with titles off; works for end-to-end accounts | ✅ Done (`5cbc6d5`) |
| F3 | Kinds of notes and the Todo tab | Notes have a kind (migration, API filter, patch). The Todo tab creates and edits checklists that are encrypted like any note. Search, tags and the archive span enabled kinds with labels. The setting (on by default) shows or hides the tab | ✅ Done (`327fc66`) |
| F4 | Quick notes | The Quick notes tab with its own composer and list; moving a quick note to Home and back; the setting (on by default) | ✅ Done (`6ad6b3c`) |
| F5 | Daily notes | Home's "Today" card creates the day's note on first write; one daily note per date is enforced; the setting (off by default) | ✅ Done (`6d5c8a4`) |
| F6 | Exports with kinds and daily notes | Server and browser exports record kind and daily date, and place todo lists and quick notes in their folders (manifest version 2). The shared export vectors cover the new data | ✅ Done (`3a6a72a`) |
| F7 | Import and full restore | Export archives in every format and layout, and single `.md`/`.txt`/`.json` files, restore into any account, including end-to-end ones, with progress and a summary. Re-importing skips existing notes. Round-trip tests: export → import into a fresh account → identical export | ✅ Done (`03df64e`) |
| F8 | Documentation, hardening and release | README (features, screenshots), architecture, spec and threat model, CHANGELOG (1.2.0), versions and notices updated; clean-clone browser run passes | ✅ Done (`f66f0cb`) |
| F9 | Calendar in the side menu (requested after F8) | A month calendar in the side menu marks the days that have notes; choosing a day shows that day's notes; works in every encryption mode; a Features switch (on by default); docs, changelog and preview updated | ✅ Done |
| F10 | Appearance: theme colour and dark mode (requested after F8) | Settings → Appearance offers System, Light or Dark and a choice of accent colours, saved per account and applied at once, with no flash of the wrong theme when the app opens; every accent keeps text contrast at least 4.5:1 in both themes | ✅ Done |
| F11 | Image viewer and responsive images (requested after F8) | Choosing an image attachment opens a full-screen viewer (next/previous for a note's images, keyboard, swipe, close); attachment images scale to any screen width without overflowing or distorting; works for end-to-end files | ⏳ Not started |

### Notes from the phases

- **F1:** preferences are stored as one JSON column, so fields added later take their defaults in older rows (a 1.0
  database upgraded in the tests gets the defaults too). The web app applies a change at once and sends changes one
  after another, each with every change made so far, so quick successive toggles cannot overwrite each other; a
  failed save rolls back. The Advanced section opens by itself while an encryption conversion is running, so its
  progress stays visible.
- **F2:** a prefilled date does not count as writing something: the post button stays disabled until there is text,
  a file or a typed title, so opening Home never produces empty dated notes. The browser run found that the Advanced
  button's accessible name included its whole description; it is now named "Advanced", with the description attached
  separately. Verified in Chromium on the production build:
  - the Settings layout, and preferences saved on the server and seen by a second device;
  - a title starting with today's date, stored as a `# heading`;
  - editing a title, and turning titles off without changing any note;
  - a titled note on an end-to-end account, sent encrypted;
  - the existing 18-step suite, with its encryption steps now opening Advanced first.
- **F3:** the timeline and each tab page over one kind through a second index (`UserId, Kind, CreatedAtUtc, Id`).
  Existing notes become timeline notes, and a 1.0 database upgraded in the tests shows it. Tag counts follow the kinds
  the user has turned on, so a tag's count always matches its view. Todo edits show at once and are saved one after
  another, each carrying the whole list. Two findings:
  - A unit test found that the list's menu took focus back when it closed, which ended a rename immediately.
    Renaming now starts once the menu has closed.
  - Adding `kind` to note responses changed the shared export vectors, which store API responses. They were
    regenerated, and the browser export still matches every archive.

  Verified in Chromium on the production build:
  - creating, filling, ticking, editing, renaming, clearing, archiving and restoring a list;
  - lists kept out of Home but found by search and tags;
  - turning the feature off (tab, searches) and on;
  - a list converted to end-to-end encryption and then edited as ciphertext;
  - a 390 px phone layout;
  - the 18-step suite.
- **F4:** quick notes needed no server change beyond F3's kinds. Quick notes and todo lists are edited without the
  title field, so their text stays exactly as written; "Move to quick notes" appears only while the tab is on.
  Verified in Chromium on the production build:
  - posting in the tab, kept out of Home but found by a tag;
  - moving to Home and back;
  - turning the tab off and on;
  - an encrypted quick note on an end-to-end account;
  - the 18-step suite.
- **F5:** a unique index on (`UserId`, `DailyDate`) enforces one daily note per day, including when two devices save
  at the same moment: the second gets 409 and its words are added to the existing note. Opening Home creates
  nothing; the day's note is saved with its first words, and it is kept out of the feed below the Today card.
  Adding `dailyDate` to note responses changed the shared export vectors again; they were regenerated. Verified in
  Chromium on the production build:
  - off by default;
  - the Today card titled in the chosen format;
  - nothing saved by visiting;
  - the first words starting the note;
  - a second device adding to it rather than starting another;
  - the note converted to end-to-end encryption and still today's;
  - the 18-step suite.
- **F6:** the vector dataset gained a todo list, an archived quick note, and a daily note written late in the evening
  UTC (its day is the author's local date, not the UTC one). The web tests reproduce all 13 regenerated archives.
  This phase also closed a gap left by F3: the browser export listed notes with the default kind, so an end-to-end
  account's export would have left out its todo lists and quick notes. It now asks for every kind, and a test holds
  it to that. Verified in Chromium on the production build: one account exported by the server, then, after
  switching to end-to-end encryption, by the browser, gives the same entries with the same content; the existing
  end-to-end export run and the 18-step suite pass.
- **F7:** the browser reads archives with a small ZIP reader of its own. It reads the central directory, then one
  entry at a time from the chosen file, so large exports are never loaded whole; it also handles ZIP64. The
  export's manifest gives every note's ID, even in plain-text exports, so restores skip what the account has in
  every format. Other design points:
  - A note whose ID belongs to another account is never overwritten. The server says only whether the account
    itself has an ID; a plain note gets a new ID, and an end-to-end note is encrypted again for one.
  - The web tests restore every archive in the shared export vectors (13 archives, every format and layout) and
    compare each note's text, dates, state, kind, daily date and file bytes with the original.

  Verified in Chromium on the production build, across three instances:
  - an account with every kind of note and a photo, exported, then restored into a fresh instance;
  - restoring the same export again skips all 6 notes;
  - the restored account exports the same archive, apart from new attachment IDs and the export time;
  - an end-to-end account on a fresh instance restores the same archive, stored as ciphertext, and its browser
    export matches too;
  - an end-to-end account whose IDs were already taken on its instance restores everything under new IDs.
- **F8:** the review added two limits. Restored edit times are never in the future, and the browser's ZIP reader
  refuses entries claiming more than 2 GiB rather than exhausting memory. Everything else in the new surface was
  already validated: text length and ciphertext, attachment ownership, kinds, IDs, dates, the preference date
  formats, and 500 IDs per existing-notes check, which only ever reports the caller's own. Verified on an image built
  from a clean clone of the branch: 355 server and 156 web tests, and 140 browser checks in Chromium across 14 runs.
  The runs cover every 1.1 suite (the 18-step suite, the 1.0 upgrade, keys, notes, media, the built worker, mode
  changes and export) and every 1.2 phase (F2–F7).
- **F9** (requested after F8): the server counts notes per day in the browser's time zone, so days line up with what
  the user sees, including across daylight-saving changes (tested with Paris on the night the clocks change). A
  day's notes are listed by the instants the day starts and ends on the device. Nothing new is revealed in
  end-to-end mode: creation times were already visible, and only the time zone is added. Verified in Chromium on the
  production build:
  - today marked with its count, and choosing it lists that day's notes, todo lists included;
  - an earlier month;
  - the Calendar switch;
  - the phone drawer;
  - an end-to-end account;
  - the 18-step suite.
- **F10** (requested after F8): "Device" is handled entirely in CSS. Dark mode follows `prefers-color-scheme` unless
  `<html>` carries the `.light` or `.dark` class that Light and Dark set, so the default needs no script and the first
  paint is right. An explicit choice is also remembered on the device and applied before React renders. Each accent
  replaces the six brand shades through CSS variables; the browser test measures contrast from the real stylesheet:
  white on the two button shades, and the dark-theme text shade on stone-900. Verified in Chromium on the production
  build:
  - Device on a light and on a dark device, and Light and Dark overriding each;
  - an accent recolouring buttons and the browser's theme colour;
  - the choice kept after a reload and on the sign-in page;
  - the 18-step suite.

## Out of scope for 1.2.0

- Restoring a server database backup (`.db`) from the web app; this stays an operator task (see the README).
- Importing from other apps' formats beyond plain Markdown, text and JSON files.
- Recurring todo items, due dates and reminders.
- Templates for daily notes.
- Reordering todo items by dragging.
