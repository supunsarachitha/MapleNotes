# Roadmap: missing features and options

Features and settings Maple Notes does not have yet, from a comparison with similar note apps (Google Keep, Memos,
Standard Notes, Joplin, Obsidian) and a check of the code as of version 1.10.1, kept up to date since (last reviewed for
1.17.1). Numbers are for reference only; they are not an order of work. The suggested starting point is 1 (offline
use), then 6 and 2.

## Biggest gaps

Features most note apps have.

1. **Offline use.** Since 1.12 the app opens offline and shows the notes read recently on a device that stays signed in,
   and new notes and edits made offline are saved once the server can be reached again. Searches, files, and other
   changes (pinning, archiving, labels, the trash) still need a connection.
2. **Reminders and due dates.** Notes, todos and habits have no reminder, due date or notification.
3. **Note history.** Earlier versions of a note cannot be seen or restored.
4. **Sharing.** Nothing can be shared with another account or through a public link. End-to-end notes would need shared
   keys.
5. **Passkeys.** Sign-in with passkeys (WebAuthn) is not supported. Authenticator-app two-factor sign-in exists since
   1.15.
6. **Selecting several notes at once.** Notes cannot be selected together to archive, delete, label or move them.

## Writing and organizing

7. Note templates, such as a meeting template. Since 1.15 a note can be the daily-note template; other notes cannot
   start from a template yet.
8. Links between notes (`[[note]]`), with backlinks.
9. Sort options: the timeline is newest first only; there is no oldest-first or last-edited order.
10. Search filters: by date range, label, tag, kind, or "has attachment / has image / has link".
11. Text size and layout: no setting for the note text size, and no compact view, card or grid view, or wider reading
    width.
12. Colours for notes themselves, as in Keep, rather than only labels.
13. A drawing or handwriting note.
14. Voice recording in the app. Audio files can be attached, but not recorded.
15. Turning a quick note into a todo list or habit, and back.
16. A list of keyboard shortcuts, beyond the formatting shortcuts.

## Todos and habits

17. Recurring todos.
18. Sub-tasks in todo lists.
19. Drag-to-reorder todo items.
20. Habit targets, such as "3 times a week".
21. Habit reminders.
22. Archiving a habit.

## Backup and data

23. Automatic scheduled backups, for example a nightly export to a folder or to S3.
24. Import from other apps: Google Keep (Takeout), Evernote (`.enex`), Standard Notes, Joplin and Simplenote. Today a
    restore reads Maple Notes exports and single Markdown, text and JSON files.
25. Export of one note, or a selection, including to PDF or printing.

## Settings that are fixed today

26. **Trash retention:** fixed at 30 days.
27. **Signed-in devices:** there is no list of devices to sign out one by one, and "Sign out" does not end the session on
    the server.
28. **Photo sizes:** three presets; a custom size or quality cannot be set.
29. **Default view on opening:** the app always starts on Home.
30. **Language:** the interface is in English only.
31. **Time zone:** the app always uses the browser's time zone.

## Administration

32. Sign-in with an existing account system, such as Google or Authelia (OIDC/SSO).
33. Email: invitations, password-reset links and notices. There is no email support.
34. API tokens for scripts and integrations: the API works only with the browser's sign-in cookie.
35. A default storage limit for new accounts, and different limits per account.
36. An audit log of administrator actions and sign-ins.

## Security items still open

From the [October 2026 security audit](security-audit-2026-10.md), where each has a recommended fix.

37. End-to-end tag names and file details do not count toward the storage limit.
38. In "Off" mode, attachments are not encrypted on disk, although the documentation says they are.
39. The sign-in lockout reveals whether a username exists.
40. The Nginx Proxy Manager deployment file trusts forwarded addresses from too wide a network.
