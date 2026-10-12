import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";

const origin = process.argv[2];
if (!origin)
  throw new Error(
    "Usage: node scripts/smoke-practice.mjs https://your-game.example",
  );
let session;
let socket;
let socketRoom;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body, token = session?.token) {
  const response = await fetch(new URL(path, origin), {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function view() {
  const result = await api(`/api/rooms/${session.code}`);
  assert.equal(result.status, 200);
  return result.data.room;
}
async function action(body) {
  const requestId = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const room = await view();
    const result = await api(`/api/rooms/${session.code}/action`, {
      ...body,
      expectedRevision: room.revision,
      requestId,
    });
    if (result.status === 409) continue;
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.room;
  }
  assert.fail("Practice actions could not synchronize");
}
async function waitFor(check, description) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (check()) return;
    await pause(50);
  }
  assert.fail(description);
}
try {
  const entry = await fetch(new URL("/test", origin), {
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(entry.status, 200);
  const created = await api("/api/practice", {
    name: "单人入口验收",
    capacity: 6,
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  session = {
    code: created.data.room.code,
    token: created.data.token,
    playerId: created.data.playerId,
  };
  assert.equal(created.data.room.status, "playing");
  assert.equal(created.data.room.players.length, 6);
  await action({ type: "practiceAuto", enabled: false });
  socket = new WebSocket(new URL("/ws", origin).href.replace(/^http/, "ws"));
  socket.on("message", (raw) => {
    const data = JSON.parse(String(raw));
    if (data.type === "room") socketRoom = data.room;
  });
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "subscribe", ...session }));
  await waitFor(() => socketRoom, "authenticated practice websocket");
  const target = socketRoom.players[2].id;
  const switched = await action({ type: "practiceSwitch", playerId: target });
  assert.equal(switched.game.me.id, target);
  await waitFor(
    () => socketRoom.revision >= switched.revision,
    "selected view websocket",
  );
  assert.equal(socketRoom.game.me.id, target);
  for (const player of switched.players)
    for (const card of player.cards)
      assert.equal(
        card.value !== null,
        player.id === target,
        "switching must show only the selected player's private cards",
      );
  const signaled = await action({
    type: "emoji",
    reactions: ["seat-3", "card-left", "good"],
  });
  assert.equal(signaled.emojis.at(-1).playerId, target);
  assert.deepEqual(signaled.emojis.at(-1).reactions, [
    "seat-3",
    "card-left",
    "good",
  ]);
  const waiting = signaled.waitingPlayerId;
  const current = await action({ type: "practiceSwitch", playerId: waiting });
  const other = current.players.find((player) => player.id !== waiting);
  const investigated = await action({
    type: "investigate",
    targetId: other.id,
    cardIndex: 0,
  });
  assert.notEqual(
    investigated.players.find((player) => player.id === other.id).cards[0]
      .value,
    null,
  );
  const uninformed = current.players.find(
    (player) => player.id !== waiting && player.id !== other.id,
  );
  const privateView = await action({
    type: "practiceSwitch",
    playerId: uninformed.id,
  });
  assert.equal(
    privateView.players.find((player) => player.id === other.id).cards[0].value,
    null,
  );
  const beforeStep = await view();
  const stepped = await action({ type: "practiceStep" });
  assert.equal(stepped.revision, beforeStep.revision + 1);
  assert.notDeepEqual(stepped.game, beforeStep.game);
  // Restart before checking automatic play so no pending shot can affect timing.
  let reset = await action({ type: "practiceReset" });
  assert.notEqual(reset.practice.gameId, stepped.practice.gameId);
  assert.equal(reset.game.turn, 1);
  assert.equal(reset.emojis.length, 0);
  assert.equal(reset.game.me.id, session.playerId);
  const passive = reset.players.find(
    (player) => player.id !== reset.waitingPlayerId,
  ).id;
  await action({ type: "practiceSwitch", playerId: passive });
  const automatic = await action({ type: "practiceAuto", enabled: true });
  await waitFor(
    () => socketRoom.revision > automatic.revision,
    "automatic practice must advance other players",
  );
  assert.equal(socketRoom.practice.activePlayerId, passive);
  assert.equal(socketRoom.game.me.id, passive);
  await action({ type: "practiceAuto", enabled: false });
  assert.equal(
    (await api(`/api/rooms/${session.code}/join`, { name: "外部加入" }, ""))
      .status,
    403,
  );
  assert.equal(
    (await api(`/api/rooms/${session.code}`, null, "forged-token")).status,
    401,
  );
  console.log(
    JSON.stringify({
      origin,
      singlePlayerEntry: true,
      players: 6,
      authenticatedWebSocket: true,
      seatSwitch: true,
      identityPrivacy: true,
      combinedSignals: true,
      manualStep: true,
      automaticOpponents: true,
      reset: true,
      privateRoom: true,
    }),
  );
} finally {
  if (session) {
    try {
      await action({ type: "leave" });
      const gone = await api(`/api/rooms/${session.code}`);
      assert.equal(gone.status, 404);
    } finally {
      socket?.close();
    }
  } else socket?.close();
}
