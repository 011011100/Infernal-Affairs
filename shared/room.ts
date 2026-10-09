import type { GameView } from "./types.js";

export const EMOJIS = ["👍", "👎", "🤔", "😱", "😂", "😎", "🤫", "🎯"] as const;
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
  cards: Array<{
    value: "honest" | "crooked" | "agent" | "kingpin" | null;
    revealed: boolean;
    known: boolean;
  }>;
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
  emojis: Array<{ id: string; playerId: string; emoji: string; at: number }>;
  createdAt: number;
}
export interface Session {
  code: string;
  token: string;
  playerId: string;
}
