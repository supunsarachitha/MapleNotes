# Roadmap: missing features and options

Features and settings Maple Notes does not have yet, from a comparison with similar note apps (Google Keep, Memos,
Standard Notes, Joplin, Obsidian) and a check of the code as of version 1.10.1, kept up to date since (last reviewed for
1.18.1). Numbers are for reference only; they are not an order of work. The suggested starting point is 1 (offline
use), then 2.

## Biggest gaps

Features most note apps have.

1. **Offline use.** Since 1.12 the app opens offline and shows the notes read recently on a device that stays signed in,
   and since 1.15 new notes and edits made offline are saved once the server can be reached again. Searches, files, and other
   changes (pinning, archiving, labels, the trash) still need a connection.
2. **Reminders and due dates.** Notes, todos and habits have no reminder, due date or notification.

## Writing and organizing

3. Note templates, such as a meeting template. Since 1.15 a note can be the daily-note template; other notes cannot
   start from a template yet.
4. Links between notes (`[[note]]`), with backlinks.
5. Sort options: the timeline is newest first only; there is no oldest-first or last-edited order.
6. Search filters: by date range, label, tag, kind, or "has attachment / has image / has link".
7. Layout: no compact view, card or grid view, or wider reading width. (The note text size can be chosen in Settings
   → Appearance.)
8. Colours for notes themselves, as in Keep, rather than only labels.
9. A drawing or handwriting note.
10. Voice recording in the app. Audio files can be attached, but not recorded.
11. Turning a quick note into a todo list or habit, and back.

## Todos and habits

12. Recurring todos.
13. Sub-tasks in todo lists.
14. Habit targets, such as "3 times a week".
15. Habit reminders.

## Backup and data

16. Automatic scheduled backups, for example a nightly export to a folder or to S3.
17. Import from other apps: Google Keep (Takeout), Evernote (`.enex`), Standard Notes, Joplin and Simplenote. Today a
    restore reads Maple Notes and Falcon Notes exports and single Markdown, text and JSON files.
18. Export of one note, or a selection, as a file (Markdown or text). (Printing a note, which also saves it as a PDF,
    can be done from a note’s menu.)

## Settings that are fixed today

19. **Trash retention:** fixed at 30 days.
20. **Signed-in devices:** there is no list of devices to sign out one by one, and "Sign out" does not end the session on
    the server.
21. **Photo sizes:** three presets; a custom size or quality cannot be set.
22. **Default view on opening:** the app always starts on Home.
23. **Language:** the interface is in English only.
24. **Time zone:** the app always uses the browser's time zone.

## Administration

25. Sign-in with an existing account system, such as Google or Authelia (OIDC/SSO).
26. Email: invitations, password-reset links and notices. There is no email support.
27. API tokens for scripts and integrations: the API works only with the browser's sign-in cookie.
28. A default storage limit for new accounts, and different limits per account.
29. An audit log of administrator actions and sign-ins.

## Security items still open

From the [October 2026 security audit](security-audit-2026-10.md), where each has a recommended fix.

30. End-to-end tag names and file details do not count toward the storage limit.
31. In "Off" mode, attachments are stored as plaintext on disk (the architecture and threat-model documents now say so).
32. The sign-in lockout reveals whether a username exists.
33. The Nginx Proxy Manager deployment file trusts forwarded addresses from too wide a network.
