export type GunPlayer = {
  id: string;
  armed: boolean;
  aimingAt: string | null;
  alive: boolean;
};

export type GunSlot = {
  id: string;
  ownerId: string | null;
  targetId: string | null;
};

/** Match anonymous server guns to stable visual objects across snapshots. */
export function reconcileGunSlots(
  previous: readonly GunSlot[],
  players: readonly GunPlayer[],
  gunSupply: number,
): GunSlot[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const armedPlayers = players.filter((player) => player.armed);
  const assignedOwners = new Set<string>();
  const released: number[] = [];
  const available: number[] = [];

  const targetOf = (player: GunPlayer) => {
    const target = player.aimingAt && playersById.get(player.aimingAt);
    return target && target.alive && target.id !== player.id ? target.id : null;
  };
  const update = (
    slot: GunSlot,
    ownerId: string | null,
    targetId: string | null,
  ): GunSlot =>
    slot.ownerId === ownerId && slot.targetId === targetId
      ? slot
      : { id: slot.id, ownerId, targetId };

  const slots = previous.map((slot, index) => {
    const owner = slot.ownerId && playersById.get(slot.ownerId);
    if (owner && owner.armed && !assignedOwners.has(owner.id)) {
      assignedOwners.add(owner.id);
      return update(slot, owner.id, targetOf(owner));
    }
    (slot.ownerId === null ? available : released).push(index);
    return update(slot, null, null);
  });

  const ids = new Set(slots.map((slot) => slot.id));
  let nextId = 0;
  const createSlot = (): GunSlot => {
    while (ids.has(`gun-${nextId}`)) nextId++;
    const id = `gun-${nextId++}`;
    ids.add(id);
    return { id, ownerId: null, targetId: null };
  };

  // A same-snapshot loss and gain (such as Taser) moves the released object
  // directly between players instead of borrowing a different gun from supply.
  const claimable = [...released, ...available];
  for (const player of armedPlayers) {
    if (assignedOwners.has(player.id)) continue;
    const index = claimable.shift();
    const slot = index === undefined ? createSlot() : slots[index];
    const claimed = update(slot, player.id, targetOf(player));
    if (index === undefined) slots.push(claimed);
    else slots[index] = claimed;
    assignedOwners.add(player.id);
  }

  // Player count can change between rooms. Preserve held guns even if their
  // number is above the new supply size; discard only surplus public objects.
  let publicSlots = 0;
  const result = slots.filter((slot) => {
    if (slot.ownerId !== null) return true;
    return publicSlots++ < gunSupply;
  });
  while (result.length < armedPlayers.length + gunSupply) {
    result.push(createSlot());
  }
  return result;
}
