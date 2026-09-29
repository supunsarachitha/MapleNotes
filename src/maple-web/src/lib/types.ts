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

/** RFC 9457 problem details returned by the API for errors. */
export interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
