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
- **Changing a note.** Open a note's **⋯** menu to edit it, pin it to the top, copy its text, archive it or delete it.
  Archived notes wait in the **Archive**, where you can restore them.`,
  },
  {
    id: "titles",
    title: "Titles and dates",
    body: `Turn on **Note titles** in [Settings](/settings) to get a title field above your text. The title is saved as the
note's first line, as a heading, so it also shows up in searches and exports.

With **Start titles with today's date**, new notes begin with the date. Choose how dates look under **Date format**.
The date on its own is not enough to post, so an untouched box never becomes an empty note.`,
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
    id: "pictures",
    title: "Pictures, video and files",
    body: `Choose a picture to open it full screen. Move between a note's pictures with the arrows, the arrow keys or a swipe,
download it with the download button, and close with Esc or ✕. Videos and audio play in the note, and other files
download when you choose them.`,
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
computer, and pick an accent colour. Your choice follows you to every device you sign in on.`,
  },
  {
    id: "features",
    title: "Choosing your features",
    body: `Everything beyond plain notes can be switched on or off under **Features** in [Settings](/settings): todo lists,
quick notes, daily notes, the calendar and link previews. Turning something off only hides it; nothing is deleted,
and it all comes back when you turn it on again.`,
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
single Markdown, text or JSON files as notes.`,
  },
  {
    id: "storage",
    title: "How much you store",
    body: `**Account** in [Settings](/settings) shows how much space your notes and files take, with how many of each.
Archived notes and files count too; deleting them frees the space. Only you see your own usage: administrators see
the server's totals, never yours.`,
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
visitors create accounts, disable or remove accounts, and make others administrators. Administrators manage
accounts, but they can never read anyone's notes through the app.`,
  },
];
