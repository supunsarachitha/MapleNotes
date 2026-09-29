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

/** A note as components use it: plain text, decrypted if it was end-to-end encrypted. */
export interface Note {
  id: string;
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

/** RFC 9457 problem details returned by the API for errors. */
export interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
