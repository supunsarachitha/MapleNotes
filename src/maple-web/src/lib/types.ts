// Types mirroring the server's API contracts (see /openapi/v1.json in development).

export type UserRole = "User" | "Admin";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  encryptionEnabled: boolean;
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

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  url: string;
  createdAtUtc: string;
}

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

/** feed: active unpinned notes; pinned; active: all active notes (search/tags); archived. */
export type NoteState = "feed" | "pinned" | "active" | "archived";

export interface Tag {
  name: string;
  noteCount: number;
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
  enabled: boolean;
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
