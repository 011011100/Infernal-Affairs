import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { createApp } from "../server/app.js";
import { getWaitingPlayerId } from "../server/game.js";
import type { RoomView, Session } from "../shared/room.js";

type Created = Session & { room: RoomView };
async function fixture(t: TestContext, dbPath = ":memory:") {
  const { app, service } = await createApp({
    dbPath,
    logger: false,
    tick: false,
  });
  const sockets: WebSocket[] = [];
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await Promise.all(
      sockets
        .filter((s) => s.readyState !== WebSocket.CLOSED)
        .map(async (s) => {
          const done = once(s, "close");
          s.close();
          await done;
        }),
    );
    await delay(5);
    await app.close();
  }
  t.after(close);
  const create = async (capacity = 6, practice = true): Promise<Created> => {
    const response = await app.inject({
      method: "POST",
      url: practice ? "/api/practice" : "/api/rooms",
      payload: { name: "独自测试", capacity },
    });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json();
    return { ...data, code: data.room.code };
  };
  const view = async (session: Created) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/rooms/${session.code}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<{ room: RoomView }>().room;
  };
  const request = async (
    session: Created,
    body: Record<string, unknown>,
    revision?: number,
    requestId = randomUUID(),
  ) =>
    app.inject({
      method: "POST",
      url: `/api/rooms/${session.code}/action`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        ...body,
        expectedRevision: revision ?? (await view(session)).revision,
        requestId,
      },
    });
  const action = async (session: Created, body: Record<string, unknown>) => {
    const response = await request(session, body);
    assert.equal(response.statusCode, 200, response.body);
    return response.json<{ room: RoomView }>().room;
  };
  const subscribe = async (session: Created) => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${address.replace(/^http/, "ws")}/ws`);
    sockets.push(socket);
    const messages: Array<{ type: string; room?: RoomView }> = [];
    socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
    await once(socket, "open");
    const first = once(socket, "message");
    socket.send(
      JSON.stringify({
        type: "subscribe",
        code: session.code,
        token: session.token,
      }),
    );
    await first;
    return { socket, messages };
  };
  return { app, service, create, view, request, action, subscribe, close };
}

function assertSelectedPrivacy(room: RoomView, activeId: string) {
  assert.equal(room.game!.me.id, activeId);
  assert.equal(room.practice!.activePlayerId, activeId);
  for (const player of room.players) {
    for (const card of player.cards) {
      if (player.id === activeId || card.revealed || card.known)
        assert.notEqual(card.value, null);
      else
        assert.equal(
          card.value,
          null,
          "unseen identity must remain private in the selected seat view",
        );
    }
  }
  assert.equal(JSON.stringify(room).includes("tokenHash"), false);
  assert.deepEqual(Object.keys(room.practice!).sort(), [
    "activePlayerId",
    "autoplay",
    "gameId",
  ]);
}

test("practice starts a full isolated table for 4–8 seats with one private controller", async (t) => {
  const f = await fixture(t);
  for (const capacity of [4, 5, 6, 7, 8]) {
    const s = await f.create(capacity);
    assert.equal(s.room.status, "playing");
    assert.equal(s.room.players.length, capacity);
    assert.equal(s.room.hostId, s.playerId);
    assert.equal(s.room.practice!.autoplay, true);
    assert.match(s.room.practice!.gameId, /^[0-9a-f-]{36}$/);
    assertSelectedPrivacy(s.room, s.playerId);
    const original = structuredClone(f.service.get(s.code));
    f.service.tick();
    assert.deepEqual(
      f.service.get(s.code),
      original,
      "no controller connection means no automatic actions",
    );
    const joinResponse = await f.app.inject({
      method: "POST",
      url: `/api/rooms/${s.code}/join`,
      payload: { name: "外人" },
    });
    assert.equal(joinResponse.statusCode, 403);
  }
  for (const capacity of [1, 3, 9, "6"]) {
    const response = await f.app.inject({
      method: "POST",
      url: "/api/practice",
      payload: { name: "无效", capacity },
    });
    assert.equal(response.statusCode, 400);
  }
});

test("practice controls cannot target normal rooms or another controller's room", async (t) => {
  const f = await fixture(t);
  const normal = await f.create(4, false);
  const first = await f.create();
  const second = await f.create();
  const before = structuredClone(f.service.get(normal.code));
  for (const body of [
    { type: "practiceSwitch", playerId: normal.playerId },
    { type: "practiceAuto", enabled: true },
    { type: "practiceStep" },
    { type: "practiceReset" },
  ]) {
    assert.equal((await f.request(normal, body)).statusCode, 403);
    assert.deepEqual(f.service.get(normal.code), before);
  }
  for (const s of [
    { ...first, token: second.token },
    { ...first, token: normal.token },
    { ...normal, token: first.token },
  ]) {
    const response = await f.app.inject({
      method: "GET",
      url: `/api/rooms/${s.code}`,
      headers: { authorization: `Bearer ${s.token}` },
    });
    assert.equal(response.statusCode, 401);
  }
  const initial = structuredClone(f.service.get(first.code));
  for (const body of [
    { type: "practiceSwitch", playerId: second.playerId },
    { type: "practiceAuto", enabled: "yes" },
    { type: "ready", ready: true },
    { type: "start" },
    { type: "rematch" },
    { type: "skip" },
    { type: "kick", targetId: first.playerId },
  ]) {
    const response = await f.request(first, body);
    assert.ok(response.statusCode >= 400, response.body);
    assert.deepEqual(f.service.get(first.code), initial);
  }
});

test("switching seats changes HTTP and WebSocket private views and signals act as the selected seat", async (t) => {
  const f = await fixture(t);
  const s = await f.create();
  const peer = await f.subscribe(s);
  await f.action(s, { type: "practiceAuto", enabled: false });
  const target = s.room.players[2].id;
  const switched = await f.action(s, {
    type: "practiceSwitch",
    playerId: target,
  });
  assertSelectedPrivacy(switched, target);
  for (
    let i = 0;
    i < 100 &&
    !peer.messages.some((m) => m.room?.revision === switched.revision);
    i++
  )
    await delay(5);
  assertSelectedPrivacy(
    peer.messages.findLast((m) => m.room?.revision === switched.revision)!
      .room!,
    target,
  );
  const signaled = await f.action(s, {
    type: "emoji",
    reactions: ["seat-3", "card-left", "good"],
  });
  assert.equal(signaled.emojis.at(-1)!.playerId, target);
  const before = structuredClone(f.service.get(s.code));
  const stale = await f.request(
    s,
    { type: "practiceSwitch", playerId: s.playerId },
    switched.revision,
  );
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(f.service.get(s.code), before);
  const waiting = getWaitingPlayerId(before.game!);
  await f.action(s, { type: "practiceSwitch", playerId: waiting });
  const own = await f.view(s);
  const targetPlayer = own.players.find((p) => p.id !== waiting)!;
  const investigated = await f.action(s, {
    type: "investigate",
    targetId: targetPlayer.id,
    cardIndex: 0,
  });
  assert.equal(
    investigated.players.find((p) => p.id === targetPlayer.id)!.cards[0].known,
    true,
  );
  const uninformed = own.players.find(
    (p) => p.id !== waiting && p.id !== targetPlayer.id,
  )!;
  const other = await f.action(s, {
    type: "practiceSwitch",
    playerId: uninformed.id,
  });
  assert.equal(
    other.players.find((p) => p.id === targetPlayer.id)!.cards[0].value,
    null,
  );
});

test("automatic practice pauses on the controlled seat or offline and manual stepping advances exactly once", async (t) => {
  const f = await fixture(t);
  const s = await f.create();
  const peer = await f.subscribe(s);
  const waiting = getWaitingPlayerId(f.service.get(s.code).game!);
  await f.action(s, { type: "practiceSwitch", playerId: waiting });
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(2000);
  const paused = structuredClone(f.service.get(s.code));
  f.service.tick();
  assert.deepEqual(f.service.get(s.code), paused);
  const other = s.room.players.find((p) => p.id !== waiting)!.id;
  await f.action(s, { type: "practiceSwitch", playerId: other });
  t.mock.timers.tick(2000);
  const before = await f.view(s);
  f.service.tick();
  const after = await f.view(s);
  assert.equal(after.revision, before.revision + 1);
  assert.notDeepEqual(after.game, before.game);
  await f.action(s, { type: "practiceAuto", enabled: false });
  const requestId = randomUUID();
  const current = await f.view(s);
  const stepped = await f.request(
    s,
    { type: "practiceStep" },
    current.revision,
    requestId,
  );
  assert.equal(stepped.statusCode, 200, stepped.body);
  const committed = structuredClone(f.service.get(s.code));
  const duplicate = await f.request(
    s,
    { type: "practiceStep" },
    current.revision,
    requestId,
  );
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(f.service.get(s.code), committed);
  await f.action(s, { type: "practiceAuto", enabled: true });
  const ended = once(peer.socket, "close");
  peer.socket.close();
  await ended;
  await delay(5);
  const offline = structuredClone(f.service.get(s.code));
  t.mock.timers.tick(65000);
  f.service.tick();
  assert.deepEqual(
    f.service.get(s.code),
    offline,
    "practice must not run, skip or hand over ownership while offline",
  );
});

test("practice survives SQLite reload, reset is idempotent, and leaving only deletes the test room", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wujian-practice-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "rooms.sqlite");
  const first = await fixture(t, dbPath);
  const s = await first.create();
  const normal = await first.create(4, false);
  await first.action(s, { type: "practiceAuto", enabled: false });
  await first.action(s, {
    type: "practiceSwitch",
    playerId: s.room.players[1].id,
  });
  await first.action(s, {
    type: "emoji",
    reactions: ["seat-2", "card-right", "bad"],
  });
  const saved = await first.view(s);
  await first.close();
  const second = await fixture(t, dbPath);
  const restored = await second.view(s);
  assert.deepEqual(restored.practice, saved.practice);
  assert.deepEqual(restored.game, saved.game);
  assert.deepEqual(restored.emojis, saved.emojis);
  const requestId = randomUUID();
  const response = await second.request(
    s,
    { type: "practiceReset" },
    restored.revision,
    requestId,
  );
  assert.equal(response.statusCode, 200, response.body);
  const reset = response.json<{ room: RoomView }>().room;
  assert.equal(reset.status, "playing");
  assert.equal(reset.game!.turn, 1);
  assert.notEqual(reset.practice!.gameId, restored.practice!.gameId);
  assert.equal(reset.emojis.length, 0);
  assertSelectedPrivacy(reset, s.playerId);
  assert.ok(reset.players.every((p) => p.alive && !p.armed && !p.wounded));
  const committed = structuredClone(second.service.get(s.code));
  assert.equal(
    (
      await second.request(
        s,
        { type: "practiceReset" },
        restored.revision,
        requestId,
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(second.service.get(s.code), committed);
  const left = await second.request(s, { type: "leave" }, restored.revision);
  assert.equal(
    left.statusCode,
    200,
    "leaving a private test room must tolerate an automatic revision change",
  );
  assert.throws(() => second.service.get(s.code), /不存在/);
  assert.equal((await second.view(normal)).status, "waiting");
});
