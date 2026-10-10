import { createEquipmentDeck } from "../shared/equipment.js";
import type {
  CardValue,
  EquipmentCard,
  GameAction,
  GameLog,
  GameOptions,
  GamePhase,
  GamePlayer,
  GameState,
  GameView,
  IdentityCard,
  PlayerIdentity,
  Team,
} from "../shared/types.js";

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GameError(message);
}

function shuffle<T>(values: T[], random: () => number = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next]!, result[index]!];
  }
  return result;
}

function player(game: GameState, id: string | undefined): GamePlayer {
  const result = game.players.find((item) => item.id === id);
  requireRule(result, "找不到这名玩家");
  return result;
}

function livingPlayer(game: GameState, id: string | undefined): GamePlayer {
  const result = player(game, id);
  requireRule(result.alive, "这名玩家已经出局");
  return result;
}

function identity(target: GamePlayer, index: number | undefined): IdentityCard {
  requireRule(
    Number.isInteger(index) && index! >= 0 && index! < 3,
    "请选择一张身份牌",
  );
  return target.cards[index!]!;
}

function hiddenIdentity(
  target: GamePlayer,
  index: number | undefined,
): IdentityCard {
  const result = identity(target, index);
  requireRule(!result.revealed, "这张身份已经公开");
  return result;
}

function log(
  game: GameState,
  text: string,
  investigations?: GameLog["investigations"],
): void {
  game.logSequence += 1;
  game.logs.push({
    id: `log-${game.logSequence}`,
    text,
    at: Date.now(),
    ...(investigations ? { investigations } : {}),
  });
  if (game.logs.length > 100) game.logs.splice(0, game.logs.length - 100);
}

export function teamOf(target: GamePlayer): Team {
  const agent = target.cards.some((card) => card.value === "agent");
  const kingpin = target.cards.some((card) => card.value === "kingpin");
  if (agent && kingpin) return "solo";
  if (agent) return "honest";
  if (kingpin) return "crooked";
  const honest =
    target.cards.filter((card) => card.value === "honest").length >= 2;
  return honest !== target.plantedEvidence ? "honest" : "crooked";
}

function checkSoloWinner(game: GameState): void {
  const solo = game.players.find(
    (target) => target.alive && teamOf(target) === "solo",
  );
  if (solo)
    finish(game, {
      team: "solo",
      playerId: solo.id,
      reason: `${solo.name} 同时获得探长和主谋身份，独自获胜`,
    });
}

function finish(
  game: GameState,
  winner: NonNullable<GameState["winner"]>,
): void {
  game.status = "finished";
  game.winner = winner;
  delete game.pendingShot;
  delete game.pendingReveals;
  delete game.pendingInvestigations;
  delete game.equipmentChoices;
  log(game, winner.reason);
}

function returnGun(game: GameState, target: GamePlayer): void {
  if (target.armed) game.gunSupply += 1;
  target.armed = false;
  target.aimingAt = null;
}

function invalidateKnowledge(game: GameState, cards: IdentityCard[]): void {
  for (const known of Object.values(game.known)) {
    for (const card of cards) delete known[card.id];
  }
}

function investigate(
  game: GameState,
  actorId: string,
  target: GamePlayer,
  cardIndex: number,
): void {
  const card = hiddenIdentity(target, cardIndex);
  game.known[actorId]![card.id] = true;
}

function revealCost(target: GamePlayer, index: number | undefined): void {
  if (target.cards.some((card) => !card.revealed))
    hiddenIdentity(target, index).revealed = true;
}

function nextTurn(game: GameState): void {
  if (game.status === "finished") return;
  const previous = game.currentPlayerId;
  let next = game.extraTurnPlayerId
    ? game.players.find(
        (item) => item.id === game.extraTurnPlayerId && item.alive,
      )
    : undefined;
  delete game.extraTurnPlayerId;
  if (!next) {
    const start = game.players.findIndex((item) => item.id === previous);
    for (let offset = 1; offset <= game.players.length; offset += 1) {
      const index =
        (start + game.direction * offset + game.players.length * 2) %
        game.players.length;
      if (game.players[index]!.alive) {
        next = game.players[index];
        break;
      }
    }
  }
  requireRule(next, "没有可继续的玩家");
  game.currentPlayerId = next.id;
  game.turn += 1;
  game.phase = "action";
  delete game.cannotShootTurn;
  log(game, `轮到 ${next.name} 行动`);
}

function afterAction(game: GameState): void {
  if (game.status === "finished") return;
  if (player(game, game.currentPlayerId).armed) game.phase = "aim";
  else nextTurn(game);
}

function takeEquipment(game: GameState): EquipmentCard {
  const card = game.equipmentDeck.shift();
  requireRule(card, "装备牌堆已空");
  return card;
}

function giveEquipment(
  game: GameState,
  target: GamePlayer,
  card: EquipmentCard,
  after: "action" | "shot" | "restore",
  restorePhase?: GamePhase,
): void {
  target.equipment.push(card);
  if (target.equipment.length > 1) {
    game.equipmentChoices = {
      playerId: target.id,
      cards: [...target.equipment],
      after,
      restorePhase,
    };
    game.phase = "equipment";
  } else if (after === "action") afterAction(game);
  else if (after === "shot") nextTurn(game);
}

function restoreEquipmentPhase(game: GameState, phase: GamePhase): void {
  game.phase = phase;
  // An effect may remove the current player's gun during their aiming step.
  if (phase === "aim" && !player(game, game.currentPlayerId).armed)
    nextTurn(game);
}

export function getWaitingPlayerId(game: GameState): string {
  return (
    game.equipmentChoices?.playerId ??
    game.pendingReveals?.playerIds[0] ??
    game.pendingInvestigations?.playerId ??
    game.currentPlayerId
  );
}

export function createGame(
  identities: PlayerIdentity[],
  options: GameOptions = {},
): GameState {
  requireRule(
    identities.length >= 4 && identities.length <= 8,
    "需要 4～8 名玩家才能开始",
  );
  requireRule(
    new Set(identities.map((item) => item.id)).size === identities.length,
    "玩家身份不能重复",
  );
  requireRule(
    identities.every((item) => item.id && item.name),
    "玩家资料不完整",
  );
  const random = options.random ?? Math.random;
  const count = identities.length;
  const eachNormal = Math.ceil((count * 3 - 2) / 2);
  let sequence = 0;
  const makeCard = (value: CardValue): IdentityCard => ({
    id: `identity-${++sequence}`,
    value,
    revealed: false,
    wounded: false,
  });
  const normalCards = shuffle(
    [
      ...Array.from({ length: eachNormal }, () => makeCard("honest")),
      ...Array.from({ length: eachNormal }, () => makeCard("crooked")),
    ],
    random,
  );
  const firstCards = shuffle(
    [
      makeCard("agent"),
      makeCard("kingpin"),
      ...normalCards.splice(0, count - 2),
    ],
    random,
  );
  const equipmentDeck = shuffle(createEquipmentDeck(), random);
  const players = identities.map(
    (item, index): GamePlayer => ({
      ...item,
      alive: true,
      armed: false,
      aimingAt: null,
      plantedEvidence: false,
      cards: shuffle(
        [firstCards[index]!, normalCards.shift()!, normalCards.shift()!],
        random,
      ),
      equipment: [equipmentDeck.shift()!],
    }),
  );
  const firstPlayer = players[Math.floor(random() * count)]!;
  const now = options.now ?? Date.now();
  return {
    version: 1,
    players,
    status: "playing",
    currentPlayerId: firstPlayer.id,
    phase: "action",
    turn: 1,
    winner: null,
    direction: 1,
    reactionMs: options.reactionMs ?? 6000,
    gunSupply: count === 4 ? 2 : count <= 6 ? 3 : 4,
    equipmentDeck,
    equipmentDiscard: [],
    known: Object.fromEntries(players.map((item) => [item.id, {}])),
    logs: [
      { id: "log-1", text: `对局开始，轮到 ${firstPlayer.name} 行动`, at: now },
    ],
    logSequence: 1,
  };
}

function chooseEquipment(
  game: GameState,
  actorId: string,
  cardId: string,
): void {
  const choice = game.equipmentChoices;
  requireRule(
    game.phase === "equipment" && choice?.playerId === actorId,
    "现在不需要你选择装备",
  );
  requireRule(
    choice.cards.some((card) => card.id === cardId),
    "请选择可保留的装备",
  );
  const target = player(game, actorId);
  const kept = choice.cards.find((card) => card.id === cardId)!;
  game.equipmentDeck.push(...choice.cards.filter((card) => card.id !== cardId));
  target.equipment = [kept];
  delete game.equipmentChoices;
  log(game, `${target.name} 保留了一张装备`);
  if (choice.after === "action") afterAction(game);
  else if (choice.after === "shot") nextTurn(game);
  else restoreEquipmentPhase(game, choice.restorePhase!);
}

function chooseReveal(
  game: GameState,
  actorId: string,
  cardIndex: number,
): void {
  const pending = game.pendingReveals;
  requireRule(
    game.phase === "reveal" && pending?.playerIds[0] === actorId,
    "现在不需要你公开身份",
  );
  const target = livingPlayer(game, actorId);
  hiddenIdentity(target, cardIndex).revealed = true;
  log(game, `${target.name} 公开了第 ${cardIndex + 1} 张身份`);
  pending.playerIds.shift();
  if (pending.playerIds.length === 0) {
    delete game.pendingReveals;
    restoreEquipmentPhase(game, pending.restorePhase);
  }
}

function chooseInvestigation(
  game: GameState,
  actorId: string,
  targetId: string,
  cardIndex: number,
): void {
  const pending = game.pendingInvestigations;
  requireRule(
    game.phase === "investigation" && pending?.playerId === actorId,
    "现在不需要你选择调查",
  );
  requireRule(pending.targetIds.includes(targetId), "请调查待选列表中的玩家");
  const target = livingPlayer(game, targetId);
  investigate(game, actorId, target, cardIndex);
  pending.targetIds = pending.targetIds.filter((id) => id !== targetId);
  log(
    game,
    `${player(game, actorId).name} 用金属探测器调查了 ${target.name} 的第 ${cardIndex + 1} 张身份`,
    [
      {
        investigatorId: actorId,
        targetId: target.id,
        cardIndices: [cardIndex],
      },
    ],
  );
  if (pending.targetIds.length === 0) {
    delete game.pendingInvestigations;
    restoreEquipmentPhase(game, pending.restorePhase);
  }
}

function beginReveals(
  game: GameState,
  targetIds: string[],
  restorePhase: GamePhase,
): void {
  const playerIds = targetIds.filter((id) =>
    player(game, id).cards.some((card) => !card.revealed),
  );
  requireRule(playerIds.length > 0, "没有可公开的身份牌");
  game.pendingReveals = { playerIds, restorePhase };
  game.phase = "reveal";
}

function useEquipment(
  game: GameState,
  actor: GamePlayer,
  action: Extract<GameAction, { type: "useEquipment" }>,
): void {
  requireRule(
    !game.equipmentChoices &&
      !game.pendingReveals &&
      !game.pendingInvestigations &&
      game.phase !== "redirect",
    "请先完成当前装备的选择",
  );
  const equipment = actor.equipment.find((card) => card.id === action.cardId);
  requireRule(equipment, "你没有这张装备");
  const originalPhase = game.phase;
  if (equipment.timing === "otherTurn")
    requireRule(game.currentPlayerId !== actor.id, "咖啡只能在他人回合使用");
  if (equipment.timing === "ownTurn")
    requireRule(
      game.currentPlayerId === actor.id &&
        (game.phase === "action" || game.phase === "aim"),
      "这张装备只能在自己的行动或瞄准阶段使用",
    );
  if (equipment.timing === "reaction")
    requireRule(
      game.phase === "reaction" && game.pendingShot,
      "限制令只能在有人宣告射击时使用",
    );
  if (equipment.timing === "afterInvestigation")
    requireRule(game.lastInvestigation, "目前没有可响应的调查行动");
  // Remove before resolving, so Evidence Bag cannot transfer the card being played.
  actor.equipment = actor.equipment.filter((card) => card.id !== equipment.id);
  log(game, `${actor.name} 使用了「${equipment.title}」`);
  switch (equipment.kind) {
    case "coffee":
      game.extraTurnPlayerId = actor.id;
      break;
    case "blackmail": {
      const first = livingPlayer(game, action.targetId);
      const second = livingPlayer(game, action.otherTargetId);
      requireRule(
        first.id !== second.id &&
          first.id !== actor.id &&
          second.id !== actor.id,
        "勒索必须选择另外两名不同玩家",
      );
      const firstCard = identity(first, action.cardIndex);
      const secondCard = identity(second, action.otherCardIndex);
      // The exchange is visible: prior knowledge follows the actual cards.
      // Previous owners remember the identity they just handed away as well.
      game.known[first.id]![firstCard.id] = true;
      game.known[second.id]![secondCard.id] = true;
      if (
        (game.lastInvestigation?.targetId === first.id &&
          game.lastInvestigation.cardIndex === action.cardIndex) ||
        (game.lastInvestigation?.targetId === second.id &&
          game.lastInvestigation.cardIndex === action.otherCardIndex)
      )
        delete game.lastInvestigation;
      first.cards[action.cardIndex!] = secondCard;
      second.cards[action.otherCardIndex!] = firstCard;
      log(game, `${first.name} 与 ${second.name} 各交换了一张身份`);
      checkSoloWinner(game);
      break;
    }
    case "defibrillator": {
      const target = player(game, action.targetId);
      requireRule(
        target.id !== actor.id && !target.alive,
        "请选择另一名已出局的玩家",
      );
      target.alive = true;
      log(game, `${target.name} 重返对局`);
      break;
    }
    case "evidenceBag": {
      const source = livingPlayer(game, action.targetId);
      const target = livingPlayer(game, action.otherTargetId);
      requireRule(
        source.id !== target.id && target.id !== actor.id,
        "接收装备的玩家必须与来源不同，且不能是你",
      );
      requireRule(source.equipment.length === 1, "来源玩家没有可转移的装备");
      giveEquipment(
        game,
        target,
        source.equipment.pop()!,
        "restore",
        originalPhase,
      );
      log(game, `${source.name} 的装备交给了 ${target.name}`);
      break;
    }
    case "flashbang": {
      const target = livingPlayer(game, action.targetId);
      invalidateKnowledge(game, target.cards);
      target.cards = shuffle(target.cards);
      for (const card of target.cards) card.revealed = false;
      if (game.lastInvestigation?.targetId === target.id)
        delete game.lastInvestigation;
      log(game, `${target.name} 的身份已重新洗乱并盖回`);
      break;
    }
    case "k9Unit": {
      const target = livingPlayer(game, action.targetId);
      requireRule(target.armed, "请选择一名持枪玩家");
      returnGun(game, target);
      log(game, `${target.name} 放下了枪`);
      if (game.pendingShot?.shooterId === target.id) {
        delete game.pendingShot;
        game.phase = "action";
        log(game, "射击被阻止，射手重新选择行动");
      } else if (game.phase === "aim" && game.currentPlayerId === target.id)
        nextTurn(game);
      break;
    }
    case "metalDetector": {
      const targetIds = game.players
        .filter(
          (target) =>
            target.alive &&
            target.armed &&
            target.id !== actor.id &&
            target.cards.some((card) => !card.revealed),
        )
        .map((target) => target.id);
      requireRule(targetIds.length > 0, "没有可以调查的其他持枪玩家");
      game.pendingInvestigations = {
        playerId: actor.id,
        targetIds,
        restorePhase: originalPhase,
      };
      game.phase = "investigation";
      break;
    }
    case "plantedEvidence": {
      const target = livingPlayer(game, action.targetId);
      requireRule(!target.plantedEvidence, "这名玩家已经被栽赃");
      target.plantedEvidence = true;
      log(game, `${target.name} 的普通身份阵营被翻转`);
      break;
    }
    case "polygraph": {
      const target = livingPlayer(game, action.targetId);
      requireRule(target.id !== actor.id, "请选择另一名玩家");
      for (const card of target.cards) game.known[actor.id]![card.id] = true;
      for (const card of actor.cards) game.known[target.id]![card.id] = true;
      log(
        game,
        `${actor.name} 与 ${target.name} 互相查看了全部身份（第 1、2、3 张）`,
        [
          {
            investigatorId: actor.id,
            targetId: target.id,
            cardIndices: [0, 1, 2],
          },
          {
            investigatorId: target.id,
            targetId: actor.id,
            cardIndices: [0, 1, 2],
          },
        ],
      );
      break;
    }
    case "reportAudit":
      beginReveals(
        game,
        game.players
          .filter((target) => target.alive)
          .map((target) => target.id),
        originalPhase,
      );
      break;
    case "restrainingOrder": {
      const shot = game.pendingShot!;
      requireRule(
        game.players.some(
          (target) =>
            target.alive &&
            target.id !== shot.shooterId &&
            target.id !== shot.targetId,
        ),
        "没有可以转向的其他玩家",
      );
      game.phase = "redirect";
      log(game, "射手必须重新选择另一名射击目标");
      break;
    }
    case "smokeGrenade":
      game.direction = game.direction === 1 ? -1 : 1;
      log(game, "回合轮转方向已反转");
      break;
    case "surveillanceCamera": {
      const last = game.lastInvestigation!;
      identity(livingPlayer(game, last.targetId), last.cardIndex).revealed =
        true;
      log(game, "最近一次调查的身份已公开");
      delete game.lastInvestigation;
      break;
    }
    case "taser": {
      requireRule(!actor.armed, "已持枪时不能使用电击枪");
      const target = livingPlayer(game, action.targetId);
      requireRule(
        target.id !== actor.id && target.armed,
        "请选择另一名持枪玩家",
      );
      target.armed = false;
      target.aimingAt = null;
      actor.armed = true;
      actor.aimingAt = target.id;
      game.cannotShootTurn = game.turn;
      log(game, `${actor.name} 夺走了 ${target.name} 的枪并瞄准对方`);
      break;
    }
    case "truthSerum": {
      const target = livingPlayer(game, action.targetId);
      beginReveals(game, [target.id], originalPhase);
      break;
    }
    case "wiretap": {
      const first = livingPlayer(game, action.targetId);
      const second = livingPlayer(game, action.otherTargetId);
      requireRule(
        first.id !== second.id &&
          first.id !== actor.id &&
          second.id !== actor.id,
        "请选择另外两名不同玩家",
      );
      investigate(game, actor.id, first, action.cardIndex!);
      investigate(game, actor.id, second, action.otherCardIndex!);
      log(
        game,
        `${actor.name} 窃听了 ${first.name} 的第 ${action.cardIndex! + 1} 张身份和 ${second.name} 的第 ${action.otherCardIndex! + 1} 张身份`,
        [
          {
            investigatorId: actor.id,
            targetId: first.id,
            cardIndices: [action.cardIndex!],
          },
          {
            investigatorId: actor.id,
            targetId: second.id,
            cardIndices: [action.otherCardIndex!],
          },
        ],
      );
      break;
    }
  }
  if (equipment.kind === "smokeGrenade" || equipment.kind === "plantedEvidence")
    game.equipmentDiscard.push(equipment);
  else game.equipmentDeck.push(equipment);
}

function resolveShot(game: GameState): void {
  const shot = game.pendingShot;
  requireRule(game.phase === "reaction" && shot, "当前没有待结算的射击");
  const shooter = livingPlayer(game, shot.shooterId);
  const target = livingPlayer(game, shot.targetId);
  requireRule(shooter.armed, "射手已没有枪");
  returnGun(game, shooter);
  delete game.pendingShot;
  for (const card of target.cards) card.revealed = true;
  const leader = target.cards.find(
    (card) => card.value === "agent" || card.value === "kingpin",
  );
  if (leader && !leader.wounded) {
    leader.wounded = true;
    log(game, `${target.name} 中枪受伤，领袖身份公开，并取得一张装备`);
    giveEquipment(game, target, takeEquipment(game), "shot");
    return;
  }
  target.alive = false;
  returnGun(game, target);
  game.equipmentDeck.push(...target.equipment);
  target.equipment = [];
  log(game, `${target.name} 中枪出局`);
  if (leader) {
    const team = leader.value === "agent" ? "crooked" : "honest";
    finish(game, {
      team,
      reason: `${leader.value === "agent" ? "探长" : "主谋"} 被击败，${team === "honest" ? "忠警" : "黑警"}阵营获胜`,
    });
  } else nextTurn(game);
}

function skip(game: GameState): void {
  const waiting = player(game, getWaitingPlayerId(game));
  if (game.phase === "equipment")
    chooseEquipment(game, waiting.id, game.equipmentChoices!.cards[0]!.id);
  else if (game.phase === "reveal")
    chooseReveal(
      game,
      waiting.id,
      waiting.cards.findIndex((card) => !card.revealed),
    );
  else if (game.phase === "investigation") {
    const target = player(game, game.pendingInvestigations!.targetIds[0]);
    chooseInvestigation(
      game,
      waiting.id,
      target.id,
      target.cards.findIndex((card) => !card.revealed),
    );
  } else if (game.phase === "redirect") {
    const shot = game.pendingShot!;
    const target = game.players.find(
      (item) =>
        item.alive && item.id !== shot.shooterId && item.id !== shot.targetId,
    )!;
    redirectShot(game, shot.shooterId, target.id);
  } else if (game.phase === "reaction") resolveShot(game);
  else {
    log(game, `${waiting.name} 的回合被房主跳过`);
    delete game.lastInvestigation;
    nextTurn(game);
  }
}

function redirectShot(
  game: GameState,
  actorId: string,
  targetId: string,
): void {
  const shot = game.pendingShot!;
  requireRule(shot.shooterId === actorId, "等待射手选择新的目标");
  const target = livingPlayer(game, targetId);
  requireRule(
    target.id !== actorId && target.id !== shot.targetId,
    "必须选择自己以外的另一名目标",
  );
  shot.targetId = target.id;
  shot.deadline = Date.now() + game.reactionMs;
  player(game, actorId).aimingAt = target.id;
  game.phase = "reaction";
  log(game, `射手将目标改为 ${target.name}`);
}

/** Clone first: a rejected request never partially changes persisted state. */
export function applyGameAction(
  original: GameState,
  actorId: string,
  action: GameAction,
): GameState {
  requireRule(original.status === "playing", "对局已经结束");
  requireRule(action && typeof action.type === "string", "无效的游戏操作");
  const game = structuredClone(original);
  if (action.type === "resolveShot") {
    resolveShot(game);
    return game;
  }
  if (action.type === "skip") {
    skip(game);
    return game;
  }
  const actor = livingPlayer(game, actorId);
  if (action.type === "chooseEquipment") {
    chooseEquipment(game, actorId, action.cardId);
    return game;
  }
  if (action.type === "chooseReveal") {
    chooseReveal(game, actorId, action.cardIndex);
    return game;
  }
  if (action.type === "chooseInvestigation") {
    chooseInvestigation(game, actorId, action.targetId, action.cardIndex);
    return game;
  }
  if (action.type === "useEquipment") {
    useEquipment(game, actor, action);
    return game;
  }
  requireRule(game.currentPlayerId === actorId, "还没轮到你");
  if (action.type === "aim") {
    if (game.phase === "redirect") {
      redirectShot(game, actorId, action.targetId);
      return game;
    }
    requireRule(game.phase === "aim" && actor.armed, "现在不能瞄准");
    const target = livingPlayer(game, action.targetId);
    requireRule(target.id !== actorId, "不能瞄准自己");
    actor.aimingAt = target.id;
    log(game, `${actor.name} 瞄准了 ${target.name}`);
    nextTurn(game);
    return game;
  }
  if (action.type === "endTurn") {
    requireRule(
      game.phase === "aim" && actor.armed && actor.aimingAt,
      "请完成行动并选择瞄准目标",
    );
    requireRule(
      player(game, actor.aimingAt).alive,
      "原目标已经出局，请选择新的瞄准目标",
    );
    nextTurn(game);
    return game;
  }
  requireRule(game.phase === "action", "请先完成当前阶段");
  delete game.lastInvestigation;
  switch (action.type) {
    case "investigate": {
      const target = livingPlayer(game, action.targetId);
      requireRule(target.id !== actorId, "你已经知道自己的身份");
      investigate(game, actorId, target, action.cardIndex);
      log(
        game,
        `${actor.name} 调查了 ${target.name} 的第 ${action.cardIndex + 1} 张身份`,
        [
          {
            investigatorId: actorId,
            targetId: target.id,
            cardIndices: [action.cardIndex],
          },
        ],
      );
      game.lastInvestigation = {
        targetId: target.id,
        cardIndex: action.cardIndex,
        turn: game.turn,
      };
      afterAction(game);
      break;
    }
    case "arm":
      requireRule(!actor.armed, "你已经持有一把枪");
      requireRule(game.gunSupply > 0, "公共区已经没有可拿的枪");
      revealCost(actor, action.revealIndex);
      actor.armed = true;
      actor.aimingAt = null;
      game.gunSupply -= 1;
      log(game, `${actor.name} 拿起一把枪`);
      afterAction(game);
      break;
    case "equip":
      revealCost(actor, action.revealIndex);
      log(game, `${actor.name} 取得了一张装备`);
      giveEquipment(game, actor, takeEquipment(game), "action");
      break;
    case "shoot": {
      requireRule(actor.armed && actor.aimingAt, "你需要先持枪并瞄准目标");
      requireRule(
        game.cannotShootTurn !== game.turn,
        "使用电击枪的这个回合不能射击",
      );
      const target = livingPlayer(game, actor.aimingAt);
      requireRule(target.id !== actorId, "不能射击自己");
      game.pendingShot = {
        shooterId: actorId,
        targetId: target.id,
        deadline: Date.now() + game.reactionMs,
      };
      game.phase = "reaction";
      log(game, `${actor.name} 宣告向 ${target.name} 射击，进入装备响应时间`);
      break;
    }
    default:
      throw new GameError("不支持的游戏操作");
  }
  return game;
}

export function gameView(game: GameState, viewerId: string): GameView {
  const viewer = player(game, viewerId);
  const finished = game.status === "finished";
  const knownCards = game.known[viewerId] ?? {};
  return {
    status: game.status,
    currentPlayerId: game.currentPlayerId,
    phase: game.phase,
    turn: game.turn,
    winner: game.winner ? { ...game.winner } : null,
    gunSupply: game.gunSupply,
    direction: game.direction,
    logs: game.logs.map((entry) => ({
      id: entry.id,
      text: entry.text,
      at: entry.at,
      ...(entry.investigations
        ? {
            investigations: entry.investigations.map(
              ({ investigatorId, targetId, cardIndices }) => ({
                investigatorId,
                targetId,
                cardIndices: [...cardIndices],
              }),
            ),
          }
        : {}),
    })),
    ...(game.pendingShot ? { pendingShot: { ...game.pendingShot } } : {}),
    ...(game.pendingReveals
      ? { pendingRevealPlayerId: game.pendingReveals.playerIds[0] }
      : {}),
    players: game.players.map((target) => ({
      id: target.id,
      name: target.name,
      avatar: target.avatar,
      alive: target.alive,
      wounded: target.cards.some((card) => card.wounded),
      armed: target.armed,
      aimingAt: target.aimingAt,
      equipmentCount: target.equipment.length,
      plantedEvidence: target.plantedEvidence,
      cards: target.cards.map((card) => {
        const known =
          finished ||
          target.id === viewerId ||
          card.revealed ||
          knownCards[card.id] === true;
        return {
          value: known ? card.value : null,
          revealed: card.revealed,
          known,
          wounded: known && card.wounded,
        };
      }),
    })),
    me: {
      id: viewerId,
      team: teamOf(viewer),
      equipment: viewer.equipment.map((card) => ({ ...card })),
      canAct:
        game.status === "playing" &&
        viewer.alive &&
        game.currentPlayerId === viewerId &&
        game.phase === "action",
      ...(game.equipmentChoices?.playerId === viewerId
        ? {
            equipmentChoices: game.equipmentChoices.cards.map((card) => ({
              ...card,
            })),
          }
        : {}),
      ...(game.pendingInvestigations?.playerId === viewerId
        ? { investigationTargets: [...game.pendingInvestigations.targetIds] }
        : {}),
    },
  };
}
