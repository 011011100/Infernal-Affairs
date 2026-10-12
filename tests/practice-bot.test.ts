import assert from "node:assert/strict";
import test from "node:test";
import { createEquipmentDeck } from "../shared/equipment.js";
import type { EquipmentKind, GamePhase, GameState } from "../shared/types.js";
import {
  applyGameAction,
  createGame,
  getWaitingPlayerId,
} from "../server/game.js";
import { nextPracticeAction } from "../server/practiceBot.js";

function fresh(count = 4, seed = 712837, reactionMs = 0): GameState {
  return createGame(
    Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      name: `练习玩家${index + 1}`,
      avatar: "🐱",
    })),
    {
      random: () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      },
      reactionMs,
    },
  );
}

function give(game: GameState, id: string, kind: EquipmentKind): string {
  const card = createEquipmentDeck().find((item) => item.kind === kind)!;
  game.equipmentDeck = game.equipmentDeck.filter((item) => item.kind !== kind);
  for (const player of game.players)
    player.equipment = player.equipment.filter((item) => item.kind !== kind);
  const target = game.players.find((player) => player.id === id)!;
  game.equipmentDeck.push(...target.equipment);
  target.equipment = [card];
  return card.id;
}

function arm(game: GameState, id: string, targetId: string | null = null) {
  const player = game.players.find((item) => item.id === id)!;
  if (!player.armed) game.gunSupply -= 1;
  player.armed = true;
  player.aimingAt = targetId;
}

function decision(game: GameState) {
  const before = structuredClone(game);
  const result = nextPracticeAction(game);
  assert.deepEqual(
    game,
    before,
    "choosing a practice action must not mutate state",
  );
  return result;
}

function step(game: GameState): GameState {
  const next = decision(game);
  assert.ok(next, `expected a practice action in ${game.phase}`);
  assert.equal(next.playerId, getWaitingPlayerId(game));
  return applyGameAction(game, next.playerId, next.action);
}

test("practice arms using the first hidden slot, or no reveal cost when fully public", () => {
  for (const allPublic of [false, true]) {
    const game = fresh();
    const actor = game.players.find(
      (player) => player.id === game.currentPlayerId,
    )!;
    actor.cards[0]!.revealed = true;
    if (allPublic) actor.cards.forEach((card) => (card.revealed = true));
    assert.deepEqual(decision(game), {
      playerId: actor.id,
      action: allPublic ? { type: "arm" } : { type: "arm", revealIndex: 1 },
    });
    const next = step(game);
    assert.equal(next.phase, "aim");
    assert.equal(next.gunSupply, game.gunSupply - 1);
  }
});

test("practice shoots an existing live target before taking other normal actions", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p0", "p1");
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "shoot" },
  });
  assert.equal(step(game).phase, "reaction");
});

test("invalid targets and the Taser restriction require a normal action before aiming", () => {
  for (const targetId of [null, "p0", "p1", "missing"]) {
    const game = fresh();
    game.currentPlayerId = "p0";
    game.players[1]!.alive = false;
    arm(game, "p0", targetId);
    const next = decision(game)!;
    assert.deepEqual(next.action, {
      type: "investigate",
      targetId: "p2",
      cardIndex: 0,
    });
    assert.equal(step(game).phase, "aim");
  }
  const game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p0", "p1");
  game.cannotShootTurn = game.turn;
  assert.equal(decision(game)!.action.type, "investigate");
  const aiming = step(game);
  assert.equal(aiming.phase, "aim");
  assert.deepEqual(decision(aiming), {
    playerId: "p0",
    action: { type: "endTurn" },
  });
  assert.equal(step(aiming).turn, game.turn + 1);
});

test("practice aims at a living opponent and preserves an already valid aim", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  game.phase = "aim";
  game.players[1]!.alive = false;
  arm(game, "p0", "p1");
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "aim", targetId: "p2" },
  });
  const next = step(game);
  assert.equal(next.players[0]!.aimingAt, "p2");
  assert.notEqual(next.currentPlayerId, "p0");
  game.players[0]!.aimingAt = "p3";
  assert.equal(decision(game)!.action.type, "endTurn");
  assert.equal(step(game).players[0]!.aimingAt, "p3");
});

test("with no public gun, practice investigates the first legal opponent and hidden slot", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p1");
  arm(game, "p2");
  game.players[1]!.cards.forEach((card) => (card.revealed = true));
  game.players[2]!.cards[0]!.revealed = true;
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "investigate", targetId: "p2", cardIndex: 1 },
  });
  assert.notEqual(step(game).currentPlayerId, "p0");
});

test("practice draws equipment when opponents are public and does not draw from an empty deck", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p1");
  arm(game, "p2");
  game.players
    .slice(1)
    .forEach((player) =>
      player.cards.forEach((card) => (card.revealed = true)),
    );
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "equip", revealIndex: 0 },
  });
  assert.equal(step(game).phase, "equipment");
  game.equipmentDeck = [];
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "skip" },
  });
  const skipped = step(game);
  assert.equal(skipped.turn, game.turn + 1);
  assert.notEqual(skipped.currentPlayerId, "p0");
});

test("a wounded leader chooses the first equipment card even when someone else owns the turn", () => {
  let game = fresh();
  const leader = game.players.find((player) =>
    player.cards.some((card) => card.value === "agent"),
  )!;
  const shooter = game.players.find((player) => player.id !== leader.id)!;
  game.currentPlayerId = shooter.id;
  arm(game, shooter.id, leader.id);
  game = applyGameAction(game, shooter.id, { type: "shoot" });
  game = applyGameAction(game, "", { type: "resolveShot" });
  assert.equal(game.phase, "equipment");
  assert.notEqual(getWaitingPlayerId(game), game.currentPlayerId);
  const cardId = game.equipmentChoices!.cards[0]!.id;
  assert.deepEqual(decision(game), {
    playerId: leader.id,
    action: { type: "chooseEquipment", cardId },
  });
  const next = step(game);
  assert.equal(next.equipmentChoices, undefined);
  assert.deepEqual(
    next.players
      .find((player) => player.id === leader.id)!
      .equipment.map((card) => card.id),
    [cardId],
  );
});

test("practice reveals the first hidden slot for the pending player, not the turn owner", () => {
  let game = fresh();
  game.currentPlayerId = "p0";
  game.players[1]!.cards[0]!.revealed = true;
  const cardId = give(game, "p0", "truthSerum");
  game = applyGameAction(game, "p0", {
    type: "useEquipment",
    cardId,
    targetId: "p1",
  });
  assert.equal(game.phase, "reveal");
  assert.deepEqual(decision(game), {
    playerId: "p1",
    action: { type: "chooseReveal", cardIndex: 1 },
  });
  const next = step(game);
  assert.equal(next.players[1]!.cards[1]!.revealed, true);
  assert.equal(next.phase, "action");
  assert.equal(next.currentPlayerId, "p0");
});

test("practice completes every pending Metal Detector choice as its equipment user", () => {
  let game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p1");
  arm(game, "p3");
  game.players[1]!.cards[0]!.revealed = true;
  const cardId = give(game, "p2", "metalDetector");
  game = applyGameAction(game, "p2", { type: "useEquipment", cardId });
  assert.equal(game.phase, "investigation");
  assert.deepEqual(decision(game), {
    playerId: "p2",
    action: { type: "chooseInvestigation", targetId: "p1", cardIndex: 1 },
  });
  game = step(game);
  assert.deepEqual(decision(game), {
    playerId: "p2",
    action: { type: "chooseInvestigation", targetId: "p3", cardIndex: 0 },
  });
  game = step(game);
  assert.equal(game.phase, "action");
  assert.equal(game.currentPlayerId, "p0");
  assert.equal(game.pendingInvestigations, undefined);
});

test("practice redirects away from the shooter, old target and eliminated players", () => {
  let game = fresh();
  game.currentPlayerId = "p0";
  game.players[2]!.alive = false;
  arm(game, "p0", "p1");
  const cardId = give(game, "p1", "restrainingOrder");
  game = applyGameAction(game, "p0", { type: "shoot" });
  game = applyGameAction(game, "p1", { type: "useEquipment", cardId });
  assert.equal(game.phase, "redirect");
  assert.deepEqual(decision(game), {
    playerId: "p0",
    action: { type: "aim", targetId: "p3" },
  });
  const next = step(game);
  assert.equal(next.phase, "reaction");
  assert.equal(next.pendingShot!.targetId, "p3");
});

test("practice never resolves reaction windows and returns no action after a game ends", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5000 });
  let game = fresh(4, 712837, 6000);
  game.currentPlayerId = "p0";
  arm(game, "p0", "p1");
  game = applyGameAction(game, "p0", { type: "shoot" });
  assert.equal(decision(game), null);
  t.mock.timers.tick(5999);
  assert.equal(decision(game), null);
  t.mock.timers.tick(1);
  assert.equal(
    decision(game),
    null,
    "the room timer, not the bot, resolves at the deadline",
  );
  t.mock.timers.tick(5000);
  assert.equal(decision(game), null);
  game.status = "finished";
  game.phase = "action";
  assert.equal(decision(game), null);
});

test("missing or eliminated waiting players yield no illegal practice action", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  game.players[0]!.alive = false;
  assert.equal(decision(game), null);
  game.currentPlayerId = "missing";
  assert.equal(decision(game), null);
});

test("practice decisions never read an opponent's hidden identity value", () => {
  const game = fresh();
  game.currentPlayerId = "p0";
  arm(game, "p1");
  arm(game, "p2");
  for (const opponent of game.players.slice(1)) {
    for (const card of opponent.cards) {
      Object.defineProperty(card, "value", {
        get() {
          throw new Error("practice read an opponent's hidden identity");
        },
      });
    }
  }
  assert.deepEqual(nextPracticeAction(game), {
    playerId: "p0",
    action: { type: "investigate", targetId: "p1", cardIndex: 0 },
  });
});

test("100 seeded 4–8 player practice games reach a winner within 250 engine steps", (t) => {
  const limit = 250;
  let maximumSteps = 0;
  const phases = new Set<GamePhase>();
  for (let count = 4; count <= 8; count += 1) {
    for (let seed = 1; seed <= 20; seed += 1) {
      let game = fresh(count, seed * 7919);
      let steps = 0;
      while (game.status === "playing" && steps < limit) {
        phases.add(game.phase);
        if (game.phase === "reaction") {
          assert.equal(decision(game), null);
          assert.ok(game.pendingShot!.deadline <= Date.now());
          game = applyGameAction(game, "", { type: "resolveShot" });
        } else {
          game = step(game);
        }
        steps += 1;
      }
      assert.equal(
        game.status,
        "finished",
        `${count} players, seed ${seed}: exceeded ${limit} steps`,
      );
      assert.ok(game.winner);
      assert.equal(decision(game), null);
      maximumSteps = Math.max(maximumSteps, steps);
    }
  }
  for (const phase of ["action", "aim", "reaction", "equipment"] as const)
    assert.ok(phases.has(phase), `full games should exercise ${phase}`);
  t.diagnostic(
    `100 games completed; maximum ${maximumSteps}/${limit} engine steps (including shot settlements).`,
  );
});
