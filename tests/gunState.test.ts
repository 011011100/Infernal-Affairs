import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileGunSlots,
  type GunPlayer,
  type GunSlot,
} from "../src/gunState.js";

function player(
  id: string,
  armed = false,
  aimingAt: string | null = null,
  alive = true,
): GunPlayer {
  return { id, armed, aimingAt, alive };
}

test("initial snapshots create the room's two, three, or four stable guns", () => {
  for (const count of [2, 3, 4]) {
    const slots = reconcileGunSlots([], [player("a"), player("b")], count);
    assert.deepEqual(
      slots,
      Array.from({ length: count }, (_, index) => ({
        id: `gun-${index}`,
        ownerId: null,
        targetId: null,
      })),
    );
  }
});

test("reconnection reconstructs held guns and the remaining public supply", () => {
  const players = [player("a", true, "b"), player("b"), player("c", true, "a")];
  const restored = reconcileGunSlots([], players, 1);
  assert.deepEqual(restored, [
    { id: "gun-0", ownerId: "a", targetId: "b" },
    { id: "gun-1", ownerId: "c", targetId: "a" },
    { id: "gun-2", ownerId: null, targetId: null },
  ]);
  const duplicate = reconcileGunSlots(restored, players, 1);
  duplicate.forEach((slot, index) => assert.equal(slot, restored[index]));
});

test("holders keep their gun objects when player order changes or someone else takes a gun", () => {
  const players = [player("a", true, "b"), player("b", true, "c"), player("c")];
  const before = reconcileGunSlots([], players, 2);
  const next = reconcileGunSlots(
    before,
    [player("c", true, "a"), players[1], players[0]],
    1,
  );
  assert.equal(next[0], before[0]);
  assert.equal(next[1], before[1]);
  assert.deepEqual(next[2], { id: "gun-2", ownerId: "c", targetId: "a" });
  assert.equal(next[3], before[3]);
});

test("a returned gun clears its aim and becomes available for a later draw", () => {
  const before = reconcileGunSlots(
    [],
    [player("a", true, "b"), player("b")],
    1,
  );
  const returned = reconcileGunSlots(before, [player("a"), player("b")], 2);
  assert.deepEqual(returned[0], { id: "gun-0", ownerId: null, targetId: null });
  assert.equal(returned[1], before[1]);

  const drawn = reconcileGunSlots(
    returned,
    [player("a"), player("b", true, "a")],
    1,
  );
  assert.deepEqual(drawn[0], { id: "gun-0", ownerId: "b", targetId: "a" });
  assert.equal(drawn[1], returned[1]);
});

test("same-snapshot transfer reuses the released gun ahead of an earlier public gun", () => {
  const before: readonly GunSlot[] = Object.freeze([
    Object.freeze({ id: "gun-0", ownerId: null, targetId: null }),
    Object.freeze({ id: "gun-1", ownerId: "a", targetId: "b" }),
    Object.freeze({ id: "gun-2", ownerId: "b", targetId: "a" }),
  ]);
  const players = Object.freeze([
    Object.freeze(player("a")),
    Object.freeze(player("b", true, "a")),
    Object.freeze(player("c", true, "b")),
  ]);
  const transferred = reconcileGunSlots(before, players, 1);
  assert.equal(transferred[0], before[0]);
  assert.deepEqual(transferred[1], {
    id: "gun-1",
    ownerId: "c",
    targetId: "b",
  });
  assert.equal(transferred[2], before[2]);
  assert.equal(before[1].ownerId, "a", "the previous snapshot is immutable");
});

test("only a changed aim gets a new object; absent, self, and eliminated targets clear", () => {
  const before = reconcileGunSlots(
    [],
    [player("a", true, "b"), player("b"), player("c")],
    1,
  );
  const changed = reconcileGunSlots(
    before,
    [player("a", true, "c"), player("b"), player("c")],
    1,
  );
  assert.deepEqual(changed[0], { id: "gun-0", ownerId: "a", targetId: "c" });
  assert.notEqual(changed[0], before[0]);
  assert.equal(changed[1], before[1]);

  for (const targetId of [null, "missing", "a", "c"]) {
    const next = reconcileGunSlots(
      changed,
      [
        player("a", true, targetId),
        player("b"),
        player("c", false, null, false),
      ],
      1,
    );
    assert.deepEqual(next[0], { id: "gun-0", ownerId: "a", targetId: null });
    assert.equal(next[1], before[1]);
  }
});

test("a removed holder releases their gun and a smaller room keeps every current holder", () => {
  const before: GunSlot[] = [
    { id: "gun-0", ownerId: null, targetId: null },
    { id: "gun-1", ownerId: "removed", targetId: "a" },
    { id: "gun-2", ownerId: null, targetId: null },
    { id: "gun-3", ownerId: "a", targetId: "b" },
  ];
  const smaller = reconcileGunSlots(
    before,
    [player("a", true, "b"), player("b")],
    1,
  );
  assert.deepEqual(
    smaller.map((slot) => slot.id),
    ["gun-0", "gun-3"],
  );
  assert.equal(smaller[1], before[3]);

  const expanded = reconcileGunSlots(
    smaller,
    [player("a", true, "b"), player("b")],
    3,
  );
  assert.equal(expanded.length, 4);
  assert.equal(new Set(expanded.map((slot) => slot.id)).size, 4);
  assert.equal(expanded[1], before[3]);
  assert.equal(expanded.filter((slot) => slot.ownerId === null).length, 3);
});
