import { gameView, getWaitingPlayerId } from "./game.js";
import type { GameAction, GameState } from "../shared/types.js";

/** A deterministic practice opponent, not an identity-guessing strategy. */
export function nextPracticeAction(
  game: GameState,
): { playerId: string; action: GameAction } | null {
  // Only the room's deadline handler may resolve a shot, including in step mode.
  if (game.status !== "playing" || game.phase === "reaction") return null;

  const playerId = getWaitingPlayerId(game);
  if (!game.players.some((player) => player.id === playerId && player.alive))
    return null;

  const view = gameView(game, playerId);
  const actor = view.players.find((player) => player.id === playerId)!;
  const others = view.players.filter(
    (player) => player.alive && player.id !== playerId,
  );
  const emit = (action: GameAction) => ({ playerId, action });
  const hiddenIndex = actor.cards.findIndex((card) => !card.revealed);
  const revealCost = hiddenIndex >= 0 ? { revealIndex: hiddenIndex } : {};

  switch (view.phase) {
    case "equipment": {
      const first = view.me.equipmentChoices?.[0];
      return first ? emit({ type: "chooseEquipment", cardId: first.id }) : null;
    }
    case "reveal":
      return hiddenIndex >= 0
        ? emit({ type: "chooseReveal", cardIndex: hiddenIndex })
        : null;
    case "investigation": {
      for (const id of view.me.investigationTargets ?? []) {
        const target = others.find((player) => player.id === id);
        const cardIndex =
          target?.cards.findIndex((card) => !card.revealed) ?? -1;
        if (target && cardIndex >= 0)
          return emit({
            type: "chooseInvestigation",
            targetId: target.id,
            cardIndex,
          });
      }
      return null;
    }
    case "redirect": {
      const shot = view.pendingShot;
      if (!shot || shot.shooterId !== playerId) return null;
      const target = others.find((player) => player.id !== shot.targetId);
      return target ? emit({ type: "aim", targetId: target.id }) : null;
    }
    case "aim": {
      if (!actor.armed) return null;
      if (others.some((player) => player.id === actor.aimingAt))
        return emit({ type: "endTurn" });
      return others[0] ? emit({ type: "aim", targetId: others[0].id }) : null;
    }
    case "action": {
      // These two metadata checks concern action legality, never deck/card values.
      if (
        actor.armed &&
        game.cannotShootTurn !== view.turn &&
        others.some((player) => player.id === actor.aimingAt)
      )
        return emit({ type: "shoot" });

      if (!actor.armed && view.gunSupply > 0)
        return emit({ type: "arm", ...revealCost });

      for (const target of others) {
        const cardIndex = target.cards.findIndex((card) => !card.revealed);
        if (cardIndex >= 0)
          return emit({ type: "investigate", targetId: target.id, cardIndex });
      }
      if (game.equipmentDeck.length > 0)
        return emit({ type: "equip", ...revealCost });

      // A depleted deck plus fully public identities leaves no normal action.
      // Use the engine's skip path only for this practice-only stalemate.
      return emit({ type: "skip" });
    }
    default:
      return null;
  }
}
