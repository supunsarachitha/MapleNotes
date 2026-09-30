// Types mirroring the server's API contracts (see /openapi/v1.json in development).

export type UserRole = "User" | "Admin";

/** How an account protects new notes and files (the database itself is always encrypted). */
export type EncryptionMode = "Off" | "AtRest" | "EndToEnd";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  encryptionMode: EncryptionMode;
  /** The account has an end-to-end key, which this browser must unlock to read the account's encrypted content. */
  hasEndToEndKey: boolean;
  createdAtUtc: string;
  preferences: Preferences;
}

/** The date formats offered in Settings, as .NET-style patterns (formatted by lib/dates.ts). */
export const DATE_FORMATS = [
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd.MM.yyyy",
  "d MMM yyyy",
  "MMM d, yyyy",
  "dddd, d MMMM yyyy",
  "dddd, MMMM d, yyyy",
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

/** Light or dark: follow the device, or always one of them. */
export const THEMES = ["System", "Light", "Dark"] as const;
export type Theme = (typeof THEMES)[number];

/** The accent colours offered in Settings (lib/appearance.ts has their shades). */
export const ACCENTS = ["Maple", "Ocean", "Forest", "Teal", "Plum", "Amber", "Slate"] as const;
export type Accent = (typeof ACCENTS)[number];

/** An account's writing and feature preferences, shared by all of its devices. */
export interface Preferences {
  /** Show a title field when writing; a title is the note's first line, as a Markdown heading. */
  noteTitles: boolean;
  /** With titles on, start a new note's title with today's date. */
  dateInTitles: boolean;
  /** How dates are written in titles and daily notes. */
  dateFormat: DateFormat;
  /** Show the Todo tab. */
  todoLists: boolean;
  /** Show the Quick notes tab. */
  quickNotes: boolean;
  /** Show today's daily note at the top of Home. */
  dailyNotes: boolean;
  /** Show a month calendar in the side menu. */
  calendar: boolean;
  /** Show the Habits tab. */
  habitTracker: boolean;
  /** Shrink photos in the browser before they upload. */
  shrinkPhotos: boolean;
  /** Show previews of links in notes (the server fetches the pages). */
  linkPreviews: boolean;
  theme: Theme;
  accent: Accent;
}

/** A preview of a web page linked from a note. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string;
}

/** Argon2id parameters for deriving an account's keys from its password (docs/e2ee-spec.md §1). */
export interface KdfParamsWire {
  /** 16 bytes, base64. */
  salt: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface Prelogin {
  kdf: KdfParamsWire;
  /** The account predates key-derived sign-in: send the password once alongside the key so the server can upgrade it. */
  upgrade: boolean;
}

/** Proof of the account password: the derived authentication key (and, for an account being upgraded, the password). */
export interface CredentialProof {
  authKey: string;
  password?: string;
}

export interface AuthStatus {
  setupRequired: boolean;
  registrationOpen: boolean;
  user: User | null;
  /** Whether this server allows link previews at all. */
  linkPreviewsAvailable?: boolean;
}

/** An attachment as components use it: an end-to-end file's name, type and size decrypted. */
export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  /** Where the server serves the file; for an end-to-end file that is ciphertext (see useAttachmentSrc). */
  url: string;
  createdAtUtc: string;
  /** Encrypted in the browser: the page decrypts it, through the media service worker when available. */
  endToEnd?: boolean;
}

/** An attachment as the API returns it: end-to-end files carry `encryptedMetadata` instead of a name and type. */
export interface AttachmentWire extends Omit<Attachment, "fileName" | "contentType" | "endToEnd"> {
  fileName: string | null;
  contentType: string | null;
  encryptedMetadata?: string | null;
}

/** Where a note belongs: the Home timeline, the Todo tab, the Quick notes tab or the Habits page. */
export type NoteKind = "Note" | "Todo" | "Quick" | "Habit";

/** A note as components use it: plain text, decrypted if it was end-to-end encrypted. */
export interface Note {
  id: string;
  kind: NoteKind;
  /** For a daily note, its day (`yyyy-MM-dd`). */
  dailyDate?: string | null;
  content: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  tags: string[];
  attachments: Attachment[];
}

export interface NotePage {
  items: Note[];
  nextCursor: string | null;
}

/** A note as the API returns it: end-to-end encrypted notes carry `encryptedContent` instead of `content`. */
export interface NoteWire extends Omit<Note, "content" | "attachments"> {
  content: string | null;
  encryptedContent?: string | null;
  attachments: AttachmentWire[];
}

export interface NotePageWire {
  items: NoteWire[];
  nextCursor: string | null;
}

/** Note text encrypted in the browser, with blind tag tokens and encrypted tag names (docs/e2ee-spec.md §2, §4). */
export interface EncryptedNoteWire {
  content: string;
  tags: Array<{ token: string; name: string }>;
}

/** feed: active unpinned notes; pinned; active: all active notes (search/tags); archived. */
export type NoteState = "feed" | "pinned" | "active" | "archived";

export interface Tag {
  name: string;
  noteCount: number;
}

/** A tag as the API returns it: end-to-end tags have a token and an encrypted name instead of a name. */
export interface TagWire {
  name: string | null;
  noteCount: number;
  token?: string | null;
  encryptedName?: string | null;
}

/** How much the signed-in account stores. */
export interface StorageUsage {
  notesBytes: number;
  noteCount: number;
  filesBytes: number;
  fileCount: number;
  totalBytes: number;
  /** The most the account may store, notes and files together, as set by an administrator; null for no limit. */
  quotaBytes: number | null;
}

/** The database's size before and after compacting it (with its write-ahead log). */
export interface CompactResult {
  bytesBefore: number;
  bytesAfter: number;
}

/** What deleting all of an account's notes and files removed. */
export interface DeletedContent {
  notes: number;
  files: number;
}

/** Instance settings that administrators change. */
export interface InstanceSettings {
  allowRegistration: boolean;
  /** The most each account may store, notes and files together, in megabytes; null for no limit. */
  storageQuotaMb: number | null;
}

/** What the instance stores on its data volume, for administrators (totals only). */
export interface InstanceStorage {
  databaseBytes: number;
  filesBytes: number;
  backupsBytes: number;
  freeBytes: number | null;
  totalBytes: number;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isDisabled: boolean;
  noteCount: number;
  createdAtUtc: string;
}

export interface EncryptionStatus {
  mode: EncryptionMode;
  /** True while existing notes and files are still being converted in the background. */
  inProgress: boolean;
  totalItems: number;
  remainingItems: number;
}

/** The next items the browser converts after a change to or from end-to-end encryption. */
export interface ConversionBatch {
  /** End-to-end: encrypt these items; any other mode: decrypt them. */
  mode: EncryptionMode;
  remaining: number;
  notes: Array<{ id: string; content: string | null; encryptedContent: string | null; updatedAtUtc: string }>;
  attachments: Array<{ id: string; fileName: string | null; contentType: string | null; sizeBytes: number; encryptedMetadata: string | null }>;
}

/** RFC 9457 problem details returned by the API for errors. */
export interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
