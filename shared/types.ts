export type CardValue = "honest" | "crooked" | "agent" | "kingpin";
export type Team = "honest" | "crooked" | "solo";
export type GamePhase =
  | "action"
  | "aim"
  | "equipment"
  | "reaction"
  | "reveal"
  | "investigation"
  | "redirect";
export type EquipmentKind =
  | "coffee"
  | "evidenceBag"
  | "blackmail"
  | "wiretap"
  | "polygraph"
  | "defibrillator"
  | "k9Unit"
  | "smokeGrenade"
  | "reportAudit"
  | "flashbang"
  | "taser"
  | "truthSerum"
  | "metalDetector"
  | "surveillanceCamera"
  | "restrainingOrder"
  | "plantedEvidence";
export type EquipmentTarget =
  | "none"
  | "player"
  | "card"
  | "twoPlayers"
  | "twoCards";
export interface EquipmentCard {
  id: string;
  kind: EquipmentKind;
  title: string;
  description: string;
  target: EquipmentTarget;
  timing: "any" | "reaction" | "otherTurn" | "ownTurn" | "afterInvestigation";
}
export interface PlayerIdentity {
  id: string;
  name: string;
  avatar: string;
}
export interface IdentityCard {
  id: string;
  value: CardValue;
  revealed: boolean;
  wounded: boolean;
}
export interface GamePlayer extends PlayerIdentity {
  alive: boolean;
  armed: boolean;
  aimingAt: string | null;
  cards: IdentityCard[];
  equipment: EquipmentCard[];
  plantedEvidence: boolean;
}
export interface GameLog {
  id: string;
  text: string;
  at: number;
}
export interface Winner {
  team: Team;
  playerId?: string;
  reason: string;
}
export interface PendingShot {
  shooterId: string;
  targetId: string;
  deadline: number;
}
export interface GameState {
  version: 1;
  players: GamePlayer[];
  status: "playing" | "finished";
  currentPlayerId: string;
  phase: GamePhase;
  turn: number;
  winner: Winner | null;
  gunSupply: number;
  direction: 1 | -1;
  reactionMs: number;
  logs: GameLog[];
  equipmentDeck: EquipmentCard[];
  equipmentDiscard: EquipmentCard[];
  known: Record<string, Record<string, boolean>>;
  equipmentChoices?: {
    playerId: string;
    cards: EquipmentCard[];
    after: "action" | "shot" | "restore";
    restorePhase?: GamePhase;
  };
  pendingShot?: PendingShot;
  extraTurnPlayerId?: string;
  pendingReveals?: { playerIds: string[]; restorePhase: GamePhase };
  pendingInvestigations?: {
    playerId: string;
    targetIds: string[];
    restorePhase: GamePhase;
  };
  lastInvestigation?: { targetId: string; cardIndex: number; turn: number };
  cannotShootTurn?: number;
  logSequence: number;
}
export interface CardView {
  value: CardValue | null;
  revealed: boolean;
  known: boolean;
  /** Hidden cards never disclose the location of a wounded leader. */
  wounded: boolean;
}
export interface PlayerView extends PlayerIdentity {
  alive: boolean;
  wounded: boolean;
  armed: boolean;
  aimingAt: string | null;
  cards: CardView[];
  equipmentCount: number;
  plantedEvidence: boolean;
}
export interface GameView {
  status: "playing" | "finished";
  players: PlayerView[];
  currentPlayerId: string;
  phase: GamePhase;
  turn: number;
  winner: Winner | null;
  logs: GameLog[];
  gunSupply: number;
  direction: 1 | -1;
  pendingRevealPlayerId?: string;
  pendingShot?: PendingShot;
  me: {
    id: string;
    team: Team;
    equipment: EquipmentCard[];
    equipmentChoices?: EquipmentCard[];
    canAct: boolean;
    investigationTargets?: string[];
  };
}
export type GameAction =
  | { type: "investigate"; targetId: string; cardIndex: number }
  | { type: "arm"; revealIndex?: number }
  | { type: "equip"; revealIndex?: number }
  | { type: "shoot" }
  | { type: "aim"; targetId: string }
  | { type: "endTurn" }
  | { type: "chooseEquipment"; cardId: string }
  | { type: "chooseReveal"; cardIndex: number }
  | { type: "chooseInvestigation"; targetId: string; cardIndex: number }
  | {
      type: "useEquipment";
      cardId: string;
      targetId?: string;
      cardIndex?: number;
      otherTargetId?: string;
      otherCardIndex?: number;
    }
  | { type: "resolveShot" }
  | { type: "skip" };

/** Pass a seeded random function in tests; persisted games contain no functions. */
export interface GameOptions {
  random?: () => number;
  now?: number;
  reactionMs?: number;
}
