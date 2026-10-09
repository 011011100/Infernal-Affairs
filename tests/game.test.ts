import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameAction,
  createGame,
  gameView,
  getWaitingPlayerId,
  teamOf,
} from "../server/game.js";
import { createEquipmentDeck } from "../shared/equipment.js";
import type { EquipmentKind, GamePlayer, GameState } from "../shared/types.js";

function fresh(count = 4): GameState {
  let seed = 712837;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return createGame(
    Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      name: `玩家${index}`,
      avatar: "🐱",
    })),
    { random, now: 1000 },
  );
}

function give(game: GameState, id: string, kind: EquipmentKind): string {
  const card = createEquipmentDeck().find((item) => item.kind === kind)!;
  game.equipmentDeck = game.equipmentDeck.filter((item) => item.kind !== kind);
  for (const target of game.players)
    target.equipment = target.equipment.filter((item) => item.kind !== kind);
  const target = game.players.find((item) => item.id === id)!;
  game.equipmentDeck.push(...target.equipment);
  target.equipment = [card];
  return card.id;
}

function current(game: GameState): GamePlayer {
  return game.players.find((item) => item.id === game.currentPlayerId)!;
}
function other(game: GameState, id = game.currentPlayerId): GamePlayer {
  return game.players.find((item) => item.id !== id)!;
}
function shootAt(
  game: GameState,
  shooter: GamePlayer,
  target: GamePlayer,
): GameState {
  game.currentPlayerId = shooter.id;
  game.phase = "action";
  if (!shooter.armed) game.gunSupply -= 1;
  shooter.armed = true;
  shooter.aimingAt = target.id;
  game = applyGameAction(game, shooter.id, { type: "shoot" });
  return applyGameAction(game, "", { type: "resolveShot" });
}

test("4–8 player setup has 3 identities each, separate leaders and correct guns", () => {
  for (let count = 4; count <= 8; count += 1) {
    const game = fresh(count);
    const cards = game.players.flatMap((target) => target.cards);
    assert.equal(cards.length, count * 3);
    assert.equal(cards.filter((card) => card.value === "agent").length, 1);
    assert.equal(cards.filter((card) => card.value === "kingpin").length, 1);
    assert.ok(
      game.players.every(
        (target) =>
          target.cards.filter((card) =>
            ["agent", "kingpin"].includes(card.value),
          ).length < 2,
      ),
    );
    assert.ok(game.players.every((target) => target.equipment.length === 1));
    assert.equal(game.gunSupply, count === 4 ? 2 : count <= 6 ? 3 : 4);
    assert.equal(game.equipmentDeck.length, 16 - count);
    assert.equal(game.logs[0]?.at, 1000);
    assert.deepEqual(JSON.parse(JSON.stringify(game)), game);
  }
  assert.throws(() => fresh(3), /4～8/);
  assert.throws(() => fresh(9), /4～8/);
});

test("projections expose own cards, never other hands, decks or hidden teams", () => {
  const game = fresh();
  const view = gameView(game, "p0");
  assert.ok(
    view.players
      .find((item) => item.id === "p0")!
      .cards.every((card) => card.value !== null),
  );
  assert.ok(
    view.players
      .filter((item) => item.id !== "p0")
      .every((item) => item.cards.every((card) => card.value === null)),
  );
  assert.equal(view.me.equipment.length, 1);
  assert.ok(!("equipmentDeck" in view));
  assert.ok(!("known" in view));
  assert.ok(!("team" in view.players[1]!));
  assert.ok(!("equipment" in view.players[1]!));
  view.me.equipment[0]!.title = "changed";
  assert.notEqual(game.players[0]!.equipment[0]!.title, "changed");
});

test("investigation teaches only its actor and advances an unarmed turn", () => {
  let game = fresh();
  const actor = current(game);
  const target = other(game);
  const observer = game.players.find(
    (item) => item.id !== actor.id && item.id !== target.id,
  )!;
  game = applyGameAction(game, actor.id, {
    type: "investigate",
    targetId: target.id,
    cardIndex: 0,
  });
  assert.notEqual(game.currentPlayerId, actor.id);
  assert.equal(
    gameView(game, actor.id).players.find((item) => item.id === target.id)!
      .cards[0]!.value,
    target.cards[0]!.value,
  );
  assert.equal(
    gameView(game, observer.id).players.find((item) => item.id === target.id)!
      .cards[0]!.value,
    null,
  );
  assert.equal(
    game.players.find((item) => item.id === target.id)!.cards[0]!.revealed,
    false,
  );
});

test("invalid and out-of-turn actions leave original state byte-for-byte intact", () => {
  const game = fresh();
  const actor = current(game);
  const snapshot = JSON.stringify(game);
  assert.throws(
    () =>
      applyGameAction(game, other(game).id, { type: "arm", revealIndex: 0 }),
    /还没轮到/,
  );
  assert.throws(
    () => applyGameAction(game, actor.id, { type: "arm" }),
    /选择一张/,
  );
  assert.throws(
    () =>
      applyGameAction(game, actor.id, {
        type: "investigate",
        targetId: other(game).id,
        cardIndex: 99,
      }),
    /选择一张/,
  );
  assert.throws(
    () => applyGameAction(game, actor.id, { type: "endTurn" }),
    /完成行动/,
  );
  assert.equal(JSON.stringify(game), snapshot);
});

test("arming reveals chosen card, consumes a gun and requires a legal aim", () => {
  let game = fresh();
  const actor = current(game);
  game = applyGameAction(game, actor.id, { type: "arm", revealIndex: 1 });
  assert.equal(game.phase, "aim");
  assert.equal(game.gunSupply, 1);
  assert.equal(current(game).cards[1]!.revealed, true);
  assert.throws(
    () => applyGameAction(game, actor.id, { type: "aim", targetId: actor.id }),
    /自己/,
  );
  game = applyGameAction(game, actor.id, {
    type: "aim",
    targetId: other(game).id,
  });
  assert.notEqual(game.currentPlayerId, actor.id);
  assert.equal(game.turn, 2);
});

test("fully revealed players can arm and equip without another reveal", () => {
  let game = fresh();
  current(game).cards.forEach((card) => {
    card.revealed = true;
  });
  const actor = current(game).id;
  game = applyGameAction(game, actor, { type: "arm" });
  assert.equal(game.phase, "aim");
});

test("equipment action draws one, keeps one of two, and hides the choices", () => {
  let game = fresh();
  const actor = current(game).id;
  const previousDeckCount = game.equipmentDeck.length;
  game = applyGameAction(game, actor, { type: "equip", revealIndex: 0 });
  assert.equal(game.phase, "equipment");
  assert.equal(game.equipmentChoices!.cards.length, 2);
  assert.equal(game.equipmentDeck.length, previousDeckCount - 1);
  assert.equal(
    gameView(game, other(game, actor).id).me.equipmentChoices,
    undefined,
  );
  assert.equal(getWaitingPlayerId(game), actor);
  assert.throws(
    () =>
      applyGameAction(game, actor, {
        type: "useEquipment",
        cardId: game.equipmentChoices!.cards[0]!.id,
      }),
    /先完成/,
  );
  const kept = game.equipmentChoices!.cards[1]!.id;
  game = applyGameAction(game, actor, {
    type: "chooseEquipment",
    cardId: kept,
  });
  assert.equal(
    game.players.find((item) => item.id === actor)!.equipment[0]!.id,
    kept,
  );
  assert.equal(game.equipmentDeck.length, previousDeckCount);
  assert.notEqual(game.currentPlayerId, actor);
});

test("a normal player dies in one shot, reveals identities and returns gun/equipment", () => {
  let game = fresh();
  const victim = game.players.find((target) =>
    target.cards.every(
      (card) => card.value === "honest" || card.value === "crooked",
    ),
  )!;
  const shooter = other(game, victim.id);
  victim.armed = true;
  victim.aimingAt = shooter.id;
  game.gunSupply -= 1;
  game = shootAt(game, shooter, victim);
  const result = game.players.find((target) => target.id === victim.id)!;
  assert.equal(result.alive, false);
  assert.ok(result.cards.every((card) => card.revealed));
  assert.equal(result.equipment.length, 0);
  assert.equal(result.armed, false);
  assert.equal(game.gunSupply, 2);
  assert.equal(game.status, "playing");
});

test("leader survives first bullet, chooses equipment, and loses on second bullet", () => {
  let game = fresh();
  const victim = game.players.find((target) =>
    target.cards.some((card) => card.value === "agent"),
  )!;
  const shooter = other(game, victim.id);
  game = shootAt(game, shooter, victim);
  assert.equal(game.phase, "equipment");
  assert.equal(
    game.players.find((target) => target.id === victim.id)!.alive,
    true,
  );
  assert.equal(
    gameView(game, shooter.id).players.find(
      (target) => target.id === victim.id,
    )!.wounded,
    true,
  );
  game = applyGameAction(game, victim.id, {
    type: "chooseEquipment",
    cardId: game.equipmentChoices!.cards[0]!.id,
  });
  game = shootAt(
    game,
    game.players.find((target) => target.id === shooter.id)!,
    game.players.find((target) => target.id === victim.id)!,
  );
  assert.equal(game.status, "finished");
  assert.equal(game.winner!.team, "crooked");
  assert.ok(
    gameView(game, shooter.id).players.every((target) =>
      target.cards.every((card) => card.value !== null),
    ),
  );
});

test("restraining order redirects pending shot and gun returns only at resolution", () => {
  let game = fresh();
  const shooter = current(game);
  const original = other(game);
  const redirect = game.players.find(
    (target) => target.id !== shooter.id && target.id !== original.id,
  )!;
  const cardId = give(game, redirect.id, "restrainingOrder");
  shooter.armed = true;
  shooter.aimingAt = original.id;
  game.gunSupply -= 1;
  game = applyGameAction(game, shooter.id, { type: "shoot" });
  assert.equal(game.phase, "reaction");
  assert.ok(game.pendingShot!.deadline > Date.now());
  game = applyGameAction(game, redirect.id, { type: "useEquipment", cardId });
  assert.equal(game.phase, "redirect");
  assert.throws(
    () =>
      applyGameAction(game, redirect.id, {
        type: "aim",
        targetId: redirect.id,
      }),
    /还没轮到/,
  );
  assert.throws(
    () =>
      applyGameAction(game, shooter.id, { type: "aim", targetId: original.id }),
    /另一名目标/,
  );
  game = applyGameAction(game, shooter.id, {
    type: "aim",
    targetId: redirect.id,
  });
  assert.equal(game.pendingShot!.targetId, redirect.id);
  game = applyGameAction(game, "", { type: "resolveShot" });
  assert.ok(
    game.players
      .find((target) => target.id === redirect.id)!
      .cards.every((card) => card.revealed),
  );
  assert.ok(
    game.players
      .find((target) => target.id === original.id)!
      .cards.every((card) => !card.revealed),
  );
  assert.equal(
    game.players.find((target) => target.id === shooter.id)!.armed,
    false,
  );
});

test("K9 cancels a declared shot and lets shooter choose another action", () => {
  let game = fresh();
  const shooter = current(game);
  const target = other(game);
  const cardId = give(game, target.id, "k9Unit");
  shooter.armed = true;
  shooter.aimingAt = target.id;
  game.gunSupply -= 1;
  game = applyGameAction(game, shooter.id, { type: "shoot" });
  game = applyGameAction(game, target.id, {
    type: "useEquipment",
    cardId,
    targetId: shooter.id,
  });
  assert.equal(game.pendingShot, undefined);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, shooter.id);
  assert.equal(game.gunSupply, 2);
});

test("truth serum allows target to choose; audit waits for each eligible player", () => {
  let game = fresh();
  const actor = current(game).id;
  const target = other(game).id;
  const cardId = give(game, actor, "truthSerum");
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: target,
  });
  assert.equal(game.phase, "reveal");
  assert.equal(getWaitingPlayerId(game), target);
  assert.throws(
    () => applyGameAction(game, actor, { type: "chooseReveal", cardIndex: 0 }),
    /不需要你/,
  );
  game = applyGameAction(game, target, { type: "chooseReveal", cardIndex: 2 });
  assert.equal(
    game.players.find((item) => item.id === target)!.cards[2]!.revealed,
    true,
  );
  assert.equal(game.phase, "action");
  const audit = give(game, actor, "reportAudit");
  game = applyGameAction(game, actor, { type: "useEquipment", cardId: audit });
  for (let index = 0; index < 4; index += 1)
    game = applyGameAction(game, "", { type: "skip" });
  assert.equal(game.phase, "action");
  assert.ok(
    game.players.every((item) => item.cards.some((card) => card.revealed)),
  );
});

test("metal detector requires a private selection for each gun holder", () => {
  let game = fresh();
  const actor = current(game).id;
  const holders = game.players
    .filter((target) => target.id !== actor)
    .slice(0, 2);
  holders.forEach((target) => {
    target.armed = true;
    game.gunSupply -= 1;
  });
  const cardId = give(game, actor, "metalDetector");
  game = applyGameAction(game, actor, { type: "useEquipment", cardId });
  assert.equal(game.phase, "investigation");
  assert.equal(gameView(game, actor).me.investigationTargets!.length, 2);
  assert.equal(
    gameView(game, holders[0]!.id).me.investigationTargets,
    undefined,
  );
  for (const target of holders)
    game = applyGameAction(game, actor, {
      type: "chooseInvestigation",
      targetId: target.id,
      cardIndex: 0,
    });
  assert.equal(game.phase, "action");
  for (const target of holders)
    assert.notEqual(
      gameView(game, actor).players.find((item) => item.id === target.id)!
        .cards[0]!.value,
      null,
    );
});

test("blackmail moves private knowledge and wound with the actual leader card", () => {
  let game = fresh();
  const leaderOwner = game.players.find((target) =>
    target.cards.some((card) => card.value === "agent"),
  )!;
  const plain = game.players.find((target) =>
    target.cards.every(
      (card) => card.value !== "agent" && card.value !== "kingpin",
    ),
  )!;
  const actor = game.players.find(
    (target) => target.id !== leaderOwner.id && target.id !== plain.id,
  )!;
  const leaderIndex = leaderOwner.cards.findIndex(
    (card) => card.value === "agent",
  );
  const leaderCard = leaderOwner.cards[leaderIndex]!;
  leaderCard.wounded = true;
  game.known[actor.id]![leaderCard.id] = true;
  const cardId = give(game, actor.id, "blackmail");
  game = applyGameAction(game, actor.id, {
    type: "useEquipment",
    cardId,
    targetId: leaderOwner.id,
    cardIndex: leaderIndex,
    otherTargetId: plain.id,
    otherCardIndex: 0,
  });
  const view = gameView(game, actor.id);
  assert.equal(
    view.players.find((target) => target.id === leaderOwner.id)!.wounded,
    false,
  );
  assert.equal(
    view.players.find((target) => target.id === plain.id)!.wounded,
    true,
  );
  assert.equal(
    view.players.find((target) => target.id === plain.id)!.cards[0]!.value,
    "agent",
  );
  assert.equal(game.known[actor.id]![leaderCard.id], true);
  assert.equal(
    gameView(game, leaderOwner.id).players.find(
      (target) => target.id === plain.id,
    )!.cards[0]!.value,
    "agent",
  );
});

test("collecting both leaders immediately wins solo", () => {
  let game = fresh();
  const agent = game.players.find((target) =>
    target.cards.some((card) => card.value === "agent"),
  )!;
  const kingpin = game.players.find((target) =>
    target.cards.some((card) => card.value === "kingpin"),
  )!;
  const actor = game.players.find(
    (target) => target.id !== agent.id && target.id !== kingpin.id,
  )!;
  const cardId = give(game, actor.id, "blackmail");
  game = applyGameAction(game, actor.id, {
    type: "useEquipment",
    cardId,
    targetId: agent.id,
    cardIndex: agent.cards.findIndex((card) => card.value !== "agent"),
    otherTargetId: kingpin.id,
    otherCardIndex: kingpin.cards.findIndex((card) => card.value === "kingpin"),
  });
  assert.equal(game.status, "finished");
  assert.equal(game.winner!.team, "solo");
  assert.equal(game.winner!.playerId, agent.id);
});

test("flashbang conceals revealed identities and erases every observer memory", () => {
  let game = fresh();
  const actor = current(game).id;
  const target = other(game);
  target.cards.forEach((card) => {
    card.revealed = true;
    game.known[actor]![card.id] = true;
  });
  const cardId = give(game, actor, "flashbang");
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: target.id,
  });
  assert.ok(
    gameView(game, actor)
      .players.find((item) => item.id === target.id)!
      .cards.every((card) => !card.known && card.value === null),
  );
  assert.ok(
    gameView(game, target.id)
      .players.find((item) => item.id === target.id)!
      .cards.every((card) => card.known),
  );
});

test("polygraph knowledge is mutual; wiretap is private and needs two distinct others", () => {
  let game = fresh();
  const actor = current(game).id;
  const target = other(game).id;
  const cardId = give(game, actor, "polygraph");
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: target,
  });
  assert.ok(
    gameView(game, target)
      .players.find((item) => item.id === actor)!
      .cards.every((card) => card.known),
  );
  assert.ok(
    gameView(game, actor)
      .players.find((item) => item.id === target)!
      .cards.every((card) => card.known),
  );
  const wiretap = give(game, actor, "wiretap");
  assert.throws(
    () =>
      applyGameAction(game, actor, {
        type: "useEquipment",
        cardId: wiretap,
        targetId: target,
        otherTargetId: target,
        cardIndex: 0,
        otherCardIndex: 1,
      }),
    /不同玩家/,
  );
  const second = game.players.find(
    (item) => item.id !== actor && item.id !== target,
  )!.id;
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId: wiretap,
    targetId: target,
    otherTargetId: second,
    cardIndex: 0,
    otherCardIndex: 1,
  });
  assert.equal(
    gameView(game, actor).players.find((item) => item.id === second)!.cards[1]!
      .known,
    true,
  );
});

test("planted evidence flips ordinary allegiance but never overrides a leader", () => {
  let game = fresh();
  const plain = game.players.find((target) =>
    target.cards.every(
      (card) => card.value === "honest" || card.value === "crooked",
    ),
  )!;
  const initial = teamOf(plain);
  const cardId = give(game, plain.id, "plantedEvidence");
  game = applyGameAction(game, plain.id, {
    type: "useEquipment",
    cardId,
    targetId: plain.id,
  });
  assert.notEqual(
    teamOf(game.players.find((target) => target.id === plain.id)!),
    initial,
  );
  assert.equal(game.equipmentDiscard.length, 1);
  const leader = game.players.find((target) =>
    target.cards.some((card) => card.value === "agent"),
  )!;
  leader.plantedEvidence = true;
  assert.equal(teamOf(leader), "honest");
});

test("coffee changes the next turn and smoke reverses subsequent order", () => {
  let game = fresh();
  const acting = current(game).id;
  const coffeePlayer =
    game.players[
      (game.players.findIndex((target) => target.id === acting) + 2) % 4
    ]!.id;
  const coffee = give(game, coffeePlayer, "coffee");
  game = applyGameAction(game, coffeePlayer, {
    type: "useEquipment",
    cardId: coffee,
  });
  game = applyGameAction(game, acting, {
    type: "investigate",
    targetId: coffeePlayer,
    cardIndex: 0,
  });
  assert.equal(game.currentPlayerId, coffeePlayer);
  const smoke = give(game, coffeePlayer, "smokeGrenade");
  game = applyGameAction(game, coffeePlayer, {
    type: "useEquipment",
    cardId: smoke,
  });
  assert.equal(game.direction, -1);
  game = applyGameAction(game, coffeePlayer, {
    type: "investigate",
    targetId: acting,
    cardIndex: 0,
  });
  const expected =
    game.players[
      (game.players.findIndex((target) => target.id === coffeePlayer) + 3) % 4
    ]!.id;
  assert.equal(game.currentPlayerId, expected);
});

test("taser transfers an existing gun and forbids shooting in that turn", () => {
  let game = fresh();
  const actor = current(game).id;
  const target = other(game);
  target.armed = true;
  target.aimingAt = actor;
  game.gunSupply -= 1;
  const cardId = give(game, actor, "taser");
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: target.id,
  });
  assert.equal(current(game).armed, true);
  assert.equal(current(game).aimingAt, target.id);
  assert.equal(
    game.players.find((item) => item.id === target.id)!.armed,
    false,
  );
  assert.equal(game.gunSupply, 1);
  assert.throws(
    () => applyGameAction(game, actor, { type: "shoot" }),
    /电击枪/,
  );
  game = applyGameAction(game, actor, {
    type: "investigate",
    targetId: target.id,
    cardIndex: 0,
  });
  assert.equal(game.phase, "aim");
});

test("evidence bag transfer forces recipient to select before play resumes", () => {
  let game = fresh();
  const actor = current(game).id;
  const [source, recipient] = game.players.filter(
    (target) => target.id !== actor,
  );
  const cardId = give(game, actor, "evidenceBag");
  if (source!.equipment.length === 0) give(game, source!.id, "polygraph");
  if (recipient!.equipment.length === 0) give(game, recipient!.id, "coffee");
  const transferredId = source!.equipment[0]!.id;
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: source!.id,
    otherTargetId: recipient!.id,
  });
  assert.equal(game.phase, "equipment");
  assert.equal(getWaitingPlayerId(game), recipient!.id);
  game = applyGameAction(game, recipient!.id, {
    type: "chooseEquipment",
    cardId: transferredId,
  });
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, actor);
  assert.equal(
    game.players.find((target) => target.id === source!.id)!.equipment.length,
    0,
  );
});

test("defibrillator revives another dead player without recreating their gun or equipment", () => {
  let game = fresh();
  const actor = current(game).id;
  const victim = other(game);
  victim.alive = false;
  victim.equipment = [];
  victim.cards.forEach((card) => {
    card.revealed = true;
  });
  const cardId = give(game, actor, "defibrillator");
  game = applyGameAction(game, actor, {
    type: "useEquipment",
    cardId,
    targetId: victim.id,
  });
  const revived = game.players.find((target) => target.id === victim.id)!;
  assert.equal(revived.alive, true);
  assert.equal(revived.equipment.length, 0);
  assert.equal(revived.armed, false);
  assert.ok(revived.cards.every((card) => card.revealed));
});

test("surveillance camera responds to the latest investigation but expires at next action", () => {
  let game = fresh();
  const actor = current(game).id;
  const target = other(game).id;
  const camera = give(game, target, "surveillanceCamera");
  game = applyGameAction(game, actor, {
    type: "investigate",
    targetId: target,
    cardIndex: 1,
  });
  game = applyGameAction(game, target, {
    type: "useEquipment",
    cardId: camera,
  });
  assert.equal(
    game.players.find((item) => item.id === target)!.cards[1]!.revealed,
    true,
  );
  assert.equal(game.lastInvestigation, undefined);
});

test("finished games reject mutations, dead players cannot act, and players cannot pass for free", () => {
  let game = fresh();
  const actor = current(game).id;
  assert.throws(
    () => applyGameAction(game, actor, { type: "endTurn" }),
    /完成行动/,
  );
  other(game).alive = false;
  assert.throws(
    () =>
      applyGameAction(game, other(game).id, {
        type: "useEquipment",
        cardId: "fake",
      }),
    /出局/,
  );
  game.status = "finished";
  assert.throws(
    () => applyGameAction(game, actor, { type: "arm", revealIndex: 0 }),
    /已经结束/,
  );
});
