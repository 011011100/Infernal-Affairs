export interface InvestigationSnapshot {
  syncEpoch: number;
  id?: string;
  tailId?: string;
}

export interface InvestigationCueState {
  seen: InvestigationSnapshot;
  cue: InvestigationSnapshot | null;
}

/** A restored snapshot is a baseline, including investigations missed offline. */
export function investigationBaseline(
  snapshot: InvestigationSnapshot,
): InvestigationCueState {
  return { seen: snapshot, cue: null };
}

export function receiveInvestigationSnapshot(
  previous: InvestigationCueState,
  snapshot: InvestigationSnapshot,
): InvestigationCueState {
  if (previous.seen.syncEpoch !== snapshot.syncEpoch) {
    return investigationBaseline(snapshot);
  }
  if (
    previous.seen.id === snapshot.id &&
    previous.seen.tailId === snapshot.tailId
  ) {
    return previous;
  }
  return {
    seen: snapshot,
    cue: snapshot.id && snapshot.id !== previous.seen.id ? snapshot : null,
  };
}

/** Check during render so a new epoch/action cannot flash an old cue for a frame. */
export function isInvestigationCueActive(
  state: InvestigationCueState,
  snapshot: InvestigationSnapshot,
): boolean {
  return !!(
    state.cue?.id &&
    state.cue.syncEpoch === snapshot.syncEpoch &&
    state.cue.id === snapshot.id &&
    state.cue.tailId === snapshot.tailId
  );
}
