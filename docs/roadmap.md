# Roadmap: missing features and options

Features and settings Maple Notes does not have yet, from a comparison with similar note apps (Google Keep, Memos,
Standard Notes, Joplin, Obsidian) and a check of the code as of version 1.10.1. Numbers are for reference only; they are
not an order of work. The suggested starting point is 1 and 2, then 7 and 3.

## Biggest gaps

Features most note apps have.

1. **Install as an app (PWA).** There is no web app manifest, so phones cannot add Maple Notes to the home screen as a
   full app.
2. **Offline use.** Since 1.12 the app opens offline and shows the notes read recently on a device that stays signed in,
   and new notes and edits made offline are saved once the server can be reached again. Searches, files, and other
   changes (pinning, archiving, labels, the trash) still need a connection.
3. **Reminders and due dates.** Notes, todos and habits have no reminder, due date or notification.
4. **Note history.** Earlier versions of a note cannot be seen or restored.
5. **Sharing.** Nothing can be shared with another account or through a public link. End-to-end notes would need shared
   keys.
6. **Two-factor sign-in.** Since 1.15, accounts can turn on authenticator-app codes with recovery codes. Passkeys are
   not supported.
7. **Selecting several notes at once.** Notes cannot be selected together to archive, delete, label or move them.

## Writing and organizing

8. Note templates, such as a meeting template. Since 1.15 a note can be the daily-note template; other notes cannot
   start from a template yet.
9. Links between notes (`[[note]]`), with backlinks.
10. Sort options: the timeline is newest first only; there is no oldest-first or last-edited order.
11. Search filters: by date range, label, tag, kind, or "has attachment / has image / has link".
12. Text size and layout: no setting for the note text size, and no compact view, card or grid view, or wider reading
    width.
13. Colours for notes themselves, as in Keep, rather than only labels.
14. A drawing or handwriting note.
15. Voice recording in the app. Audio files can be attached, but not recorded.
16. Turning a quick note into a todo list or habit, and back.
17. A list of keyboard shortcuts, beyond the formatting shortcuts.

## Todos and habits

18. Recurring todos.
19. Sub-tasks in todo lists.
20. Drag-to-reorder todo items.
21. Habit targets, such as "3 times a week".
22. Habit reminders.
23. Archiving a habit.

## Backup and data

24. Automatic scheduled backups, for example a nightly export to a folder or to S3.
25. Import from other apps: Google Keep (Takeout), Evernote (`.enex`), Standard Notes, Joplin and Simplenote. Today a
    restore reads Maple Notes exports and single Markdown, text and JSON files.
26. Export of one note, or a selection, including to PDF or printing.

## Settings that are fixed today

27. **Trash retention:** fixed at 30 days.
28. **Session length:** administrators can choose from 30 to 400 days since the session length setting; there is no
    per-account choice.
29. **Signed-in devices:** there is no list of devices to sign out one by one, and "Sign out" does not end the session on
    the server.
30. **Photo sizes:** three presets; a custom size or quality cannot be set.
31. **Default view on opening:** the app always starts on Home.
32. **Language:** the interface is in English only.
33. **Time zone:** the app always uses the browser's time zone.

## Administration

34. Sign-in with an existing account system, such as Google or Authelia (OIDC/SSO).
35. Email: invitations, password-reset links and notices. There is no email support.
36. API tokens for scripts and integrations: the API works only with the browser's sign-in cookie.
37. A default storage limit for new accounts, and different limits per account.
38. An audit log of administrator actions and sign-ins.

## Security items still open

From the [October 2026 security audit](security-audit-2026-10.md), where each has a recommended fix.

39. End-to-end tag names and file details do not count toward the storage limit.
40. In "Off" mode, attachments are not encrypted on disk, although the documentation says they are.
41. The sign-in lockout reveals whether a username exists.
42. The Nginx Proxy Manager deployment file trusts forwarded addresses from too wide a network.
