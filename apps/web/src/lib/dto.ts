import type { MessageMetadata, MessageType, UserRole } from "@ccr/types";

/** Serializable shapes shared between server code and client components. */

export interface UserSummary {
  id: string;
  name: string;
  role: UserRole;
  specialty: string | null;
  handle: string;
  title?: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
  names: string[];
}

export interface MessageDTO {
  id: string;
  type: MessageType;
  content: string;
  createdAt: string;
  author: UserSummary | null;
  metadata: MessageMetadata | null;
  reactions: ReactionSummary[];
}

export interface DocumentOption {
  id: string;
  title: string;
  type: string;
  date: string;
}
