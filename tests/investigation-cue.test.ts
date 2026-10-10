import assert from "node:assert/strict";
import test from "node:test";
import { applyGameAction, createGame } from "../server/game.js";
import { createEquipmentDeck } from "../shared/equipment.js";
import type { GameState } from "../shared/types.js";
import {
  investigationBaseline,
  isInvestigationCueActive,
  receiveInvestigationSnapshot,
} from "../src/investigationCue.js";

function fresh(): GameState {
  let seed = 712837;
  return createGame(
    Array.from({ length: 4 }, (_, index) => ({
      id: `p${index}`,
      name: `玩家${index}`,
      avatar: "🐱",
    })),
    {
      random: () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      },
      now: 1000,
    },
  );
}

function snapshot(game: GameState, syncEpoch: number) {
  return {
    syncEpoch,
    id: game.logs.filter((entry) => entry.investigations?.length).at(-1)?.id,
    tailId: game.logs.at(-1)?.id,
  };
}

function investigate(game: GameState): GameState {
  const target = game.players.find(
    (player) => player.id !== game.currentPlayerId,
  )!;
  return applyGameAction(game, game.currentPlayerId, {
    type: "investigate",
    targetId: target.id,
    cardIndex: target.cards.findIndex((card) => !card.revealed),
  });
}

test("recovery after a missed investigation and card exchange establishes a baseline without replay", () => {
  let game = fresh();
  const stateBeforeDisconnect = investigationBaseline(snapshot(game, 1));
  const target = game.players.find(
    (player) => player.id !== game.currentPlayerId,
  )!;
  const otherTarget = game.players.find((player) => player.id !== target.id)!;
  const index = target.cards.findIndex((card) =>
    ["honest", "crooked"].includes(card.value),
  );
  const otherIndex = otherTarget.cards.findIndex((card) =>
    ["honest", "crooked"].includes(card.value),
  );
  const investigatedCardId = target.cards[index].id;
  game = applyGameAction(game, game.currentPlayerId, {
    type: "investigate",
    targetId: target.id,
    cardIndex: index,
  });
  const blackmailer = game.players.find(
    (player) => ![target.id, otherTarget.id].includes(player.id),
  )!;
  const blackmail = createEquipmentDeck().find(
    (equipment) => equipment.kind === "blackmail",
  )!;
  blackmailer.equipment = [blackmail];
  game = applyGameAction(game, blackmailer.id, {
    type: "useEquipment",
    cardId: blackmail.id,
    targetId: target.id,
    cardIndex: index,
    otherTargetId: otherTarget.id,
    otherCardIndex: otherIndex,
  });
  assert.notEqual(
    game.players.find((player) => player.id === target.id)!.cards[index].id,
    investigatedCardId,
    "the old investigated position now contains a different identity",
  );

  const restored = snapshot(game, 2);
  assert.ok(
    restored.id,
    "the restored history retains the missed investigation",
  );
  assert.notEqual(restored.id, restored.tailId, "the exchange happened later");
  assert.equal(
    isInvestigationCueActive(stateBeforeDisconnect, restored),
    false,
  );
  const resumed = receiveInvestigationSnapshot(stateBeforeDisconnect, restored);
  assert.equal(resumed.cue, null);
  assert.equal(isInvestigationCueActive(resumed, restored), false);
  assert.equal(resumed.seen.id, restored.id);
});

test("a new live investigation after recovery highlights normally; its duplicate does not restart the cue", () => {
  const recoveredGame = investigate(fresh());
  const restored = snapshot(recoveredGame, 2);
  const baseline = investigationBaseline(restored);
  const live = snapshot(investigate(recoveredGame), 2);
  const highlighted = receiveInvestigationSnapshot(baseline, live);
  assert.notEqual(live.id, restored.id);
  assert.equal(isInvestigationCueActive(highlighted, live), true);
  assert.equal(receiveInvestigationSnapshot(highlighted, live), highlighted);
});

test("a later action or recovery invalidates an active cue before the state effect runs", () => {
  const initial = fresh();
  const game = investigate(initial);
  const live = snapshot(game, 3);
  const highlighted = receiveInvestigationSnapshot(
    investigationBaseline(snapshot(initial, 3)),
    live,
  );
  assert.equal(isInvestigationCueActive(highlighted, live), true);

  const afterAction = snapshot(
    applyGameAction(game, game.currentPlayerId, {
      type: "arm",
      revealIndex: 0,
    }),
    3,
  );
  assert.equal(afterAction.id, live.id);
  assert.notEqual(afterAction.tailId, live.tailId);
  assert.equal(isInvestigationCueActive(highlighted, afterAction), false);
  assert.equal(
    receiveInvestigationSnapshot(highlighted, afterAction).cue,
    null,
  );

  // Even an identical log snapshot must not carry the old cue into a new epoch.
  const restored = { ...live, syncEpoch: 4 };
  assert.equal(isInvestigationCueActive(highlighted, restored), false);
  assert.equal(receiveInvestigationSnapshot(highlighted, restored).cue, null);
});
