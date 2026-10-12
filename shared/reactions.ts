type ReactionGroup = "seat" | "card" | "role" | "action" | "interaction";
type ReactionTone =
  | "neutral"
  | "blue"
  | "red"
  | "blue-deep"
  | "red-deep"
  | "amber";

export const MAX_REACTION_PARTS = 3;

export const REACTIONS = [
  { id: "seat-1", label: "1号", group: "seat", tone: "neutral" },
  { id: "seat-2", label: "2号", group: "seat", tone: "neutral" },
  { id: "seat-3", label: "3号", group: "seat", tone: "neutral" },
  { id: "seat-4", label: "4号", group: "seat", tone: "neutral" },
  { id: "seat-5", label: "5号", group: "seat", tone: "neutral" },
  { id: "seat-6", label: "6号", group: "seat", tone: "neutral" },
  { id: "seat-7", label: "7号", group: "seat", tone: "neutral" },
  { id: "seat-8", label: "8号", group: "seat", tone: "neutral" },
  { id: "card-left", label: "左", group: "card", tone: "neutral" },
  { id: "card-middle", label: "中", group: "card", tone: "neutral" },
  { id: "card-right", label: "右", group: "card", tone: "neutral" },
  { id: "good", label: "好人", group: "role", tone: "blue" },
  { id: "bad", label: "坏人", group: "role", tone: "red" },
  { id: "sheriff", label: "警长", group: "role", tone: "blue-deep" },
  { id: "boss", label: "头目", group: "role", tone: "red-deep" },
  { id: "investigate", label: "调查", group: "action", tone: "neutral" },
  { id: "cover", label: "掩护", group: "action", tone: "neutral" },
  { id: "shoot", label: "开火", group: "action", tone: "red" },
  { id: "wait", label: "等一下", group: "action", tone: "neutral" },
  { id: "agree", label: "赞同", group: "action", tone: "neutral" },
  { id: "deny", label: "反对", group: "action", tone: "neutral" },
  { id: "laugh", label: "大笑", group: "interaction", tone: "neutral" },
  { id: "hush", label: "嘘声", group: "interaction", tone: "neutral" },
  { id: "doubt", label: "怀疑", group: "interaction", tone: "neutral" },
  { id: "lock", label: "锁定", group: "interaction", tone: "amber" },
] as const satisfies readonly {
  id: string;
  label: string;
  group: ReactionGroup;
  tone: ReactionTone;
}[];

export type ReactionId = (typeof REACTIONS)[number]["id"];
export type ReactionDefinition = {
  readonly id: ReactionId;
  readonly label: string;
  readonly group: ReactionGroup;
  readonly tone: ReactionTone;
};

const reactionsById = new Map<string, ReactionDefinition>(
  REACTIONS.map((reaction) => [reaction.id, reaction]),
);

// Display compatibility for old room snapshots only. New sends must use IDs.
const legacyIds = new Map<string, ReactionId>([
  ["👍", "agree"],
  ["👎", "deny"],
  ["🤔", "doubt"],
  ["😂", "laugh"],
  ["🤫", "hush"],
  ["🎯", "lock"],
]);

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === "string" && reactionsById.has(value);
}

export function getReaction(value: string): ReactionDefinition | undefined {
  return reactionsById.get(legacyIds.get(value) ?? value);
}

export function isReactionSelection(value: unknown): value is ReactionId[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_REACTION_PARTS &&
    [...value].every(isReactionId) &&
    new Set(value).size === value.length
  );
}

export function getEventReactions(event: {
  emoji: string;
  reactions?: readonly string[];
}): ReactionDefinition[] {
  if (event.reactions !== undefined) {
    return isReactionSelection(event.reactions)
      ? event.reactions.map((id) => reactionsById.get(id)!)
      : [];
  }
  const reaction = getReaction(event.emoji);
  return reaction ? [reaction] : [];
}
