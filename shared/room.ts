import type { CardView, GameView } from "./types.js";
import type { ReactionId } from "./reactions.js";

export const AVATARS = [
  "🦊",
  "🐺",
  "🐼",
  "🐯",
  "🐸",
  "🦉",
  "🐱",
  "🐻",
] as const;
export interface MemberView {
  id: string;
  name: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  alive: boolean;
  wounded: boolean;
  armed: boolean;
  aimingAt: string | null;
  cards: CardView[];
  equipmentCount: number;
}
export interface RoomView {
  waitingPlayerId?: string;
  code: string;
  hostId: string;
  capacity: number;
  revision: number;
  status: "waiting" | "playing" | "finished";
  players: MemberView[];
  game: GameView | null;
  /** New events contain ReactionId; strings also support older saved reactions. */
  emojis: Array<{
    id: string;
    playerId: string;
    emoji: string;
    reactions?: ReactionId[];
    at: number;
  }>;
  createdAt: number;
}
export interface Session {
  code: string;
  token: string;
  playerId: string;
}
