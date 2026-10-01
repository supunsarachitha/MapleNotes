// The user guide shown on the Help page. Written for people using Maple Notes, not running it; each section is
// Markdown (tag examples go in `code`, since plain #words become tag links).

export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

export const GUIDE: GuideSection[] = [
  {
    id: "writing",
    title: "Writing notes",
    body: `Write in the box at the top of **Home** and choose **Post** (or press Ctrl+Enter, ⌘+Enter on a Mac). Your newest notes
are at the top.

- **Formatting.** Use the toolbar under the text box for bold, italic, headings, lists, checklists, quotes, code and
  links, or type [Markdown](https://commonmark.org/help/) yourself. Ctrl/⌘+B, I and K are shortcuts for bold, italic
  and links.
- **Pictures and files.** Choose the paperclip, paste, or drag files onto the box. They upload while you write.
- **Checklists.** Tick a checklist's boxes right in the note; the change is saved straight away.
- **Changing a note.** Open a note's **⋯** menu to edit it, pin it to the top, copy its text, archive it or delete it.
  Archived notes wait in the **Archive**, where you can restore them. To edit a note faster, turn on **Double-tap to
  edit** in [Settings](/settings), then double-tap the note (or double-click it).`,
  },
  {
    id: "titles",
    title: "Titles and dates",
    body: `Turn on **Note titles** in [Settings](/settings) to get a title field above your text. The title is saved as the
note's first line, as a heading, so it also shows up in searches and exports.

With **Start titles with today's date**, new notes begin with the date. Choose how dates look under **Date format**.
The date on its own is not enough to post, so an untouched box never becomes an empty note.

Quick notes have no title field unless you also turn on **Titles on quick notes**.`,
  },
  {
    id: "tags",
    title: "Tags",
    body: `Add tags anywhere in a note by typing a word after a hash, like \`#ideas\` or \`#groceries\`. Use a slash for
nested tags, like \`#work/meetings\`.

Choose a tag in a note, or open **Tags** in the menu, to see its notes. Choosing a parent tag such as \`#work\` also shows
notes tagged \`#work/meetings\`. The Tags page lists every tag with how many notes use it, and has a filter for when
there are many.`,
  },
  {
    id: "search",
    title: "Searching",
    body: `Type in **Search notes** at the top of the menu and press Enter. Search looks through the text of your notes and the
names of attached files. Archived notes are not included.`,
  },
  {
    id: "todo",
    title: "Todo lists",
    body: `Open **Todo** in the menu and create a list, such as "Groceries". Add items in the box at the bottom of the list,
tick them off as you go, and choose an item to change its text. The list's **⋯** menu can rename it, clear the
ticked items, pin it, archive it or delete it.

To change many items at once, choose **Edit as Markdown** in the list's **⋯** menu. Each item is a line: \`- [ ]\` for
one to do and \`- [x]\` for one done. Reorder, add or delete lines, or paste a list; lines without a box become items
to do. Choose **Save**, or press Ctrl+Enter (⌘+Enter on a Mac).

Todo lists stay out of your Home timeline, but searches and tags find them.`,
  },
  {
    id: "quick",
    title: "Quick notes",
    body: `**Quick notes** is a scratchpad for things you jot down in passing, kept out of your timeline. When a quick note
turns out to be worth keeping, open its **⋯** menu and choose **Move to Home**. A timeline note can also move to
quick notes.`,
  },
  {
    id: "daily",
    title: "Daily notes",
    body: `Turn on **Daily notes** in [Settings](/settings) to get a **Today** card at the top of Home, titled with today's
date. Write in it and it becomes today's note; days you skip leave no empty notes. If you start the day's note on two
devices at once, the second one adds to it rather than starting another.`,
  },
  {
    id: "calendar",
    title: "The calendar",
    body: `The calendar in the menu marks the days you wrote on. Choose a day to see that day's notes, and use the arrows to go
to other months. You can turn the calendar off in [Settings](/settings).`,
  },
  {
    id: "habits",
    title: "Habits",
    body: `Turn on the **Habit tracker** in [Settings](/settings) to get **Habits** in the menu. Add a habit, such as "Read 20
minutes", then tap a day's circle on each day you do it; tap it again to undo. The last seven days are shown, with
today outlined, and the arrows go back a week at a time, so you can fill in a day you missed.

Under your habits, **Progress** shows how many of the possible days you did each week or month, for all your habits
or just one, with your current and best streak. A habit counts from the day you added it.

**Calendar** shows a whole month: for one habit, the days you did it; for all of them, the days you did all or some.
Use the arrows to look at earlier months. To tick a day, use the list above.

A habit's **⋯** menu renames, archives or deletes it. Archived habits keep their history under **Archived habits**
until you restore them. Habits stay out of your timeline, searches and tags, but your exports and backups include
them.`,
  },
  {
    id: "pictures",
    title: "Pictures, video and files",
    body: `Choose a picture to open it full screen. Move between a note's pictures with the arrows, the arrow keys or a swipe,
download it with the download button, and close with Esc or ✕. Videos and audio play in the note, and other files
download when you choose them.

To save space, turn on **Shrink photos before uploading** in [Settings](/settings): large photos are resized to 2560
pixels on their longest side and saved as JPEG before they upload, often a tenth of the size, and their location and
camera details are left out. The full-size original is not kept, and photos you uploaded earlier stay as they are.`,
  },
  {
    id: "links",
    title: "Link previews",
    body: `With **Link previews** on in [Settings](/settings), notes show the title and description of the pages they link
to. To get them, the server visits each linked page, so it learns which links you save, even if your notes are
end-to-end encrypted. That is why they are off until you turn them on, and why Maple Notes asks you to confirm when you
do. Your server's administrator may also have switched them off for everyone.`,
  },
  {
    id: "appearance",
    title: "Appearance",
    body: `Under **Appearance** in [Settings](/settings), choose **Light**, **Dark**, or **Device** to follow your phone or
computer, and pick an accent colour. You can also make the side menu's text smaller or larger, and choose the day
your weeks start on in the calendars. Your choices follow you to every device you sign in on.`,
  },
  {
    id: "features",
    title: "Choosing your features",
    body: `Everything beyond plain notes can be switched on or off under **Features** in [Settings](/settings): todo lists,
quick notes, daily notes, the calendar, the habit tracker, the archive, the Tags page and link previews. Turning
something off only hides it; nothing is deleted, and it all comes back when you turn it on again.`,
  },
  {
    id: "encryption",
    title: "Keeping your notes private",
    body: `Your server always keeps its database encrypted. Under **Advanced → Encryption** in [Settings](/settings) you choose
how much more protection your own notes get:

- **Encrypted at rest** (the usual choice): your notes and files are also encrypted with a key of your own, which the
  server holds. This protects against stolen disks and leaked backups.
- **End-to-end**: your browser encrypts notes, tags, file names and files with a key only you hold. Nobody else can
  read them, not even whoever runs the server.
- **Off**: only the database encryption.

When you turn on end-to-end encryption you get a **recovery key**. Save it somewhere safe, such as a password
manager or on paper. It is the only way back in if you forget your password; without the password or the recovery
key, nobody can recover your notes. On a new device, you unlock your notes by entering your password.`,
  },
  {
    id: "account",
    title: "Your name",
    body: `**Account** in [Settings](/settings) shows your username and the name the app shows for you. Choose **Change**
to pick another display name; leave it empty to use your username.`,
  },
  {
    id: "password",
    title: "Passwords and signing out",
    body: `Change your password in [Settings](/settings). This signs you out on your other devices.

- **Forgot your password?** With end-to-end encryption, choose **Forgot your password?** on the sign-in page and enter
  your recovery key. Without end-to-end encryption, a forgotten password cannot be reset, so keep it in a password
  manager.
- **Lost a device?** Use **Advanced → Sign out everywhere** to end every session at once.`,
  },
  {
    id: "backup",
    title: "Backing up and restoring",
    body: `Under **Backup & restore** in [Settings](/settings), **Export** downloads your notes as a ZIP file of Markdown, plain
text or JSON, with your files, in folders by year, month or day. It is a good idea to keep a copy somewhere safe.
Exports are not encrypted, so store them with care.

**Restore** brings notes back from such a file, even on another Maple Notes server. Notes keep their dates, pins,
archive state and files, and notes you already have are skipped, so restoring twice does no harm. You can also add
single Markdown, text or JSON files as notes.

To start over, **Advanced → Delete all notes and files** deletes everything you wrote and uploaded at once, after
you confirm your password. Your account, password, settings and encryption stay. This cannot be undone, so export
first if you might want your notes back.`,
  },
  {
    id: "https",
    title: "Opening Maple Notes from other devices",
    body: `Maple Notes encrypts your password and notes in your browser, and browsers only allow that on secure (HTTPS)
pages, or on the server itself as \`localhost\`. If you open it at an address like \`http://192.168.1.20:8088\`, it
explains this instead of signing you in. Ask whoever runs your server for its HTTPS address.`,
  },
  {
    id: "storage",
    title: "How much you store",
    body: `**Account** in [Settings](/settings) shows how much space your notes and files take, with how many of each.
Archived notes and files count too; deleting them frees the space. Only you see your own usage: administrators see
the server's totals, never yours.

Your administrator may limit how much each account stores. Settings then shows how much of it you use, and warns you
when it is almost full. Once it is full, new files, notes and longer edits are not saved until you delete something
(or the administrator allows more); nothing you already have is lost, and you can still delete, archive and export.`,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    body: `| Keys | What they do |
|---|---|
| Ctrl+Enter / ⌘+Enter | Post or save the note you are writing |
| Esc | Cancel an edit, or close a dialog or the picture viewer |
| Ctrl+B / ⌘+B | Bold |
| Ctrl+I / ⌘+I | Italic |
| Ctrl+K / ⌘+K | Link |
| ← → | Previous and next picture in the viewer |`,
  },
  {
    id: "admins",
    title: "For administrators",
    body: `The first account on a server is its administrator. Under **Administration** in [Settings](/settings) you can let
visitors create accounts, limit how much each account can store, disable or remove accounts, and make others
administrators. **Compact database** gives the space that deleted notes leave in the database back to the disk, and
**Name and icon** gives the app your own name and picture, on the sign-in page too. Administrators manage accounts, but they can never read anyone's notes through the app, nor see how
much an account stores.`,
  },
];
