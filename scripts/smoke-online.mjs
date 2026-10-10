import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";

const origin = process.argv[2];
if (!origin)
  throw new Error(
    "Usage: node scripts/smoke-online.mjs https://your-game.example",
  );
const sessions = [];
const sockets = [];
const socketViews = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body, token) {
  const response = await fetch(new URL(path, origin), {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
const getView = async (s) =>
  (await api(`/api/rooms/${s.code}`, null, s.token)).room;
async function action(s, payload) {
  const room = await getView(s);
  return (
    await api(
      `/api/rooms/${s.code}/action`,
      { ...payload, expectedRevision: room.revision, requestId: randomUUID() },
      s.token,
    )
  ).room;
}
try {
  assert.equal((await api("/api/health")).ok, true);
  for (let i = 0; i < 4; i++) {
    const result = await api(
      i ? `/api/rooms/${sessions[0].code}/join` : "/api/rooms",
      {
        name: `联机验收${i + 1}`,
        avatar: ["🦊", "🐺", "🐼", "🐯"][i],
        capacity: 4,
      },
    );
    const session = {
      code: result.room.code,
      token: result.token,
      playerId: result.playerId,
    };
    sessions.push(session);
    const socket = new WebSocket(
      new URL("/ws", origin).href.replace(/^http/, "ws"),
    );
    sockets.push(socket);
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "room")
        socketViews.set(session.playerId, message.room);
    });
    await once(socket, "open");
    const response = once(socket, "message");
    socket.send(JSON.stringify({ type: "subscribe", ...session }));
    const message = JSON.parse(String((await response)[0]));
    assert.equal(message.type, "room");
  }
  for (const session of sessions.slice(1))
    await action(session, { type: "ready", ready: true });
  await action(sessions[0], { type: "start" });
  let leaderId;
  for (const session of sessions) {
    const room = await getView(session);
    assert.equal(room.game.me.id, session.playerId);
    for (const player of room.players) {
      assert.equal(
        player.cards.every((c) =>
          player.id === session.playerId ? c.value !== null : c.value === null,
        ),
        true,
      );
      if (
        player.id === session.playerId &&
        player.cards.some((c) => c.value === "kingpin")
      )
        leaderId = player.id;
    }
    assert.equal(JSON.stringify(room).includes("tokenHash"), false);
  }
  assert.ok(leaderId);
  const initial = await getView(sessions[0]);
  const investigator = sessions.find(
    (s) => s.playerId === initial.game.currentPlayerId,
  );
  const investigationTarget = sessions.find((s) => s !== investigator);
  const investigated = await action(investigator, {
    type: "investigate",
    targetId: investigationTarget.playerId,
    cardIndex: 1,
  });
  const expectedInvestigation = [
    {
      investigatorId: investigator.playerId,
      targetId: investigationTarget.playerId,
      cardIndices: [1],
    },
  ];
  const deliveryDeadline = Date.now() + 10_000;
  while (
    sessions.some(
      (s) =>
        (socketViews.get(s.playerId)?.revision ?? 0) < investigated.revision,
    ) &&
    Date.now() < deliveryDeadline
  )
    await pause(50);
  for (const session of sessions) {
    for (const view of [
      await getView(session),
      socketViews.get(session.playerId),
    ]) {
      const event = view.game.logs
        .filter((entry) => entry.investigations?.length)
        .at(-1);
      assert.deepEqual(event?.investigations, expectedInvestigation);
      const card = view.players.find(
        (p) => p.id === investigationTarget.playerId,
      ).cards[1];
      assert.equal(card.revealed, false);
      const canSeeValue =
        session === investigator || session === investigationTarget;
      assert.equal(
        card.value !== null,
        canSeeValue,
        "public card positions must not disclose the investigated value",
      );
    }
  }
  await action(sessions[1], { type: "emoji", emoji: "👍" });
  assert.equal((await getView(sessions[0])).emojis.at(-1).emoji, "👍");
  let room = await getView(sessions[0]);
  let leaderInjuryVisible = false;
  for (let step = 0; room.status === "playing" && step < 70; step++) {
    const game = room.game;
    if (game.phase === "reaction") {
      await pause(Math.max(100, game.pendingShot.deadline - Date.now() + 700));
      room = await getView(sessions[0]);
      if (
        room.status === "playing" &&
        room.players.find((p) => p.id === leaderId)?.wounded
      ) {
        for (const session of sessions) {
          const injured = (await getView(session)).players.find(
            (p) => p.id === leaderId,
          );
          assert.equal(injured.alive, true);
          assert.equal(injured.wounded, true);
          assert.deepEqual(
            injured.cards.filter((c) => c.wounded).map((c) => c.value),
            ["kingpin"],
          );
        }
        leaderInjuryVisible = true;
      }
      continue;
    }
    if (game.phase === "equipment") {
      for (const session of sessions) {
        const own = await getView(session);
        if (own.game.me.equipmentChoices?.length) {
          room = await action(session, {
            type: "chooseEquipment",
            cardId: own.game.me.equipmentChoices[0].id,
          });
          break;
        }
      }
      continue;
    }
    const current = sessions.find((s) => s.playerId === game.currentPlayerId);
    const self = room.players.find((p) => p.id === current.playerId);
    const target =
      current.playerId === leaderId
        ? room.players.find((p) => p.id !== leaderId && p.alive)
        : room.players.find((p) => p.id === leaderId);
    if (game.phase === "aim")
      room = await action(current, { type: "aim", targetId: target.id });
    else if (
      self.armed &&
      current.playerId !== leaderId &&
      self.aimingAt === leaderId
    )
      room = await action(current, { type: "shoot" });
    else {
      const revealIndex = self.cards.findIndex((c) => !c.revealed);
      const type =
        !self.armed && game.gunSupply > 0 && current.playerId !== leaderId
          ? "arm"
          : "equip";
      room = await action(current, {
        type,
        ...(revealIndex >= 0 ? { revealIndex } : {}),
      });
    }
  }
  assert.equal(room.status, "finished");
  assert.equal(
    leaderInjuryVisible,
    true,
    "all players must receive the first-shot injury marker",
  );
  assert.equal(room.game.winner.team, "honest");
  assert.equal(
    room.players.every((p) => p.cards.every((c) => c.value !== null)),
    true,
  );
  const result = {
    origin,
    players: 4,
    authenticatedWebSockets: true,
    identityPrivacy: true,
    publicInvestigationPositions: true,
    privateInvestigationContent: true,
    emojiDelivery: true,
    leaderInjuryVisible,
    completeGame: true,
    winner: room.game.winner.team,
  };
  for (const session of [...sessions].reverse())
    await action(session, { type: "leave" });
  console.log(JSON.stringify(result));
} finally {
  for (const socket of sockets) socket.close();
}
