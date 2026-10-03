# Threat model

This document says what Maple Notes' encryption protects against, what it does not, and what it still reveals. It is
written for operators choosing how to run an instance, for users choosing an encryption mode, and for contributors
changing anything security-relevant. The formats are specified in [e2ee-spec.md](e2ee-spec.md); how they fit into the
server is in [architecture.md](architecture.md#cryptography).

## What is protected

| Asset | Where it lives |
|---|---|
| Note text, tags, label names, file names, types and contents | The database and the `attachments/` directory, plus the browser while it shows them. |
| Passwords | Only in the browser. The server receives a key derived from the password, never the password itself (except once for accounts created by 1.0, see [Legacy accounts](#legacy-accounts)). |
| Recovery keys | With the user, shown once. The server stores a hash of a key derived from it. |
| Sessions | An HttpOnly cookie in the browser, checked against the database on every request. |

## The three modes

Every account has a mode, chosen in Settings. The database file is encrypted in all of them.

| Mode | Who can read notes and files |
|---|---|
| Off | The server, and anyone with the database and the master key. |
| Encrypted at rest (default) | The same. Each account's content has its own key, wrapped by a key derived from the master key, so deleting an account makes its content unreadable. |
| End-to-end | Only a browser holding the account's password or recovery key. The server stores ciphertext and wrapped keys it cannot open. |

## Adversaries

### A copy of the disk, volume or backups, without the master key

Stolen disks, a leaked backup, a cloud snapshot, a decommissioned drive.

- **All modes:** protected. The database is encrypted with a key derived from the master key, and so are the
  attachment files (per account, in the at-rest and end-to-end modes) and the Data Protection key ring that signs
  sessions. The master key is never stored in the data volume.
- **What leaks:** the number and approximate sizes of files in `attachments/`, and file times.

### The master key together with the data

The operator, someone who read the `.env` file or the Docker secret along with a backup, or anyone who can read the
running server's memory.

- **Off and at rest:** not protected. The master key opens the database and every per-account key.
- **End-to-end:** the content stays protected. The attacker gets usernames, the metadata listed in
  [What the server sees](#what-the-server-sees-in-end-to-end-mode), and for each end-to-end account the Argon2id salt
  and parameters, a PBKDF2 hash of the sign-in key and the wrapped data key. With those they can **guess passwords
  offline**: every guess costs one Argon2id derivation (64 MiB, 3 passes) and is checked against the wrapped key. A
  long, unique password or passphrase defeats this; a short or reused one may not. Recovery keys are 256 random bits
  and cannot be guessed.

### A server that is compromised but serves the genuine app

Someone who reads the database, the requests and the memory of the running server but does not change the code it
sends to browsers. This includes an operator who is curious but not malicious.

- **Off and at rest:** not protected; the server decrypts content to serve it.
- **End-to-end:** protected. Requests carry ciphertext, tag tokens and the sign-in key. The sign-in key is derived
  separately from the key that wraps the data key, so seeing it does not help to decrypt anything; it is only a
  credential for this server. Search runs in the browser and never sends the search text.
- **What such a server cannot make the browser do:** leave end-to-end mode (the owner's choice is sealed with the data
  key, [e2ee-spec.md §3a](e2ee-spec.md#3a-the-mode-record), and browsers act on that, not on the mode the server
  reports), or send the password itself (only a 1.0 account's first sign-in does, once). A browser that last saw the
  account end-to-end stops and asks if the server says its key is gone; a browser that has never seen the account
  cannot tell.

### A server that is compromised and changes the app

Someone who controls the server and replaces the web app it delivers, for example with a version that sends the
password or the unlocked key elsewhere.

- **All modes:** not protected. The browser loads Maple Notes' code from the same server that stores the data, on
  every visit, and the Content-Security-Policy that restricts that code is also sent by the server. A modified app
  captures the password at the next sign-in or unlock, or the unlocked key of an open session.
- **What end-to-end encryption still gives:** content that was stored before the takeover, of users who do not sign
  in or unlock while it lasts, stays unreadable. So do accounts whose owners notice and stop using the instance.
- This is the main limit of end-to-end encryption in any web app. Maple Notes does not publish build hashes or offer
  a way to verify the code a browser receives. Guard the server itself (see [Recommendations](#recommendations)).

A malicious server can also withhold, delete or roll back data without breaking the encryption. Each note, tag name,
label name, file and wrapped key is authenticated and bound to its account and ID, so the server cannot swap one item
for another or alter an item without the browser noticing. But it can hide items, restore an older version of a note,
attach a file to a different note, put labels on other notes, or change pinned, archived and trash flags, since those
are not encrypted.

### The network

- Maple Notes expects HTTPS from a reverse proxy. Behind it, cookies are `Secure` and HSTS is sent.
- **Without HTTPS,** anyone on the network path can read everything the server can, and inject code like a
  compromised server. End-to-end encryption does not replace TLS.

### Cross-site scripting in the app

Script injected into Maple Notes' own origin runs with the user's session. It can read notes the page has decrypted,
use the unlocked key, and fetch the session secret that opens the key saved for the session, so it gets the same
access as the user.

Defences:
- Markdown is rendered without raw HTML.
- The Content-Security-Policy allows scripts only from the app's origin: no inline script and no `eval`.
- Attachments are served with `nosniff` and a sandboxing policy, and anything that is not passive media is sent as a
  download. Neither the server nor the media service worker ever renders an uploaded file as part of the app.
- A custom app icon must be a PNG, JPEG or WebP image, checked by its content, and is served with the same sandboxing
  policy; the app name is only ever shown as text.
- The unlocked key is a non-extractable `CryptoKey`. This keeps it out of reach of code that only sees memory, but
  not of script running in the page.

### Someone with the device

A lost or stolen phone or laptop, or a shared computer.

- **With a live session** (the browser was left signed in, or "keep me signed in" was used, which lasts 30 days after
  the last use, or up to 400 if administrators chose so), the app opens and, for end-to-end accounts, unlocks by itself. Signing out everywhere from another device, or
  changing the password there, ends every other session at once, and the saved key becomes useless with it.
- **Without a live session,** the browser holds nothing useful, unless the session was started with "keep me signed
  in" and ended without this browser noticing (see offline reading below). The key saved in IndexedDB is sealed with a
  secret that exists only in the session, and API responses are sent with `Cache-Control: no-store`.
- **Offline reading:** on a device whose session was started with "keep me signed in", the service worker keeps the
  notes read recently, as the server sent them, so they open without a connection
  ([architecture.md](architecture.md#offline-reading)). Signing out on the device, or the device seeing that the session
  ended, deletes them; a session ended elsewhere (expiry, "sign out everywhere", a password change) is only seen once
  the device reaches the server again. Until then:
  - For accounts that are off or encrypted at rest, those notes are readable in plain text by whoever opens the
    browser's storage.
  - For end-to-end accounts they stay encrypted, but the device also holds the wrapped key and the Argon2id parameters,
    so whoever has it can guess the password offline, as someone with the server's data can. A strong password is the
    defence.
  - Notes written or edited offline wait on the device under the same rules until they are sent
    ([architecture.md](architecture.md#writing-offline)): in plain text for accounts that are off or encrypted at
    rest, encrypted for the note for end-to-end accounts. Signing out deletes them too, after asking.
  - A session without "keep me signed in", the right choice on a shared computer, keeps nothing.
- **Left behind:**
  - Files viewed before an account switched to end-to-end encryption can remain in the browser's HTTP cache, in
    plain form, until the browser evicts them. After the switch, files arrive encrypted and are decrypted on demand
    with `no-store`.
  - Exports are plain archives wherever they are saved.

### Other users and administrators

Every query filters by the signed-in owner; another user's items answer 404, so their existence is not revealed.
Administrators manage accounts but have no API to read anyone's notes. They see how many notes an account has, but
not how much it stores: storage usage is shown only to the account itself, and administrators get the server's totals
only. They can set a storage limit for every account, but not see who reaches it. An administrator who also runs the
server is one of the adversaries above.

### Password guessing through the app

- Five failed attempts lock an account for 15 minutes, and sign-in, prelogin and recovery are rate-limited per client
  IP.
- **Two-factor sign-in** is optional. With it on, the right password alone gets only the request for a code: a code
  from an authenticator app (TOTP, 30-second steps, one step of tolerance either side) or one of ten single-use
  recovery codes. A wrong code counts toward the same lockout as a wrong password, and only a complete sign-in resets
  the count, so knowing the password gives five guesses at a code per 15 minutes. Each authenticator code is accepted
  once. A reset with the end-to-end recovery key signs in, so it needs the code too. Turning two-factor sign-in on
  ends the account's other sessions.
- The server must hold the authenticator secret to check codes. It keeps it encrypted with a key derived from the
  master key and bound to the account, and keeps recovery codes only as HMACs under that key, so a copy of the
  database without the master key gives neither. Someone with the master key and the database can make codes, as
  they can already read every account's sessions.
- Two-factor sign-in protects sign-in, not content: end-to-end encryption still rests on the password alone, and a
  compromised server gains nothing from the code.
- Unknown usernames receive the same answer as real ones (default parameters and a stable pseudo-salt), so they
  cannot be told apart, with one temporary exception (below).

### Legacy accounts

Accounts created by version 1.0 stored a hash of the password itself. Until such an account signs in once with 1.1
or later, prelogin marks it as needing an upgrade, which reveals that the username exists, and the next sign-in sends
the password to the server one last time.

### Forgotten passwords

- **End-to-end accounts:** the recovery key resets the password, re-wraps the data key and issues a new recovery key.
  Without both the password and the recovery key, the content cannot be recovered by anyone.
- **Other accounts:** Maple Notes sends no email and administrators cannot reset passwords, so there is currently no
  reset.
- **Lost authenticator:** a recovery code signs in instead. Without one, an administrator can turn two-factor sign-in
  off for the account, after which the password alone signs in again. Administrators should check that such a request
  comes from the account's owner.

## What the server sees in end-to-end mode

| Visible to the server | Hidden from it |
|---|---|
| Usernames, sign-in times, IP addresses | Note text |
| Number of notes and files, and when each was created and updated (also encoded in their IDs) | Tag names and label names |
| Approximate length of each note and exact size of each file (ciphertext is not padded) | File names, types and contents |
| Which notes are pinned, archived or in the trash (and when they were deleted), and which files belong to which note | Search queries |
| Which notes are todo lists, quick notes or habits (a habit's update time shows roughly when it was last ticked), and which days have a daily note | Titles, todo items, and habits' names and days (they are part of the note's text) |
| The account's preferences: which features are on, the date format, theme and accent colour | |
| The browser's time zone, when the calendar asks for a month | |
| With link previews turned on (off by default): each link in the notes the browser shows, and the linked pages themselves | |
| Which notes share a tag, and how many notes each tag has (tag tokens are deterministic per account) | The password, the data key, the recovery key |
| How many labels there are, each one's colour, and which notes carry it | |
| Which notes and files the browser loads, and which tag token a filter uses | |

Tag tokens are the same for every note with the same tag, which is what lets the server filter and count by tag. The
server cannot learn a tag's name, but it can see that two notes share one. Tokens differ between accounts. Labels work
the same way with their own records: the server lists and counts a label's notes, and sees its colour, but its name is
encrypted ([e2ee-spec.md](e2ee-spec.md) §4a).

## Limits and trade-offs

- **The code comes from the server.** See [above](#a-server-that-is-compromised-and-changes-the-app). This is the
  largest gap and it is inherent to a browser app served by the same host.
- **Metadata is visible.** Sizes, timestamps, structure, kinds, daily dates, the trash, preferences, tag equality and
  label colours and links are listed above.
- **Restoring an export sends it through this browser.** Exports are decrypted by design, so the archive being
  restored is plain text on the device until it is encrypted and sent.
- **Integrity covers items, not the collection.** Deleted, withheld or rolled-back notes cannot be detected.
- **The recovery key is as powerful as the password.** Anyone who has it can reset the password, sign in and read
  everything. It is shown once; store it offline. It can be replaced in Settings, which makes the old one useless.
- **Keys are not rotated.** Changing the password or the recovery key re-wraps the same data key. Someone who once
  obtained the unlocked data key can read later content too.
- **Changing mode takes time.** When an account switches to end-to-end encryption, existing content stays readable to
  the server until the browser has converted each item, and backups taken before the switch keep the old copies until
  they are rotated out. SQLCipher overwrites deleted database content (`secure_delete`), but replaced attachment
  files are deleted normally and may remain recoverable from the storage medium.
- **Weak passwords can be guessed offline** by whoever holds the database and the master key (see above).
- **Exports are plain text.** They are decrypted by design.
- **Deleting is not wiping everywhere.** Deleted notes, including everything "Delete all notes and files" removes, are
  overwritten in the database (`secure_delete`), and compacting the database shrinks it. But backups taken before
  keep them until they are rotated out, and deleted attachment files may remain recoverable from the storage medium.
- **Link previews reveal links.** To preview a link, the server fetches it, so it learns the address, and so does the
  site being visited (from the server's address). They are off by default and explained where they are turned on;
  operators can disable them with `MAPLE_LINK_PREVIEWS=false`.
- **Link previews make the server fetch addresses chosen by users.** To stop that being used against the server's own
  network (server-side request forgery), the preview client connects only to public addresses. The check runs on the
  address actually connected to, after DNS resolution and after every redirect. The client also allows only http(s)
  on ports 80 and 443, a 5-second limit and 512 KB of HTML, a per-user rate limit, and no cookies or proxy.
- **Out of scope:**
  - malware or malicious browser extensions on the user's device;
  - a server that deletes data or refuses service;
  - traffic analysis beyond what is listed above;
  - side channels on the server's host.

## Recommendations

**Operators**
- Serve Maple Notes only over HTTPS, and set `MAPLE_TRUSTED_PROXIES` to the proxy's address.
- Keep the master key out of the data volume and away from backups (a password manager or a Docker secret).
- Treat shell access to the host and the ability to change the container image as full access to every account's
  sessions. Limit who has them, and build images from a source you trust.
- Keep the instance up to date, and rotate old backups: they keep deleted accounts and pre-switch content.

**Users**
- Use end-to-end encryption if you do not fully trust whoever runs the server or its storage.
- Use a long, unique password (a passphrase from a password manager).
- Store the recovery key offline, and replace it if it may have been seen.
- Avoid "keep me signed in" on shared devices. If a device is lost, sign out everywhere from another one.
- Treat exports as plain copies of your notes.
