import type { EquipmentCard, EquipmentKind } from "./types.js";

export const EQUIPMENT: Omit<EquipmentCard, "id">[] = [
  {
    kind: "blackmail",
    title: "勒索",
    target: "twoCards",
    timing: "any",
    description:
      "交换另外两名存活玩家各一张身份牌，明暗及领袖伤势随牌移动。不能选择自己。",
  },
  {
    kind: "coffee",
    title: "咖啡",
    target: "none",
    timing: "otherTurn",
    description: "在他人回合使用。本回合结束后立刻轮到你，之后从你继续轮转。",
  },
  {
    kind: "defibrillator",
    title: "除颤器",
    target: "player",
    timing: "any",
    description: "复活一名已淘汰的其他玩家。身份保持公开，重新加入原阵营。",
  },
  {
    kind: "evidenceBag",
    title: "证物袋",
    target: "twoPlayers",
    timing: "any",
    description:
      "将第一名玩家的一张装备交给第二名玩家；接收者不能是你，超出一张须先择留。",
  },
  {
    kind: "flashbang",
    title: "闪光弹",
    target: "player",
    timing: "any",
    description: "将一名存活玩家的三张身份洗乱并全部盖回；所有旧调查记录失效。",
  },
  {
    kind: "k9Unit",
    title: "警犬",
    target: "player",
    timing: "any",
    description: "令一名持枪玩家放下枪，归还公共枪池。",
  },
  {
    kind: "metalDetector",
    title: "金属探测器",
    target: "none",
    timing: "any",
    description: "依次调查每名持枪的其他玩家的一张未公开身份。",
  },
  {
    kind: "plantedEvidence",
    title: "栽赃",
    target: "player",
    timing: "any",
    description:
      "永久放在一名玩家面前：其普通忠警与黑警身份按相反阵营计算；首领身份不受影响。",
  },
  {
    kind: "polygraph",
    title: "测谎仪",
    target: "player",
    timing: "any",
    description: "你与一名存活的其他玩家互相查看对方全部身份。",
  },
  {
    kind: "reportAudit",
    title: "档案审查",
    target: "none",
    timing: "any",
    description: "每名存活且还有未公开身份的玩家，依次自行选择公开其中一张。",
  },
  {
    kind: "restrainingOrder",
    title: "限制令",
    target: "none",
    timing: "reaction",
    description:
      "有人宣告射击时，迫使射手自行选择另一名存活玩家作为目标，射击照常结算。",
  },
  {
    kind: "smokeGrenade",
    title: "烟雾弹",
    target: "none",
    timing: "any",
    description: "永久反转后续回合的轮转方向。此牌留在桌面，不放回装备牌堆。",
  },
  {
    kind: "surveillanceCamera",
    title: "监控摄像头",
    target: "none",
    timing: "afterInvestigation",
    description:
      "在最近一次调查行动之后、下一次正常行动之前使用，公开刚被调查的那张身份。",
  },
  {
    kind: "taser",
    title: "电击枪",
    target: "player",
    timing: "ownTurn",
    description:
      "自己回合且未持枪时，夺取另一人的枪并瞄准对方；本回合不能射击，仍可做正常行动。",
  },
  {
    kind: "truthSerum",
    title: "吐真剂",
    target: "player",
    timing: "any",
    description: "指定一名存活玩家，由对方自行选择一张未公开身份并公开。",
  },
  {
    kind: "wiretap",
    title: "窃听器",
    target: "twoCards",
    timing: "any",
    description: "调查两名不同的其他存活玩家，各一张未公开身份。",
  },
];

export const EQUIPMENT_BY_KIND = Object.fromEntries(
  EQUIPMENT.map((card) => [card.kind, card]),
) as Record<EquipmentKind, Omit<EquipmentCard, "id">>;

export function createEquipmentDeck(): EquipmentCard[] {
  return EQUIPMENT.map((card, index) => ({
    ...card,
    id: `equipment-${index + 1}`,
  }));
}

export const CARD_LABELS = {
  honest: "忠警",
  crooked: "黑警",
  agent: "探长",
  kingpin: "主谋",
} as const;
