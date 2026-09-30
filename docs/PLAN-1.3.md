# Maple Notes 1.3: habit tracker — development plan

Requested 2026-09-29: a habit tracker module, "something like beaverhabits but very lightweight and minimalistic", with a
setting in the Features section; "just track multiple habits, then track progress in a chart". Work happens on the
branch `habit-tracker`, from `main`. Earlier plans: [PLAN.md](PLAN.md) (1.0), [PLAN-E2EE.md](PLAN-E2EE.md) (1.1) and
[PLAN-1.2.md](PLAN-1.2.md) (1.2).

As before, the feature must work in all three encryption modes, including end-to-end, where the server never sees
note text.

## Built from scratch

Beaverhabits (BSD-3-Clause) inspired only the idea: a list of habits with recent days to tick off. Nothing is copied
from it or from any other project: no code, text, styles, icons or images. No dependency is added either. The chart is
our own SVG, and the menu icon comes from lucide-react, which the app already uses (ISC licence).
`scripts/check-licenses.py` must still pass.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Where habits live | A habit is a note of a new kind, `Habit`. Its text is Markdown: the name as the title, then one line per day done (see "How a habit is stored"). | Habits then get everything notes already have: encryption in every mode, conversion between modes, export and restore, storage usage, backups and account deletion. No new table, endpoint or migration is needed, because the kind is stored as text. |
| 2 | Where habits appear | Only on the new Habits page. Never on Home, in search, on the Tags page, in the calendar or on the Archive page. When no kind is given, the server's tag and calendar counts leave habits out. | Habits are not notes to read, and would clutter everything else. |
| 3 | Habits stay habits | The server refuses to turn a note into a habit, or a habit into another kind. Habits cannot be daily notes; that is already the rule, because daily notes must be timeline notes. | A habit's text has a fixed shape. Moving a habit to Home would show its `- 2026-09-27` lines as a note. |
| 4 | Ticking days | Each habit shows the last 7 days as round buttons, with today last and outlined. Tap a day to mark it done or not done. Arrows move the days shown a week back, and forward again (never past today), so a missed day can be fixed. Days are the device's local dates, as for daily notes. | One tap per habit per day is the whole job. |
| 5 | Saving | A tick shows at once and saves in the background. A habit's saves go one after another, and a refresh never overwrites a newer tick. Todo lists already have this safeguard; it moves into a hook that both use. If two devices tick the same habit at the same moment, the last save wins, as for todo lists. | Instant feedback, with no new server logic. |
| 6 | Progress chart | One chart under the list, with bars for the share of days done per week (last 12 weeks) or per month (last 12 months). A menu shows all habits together or one habit. For one habit, the chart also shows the current streak, the best streak and the total days done. | A weekly or monthly rate means something for one habit and for several. Daily bars could only be 0 or 1. |
| 7 | Managing habits | Add a habit by name, like a new todo list. Rename, archive and delete habits; delete asks for confirmation. Archived habits leave the list and the chart but keep their history, in an "Archived habits" section where they can be restored or deleted. Habits are listed in the order they were created. | The minimum needed; see "Out of scope". |
| 8 | The switch | Settings → Features gets a "Habit tracker" switch: "Tick off daily habits and see your progress in a chart." **Off by default.** Turning it off hides the Habits tab. Nothing is deleted, and habits stay in exports and backups. | It works like the other feature switches. It is off by default, like daily notes, so the app looks unchanged until someone wants habits. |
| 9 | Exports and restore | Every export format puts habits in a `habits/` folder and records their kind, as for todo lists. Manifest version 2 already has the kind field. A restore brings habits back with every day. The server's and the browser's exports stay identical; the shared export vectors gain a habit. | Exports are the backup format. |
| 10 | End-to-end accounts | The browser encrypts a habit's name and days like any note. The server learns what it learns for todo lists: the kind, the number of habits, and when each was created and last changed. It can therefore tell roughly when a habit was ticked, but not which habit or which days. The threat model and the spec say so. | This is the same model as the other kinds, stated openly. |
| 11 | Version | 1.3.0. The feature is new, and the API only gains a kind value and a preference. | Semantic versioning. |

## Design notes

### How a habit is stored

```markdown
# Read 20 minutes

- 2026-09-27
- 2026-09-28
- 2026-09-29
```

- The title is the habit's name, up to 300 characters, as for list names.
- Each `- yyyy-MM-dd` line is a day done. The app keeps these lines sorted, with no duplicates.
- Ticking keeps any other text, such as a description written into an exported file before restoring it.
- Each day takes about 13 characters, so a habit can hold about 20 years of daily ticks within the 100,000-character
  note limit.
- Habits count as notes in storage usage.

### API changes (all additive)

- `kind` accepts `habit` wherever kinds are accepted today: listing, creating and importing.
- `PATCH /api/v1/notes/{id}` answers 400 when asked to change a note to `habit` or from it.
- Without a `kind`, `GET /api/v1/tags` and `GET /api/v1/notes/calendar` count every kind except habits.
- Preferences gain `habitTracker` (default `false`). Older accounts read it as off. Preferences are stored as JSON, so
  there is no migration.
- There are no new endpoints: the Habits page uses the notes API.

### The Habits page

```
Habits
┌──────────────────────────────────┐ ┌───────┐
│ New habit, e.g. Read 20 minutes  │ │ + Add │
└──────────────────────────────────┘ └───────┘

                        ‹  Sep 23 – 29  ›
                    We  Th  Fr  Sa  Su  Mo  Tu
Read 20 minutes      ●   ●   ○   ●   ●   ●   ◎    ⋯
Walk 8,000 steps     ○   ●   ●   ○   ●   ○   ○    ⋯
Drink water          ●   ●   ●   ●   ●   ●   ●    ⋯

Progress                   [All habits ▾]  [Weeks | Months]
100% ┤             ▆     █
 50% ┤  ▃  ▄  ▅  ▆ █  ▅  █  ▆  ▅  ▇  ▆  ▄
     └───────────────────────────────────────
This week 71% · 12-week average 64%

▸ Archived habits (1)
```

- `●` means done, `○` not done, and `◎` marks today.
- On phones, the name sits above its row of days, and every button is at least 40 px.
- The row menu (`⋯`) has Rename, Archive and Delete.
- Each day button tells screen readers what it is (for example "Read 20 minutes, Tuesday 29 September: done") and
  works with the keyboard.
- The page follows the date when it changes at midnight while the app is open.

### The chart

- The share of days done in a period is the number of days done, divided by the days the habits existed in that
  period.
- A habit counts from the day it was created, or from its first tick if that is earlier.
- The current week or month counts only the days so far.
- A period before any habit existed shows no bar.
- A streak is a run of consecutive days done, ending today, or ending yesterday while today is not ticked yet.
- Weeks start on the locale's first day, as in the side-menu calendar.
- The chart is SVG in the accent colour, and works in the light and dark themes.
- Screen readers get a text summary and a hidden table of the values.

### Security

- The server gets no new endpoint, table or parser. Habits go through the notes API, with its per-account checks,
  CSRF protection and encryption.
- The server never reads a habit's text; the new rules are about kinds only.
- Decision 10 lists what an end-to-end account reveals.

### Compatibility

- An export made by 1.3, restored into 1.2, brings habits back as ordinary notes. Nothing is lost.
- Clients that ask for specific kinds see no change.

## Phases

Status is updated as each phase finishes. ✅ done · 🚧 in progress · ⏳ not started

Every phase ends with all tests passing, a commit, and the preview container (`maple-notes-preview`, port 8092,
volume `maple-preview-data`) rebuilt from the branch.

| # | Phase | Done when | Status |
|---|---|---|---|
| H1 | Server: the habit kind | Listing, creating and importing accept `habit`, and kind changes to or from it are refused. Tag and calendar counts leave habits out by default. Exports put habits in `habits/`. The `habitTracker` preference exists and is off by default. Server tests cover each of these | ⏳ |
| H2 | Web foundations | The Features switch. The Habits tab and route, hidden when the switch is off, with a "turned off" page like the Todo tab's. Tested functions for the habit text format (read, write, tick) and the statistics (streaks, weekly and monthly rates, week start, dates that stay right across daylight-saving changes). The browser export and restore handle habits, checked by the shared export vectors | ⏳ |
| H3 | The Habits page | Adding, ticking (last 7 days, with week arrows), renaming, archiving, restoring and deleting habits all work. Ticks save through the save queue, now shared with todo lists. The page works on a 360 px phone and for end-to-end accounts. Component tests cover it | ⏳ |
| H4 | Progress chart | Weekly and monthly bars for all habits or one; streaks and totals; the screen-reader summary; light and dark themes; tests | ⏳ |
| H5 | Documentation and release | A Help page section. The README (feature list and a screenshot), CHANGELOG (1.3.0), threat model and spec are updated, and the version is 1.3.0. Browser checks pass for an ordinary and an end-to-end account: ticks survive reloads, an export restores with every habit and day, and the phone layout works. A clean-clone run of every test passes | ⏳ |

## Effort

The estimates are measured against the 1.2 phases, using their commits in `git log`:

| Phase | Closest 1.2 phase (code + test lines) | Estimate (code + test lines) | Size |
|---|---|---|---|
| H1 | F16 storage usage (192 + 98) | ~60 + ~180 | Small |
| H2 | F12 Tags page (181 + 113) | ~230 + ~260 | Small |
| H3 | The Todo tab part of F3 | ~400 + ~200 | Medium |
| H4 | F9 calendar (300 + 168) | ~150 + ~100 | Small |
| H5 | F8 documentation and release | Documentation and browser checks | Small |
| **Total** | F3 (kinds and the Todo tab, 1,045 + 322) took about 3 h 20 min | **~850 + ~750** | **About 3–4 hours** |

What keeps it light:

- no database migration;
- no new API endpoint;
- no new dependency;
- no change to the encryption code.

The main risks, and how they are handled:

- **Two devices ticking the same habit at the same moment.** The last save wins, as for todo lists.
- **Date arithmetic around daylight-saving changes and week starts.** Unit tests cover it in several time zones.

## Out of scope for 1.3.0

- Goals, targets and schedules (such as "3 times a week"), reminders and notifications.
- Counts or values per day (such as "8 glasses"): a day is either done or not.
- Colours, icons or manual ordering per habit.
- A page per habit with a year heatmap or a calendar.
- Importing from other habit trackers.

## Notes from the phases

Filled in as the phases finish.
