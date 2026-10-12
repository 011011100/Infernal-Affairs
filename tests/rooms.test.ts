import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { createApp } from "../server/app.js";
import type { RoomView } from "../shared/room.js";
import {
  MAX_REACTION_PARTS,
  REACTIONS,
  getEventReactions,
  getReaction,
  isReactionId,
  isReactionSelection,
} from "../shared/reactions.js";
import { createEquipmentDeck } from "../shared/equipment.js";
import type { GameLog } from "../shared/types.js";

type Server = Awaited<ReturnType<typeof createApp>>;
interface Session {
  token: string;
  playerId: string;
  room: RoomView;
}
interface SocketPeer {
  socket: WebSocket;
  messages: Array<{ type: string; room?: RoomView; error?: string }>;
}

async function eventually(
  check: () => boolean | Promise<boolean>,
  description: string,
) {
  const deadline = Date.now() + 2500;
  do {
    if (await check()) return;
    await delay(5);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${description}`);
}

async function fixture(t: TestContext, dbPath = ":memory:") {
  const server = await createApp({
    dbPath,
    logger: false,
    dev: false,
    tick: false,
  });
  let address: string;
  try {
    address = await server.app.listen({ host: "127.0.0.1", port: 0 });
  } catch (error) {
    await server.app.close();
    throw error;
  }
  const peers: SocketPeer[] = [];
  let closed = false;

  async function closePeer(peer: SocketPeer) {
    if (peer.socket.readyState === WebSocket.CLOSED) return;
    const ended = once(peer.socket, "close");
    peer.socket.close();
    const timer = setTimeout(() => peer.socket.terminate(), 1000);
    try {
      await ended;
    } finally {
      clearTimeout(timer);
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    await Promise.all(peers.map(closePeer));
    // Give the server its close callbacks before onClose shuts SQLite down.
    await delay(5);
    await server.app.close();
  }
  t.after(close);

  async function subscribe(session: Session) {
    const socket = new WebSocket(`${address.replace(/^http/, "ws")}/ws`);
    const peer: SocketPeer = { socket, messages: [] };
    peers.push(peer);
    socket.on("message", (data) =>
      peer.messages.push(JSON.parse(data.toString())),
    );
    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "subscribe",
        code: session.room.code,
        token: session.token,
      }),
    );
    await eventually(
      () =>
        peer.messages.some(
          (message) =>
            message.type === "room" &&
            message.room?.players.some(
              (player) => player.id === session.playerId && player.connected,
            ),
        ),
      "authenticated websocket subscription",
    );
    return peer;
  }

  async function create(capacity = 4, name = "房主"): Promise<Session> {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { name, capacity },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<Session>();
  }

  async function add(host: Session, name: string): Promise<Session> {
    const response = await server.app.inject({
      method: "POST",
      url: `/api/rooms/${host.room.code}/join`,
      payload: { name },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<Session>();
  }

  async function view(session: Session): Promise<RoomView> {
    const response = await server.app.inject({
      method: "GET",
      url: `/api/rooms/${session.room.code}`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<{ room: RoomView }>().room;
  }

  async function request(
    session: Session,
    payload: Record<string, unknown>,
    expectedRevision?: number,
    requestId = randomUUID(),
  ) {
    const revision = expectedRevision ?? (await view(session)).revision;
    return server.app.inject({
      method: "POST",
      url: `/api/rooms/${session.room.code}/action`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { ...payload, expectedRevision: revision, requestId },
    });
  }

  async function action(
    session: Session,
    payload: Record<string, unknown>,
  ): Promise<RoomView> {
    const response = await request(session, payload);
    assert.equal(response.statusCode, 200, response.body);
    return response.json<{ room: RoomView }>().room;
  }

  async function startGame() {
    const host = await create();
    const sessions = [host];
    for (let i = 1; i < 4; i++) sessions.push(await add(host, `玩家${i}`));
    for (const session of sessions) await subscribe(session);
    for (const session of sessions.slice(1))
      await action(session, { type: "ready", ready: true });
    await action(host, { type: "start" });
    return sessions;
  }

  return {
    ...server,
    address,
    peers,
    create,
    add,
    view,
    request,
    action,
    subscribe,
    closePeer,
    close,
    startGame,
  };
}

async function assertPublicInvestigation(
  f: Awaited<ReturnType<typeof fixture>>,
  sessions: Session[],
  expectedEvent: NonNullable<GameLog["investigations"]>,
  authorizedInvestigations = expectedEvent,
) {
  const raw = f.service.get(sessions[0].room.code).game!;
  const storedEvent = raw.logs.findLast((entry) => entry.investigations)!;
  assert.ok(storedEvent, "successful investigation must have a public event");
  for (const session of sessions) {
    const http = await f.view(session);
    const peer = f.peers[sessions.indexOf(session)];
    await eventually(
      () =>
        peer.messages.some(
          (message) => message.room?.revision === http.revision,
        ),
      "investigation event websocket broadcast",
    );
    const websocket = peer.messages.findLast(
      (message) => message.room?.revision === http.revision,
    )!.room!;
    for (const room of [http, websocket]) {
      const event = room.game!.logs.find(
        (entry) => entry.id === storedEvent.id,
      )!;
      assert.deepEqual(
        event.investigations,
        expectedEvent,
        "all viewers receive the same IDs and slots",
      );
      assert.deepEqual(Object.keys(event).sort(), [
        "at",
        "id",
        "investigations",
        "text",
      ]);
      for (const target of room.players) {
        const rawTarget = raw.players.find(
          (player) => player.id === target.id,
        )!;
        target.cards.forEach((card, index) => {
          const mayKnow =
            target.id === session.playerId ||
            card.revealed ||
            authorizedInvestigations.some(
              (investigation) =>
                investigation.investigatorId === session.playerId &&
                investigation.targetId === target.id &&
                investigation.cardIndices.includes(index),
            );
          assert.equal(
            card.value,
            mayKnow ? rawTarget.cards[index]!.value : null,
            "public investigation events must not grant bystanders card knowledge",
          );
          assert.equal(card.known, mayKnow);
          assert.equal(
            card.revealed,
            false,
            "investigation never reveals the card to the table",
          );
          assert.equal(card.wounded, false);
        });
      }
    }
  }
}

function assertPrivateProjection(
  room: RoomView,
  viewer: Session,
  sessions: Session[],
  server: Server,
) {
  assert.ok(room.game);
  assert.equal(room.game.me.id, viewer.playerId);
  for (const player of room.players) {
    assert.equal(player.cards.length, 3);
    assert.equal(
      "equipment" in player,
      false,
      "other players expose only equipmentCount",
    );
    for (const card of player.cards) {
      if (player.id === viewer.playerId) assert.notEqual(card.value, null);
      else {
        assert.equal(card.value, null);
        assert.equal(card.known, false);
      }
    }
  }
  const serialized = JSON.stringify(room);
  for (const session of sessions)
    assert.equal(
      serialized.includes(session.token),
      false,
      "session token leaked",
    );
  const forbidden = new Set([
    "tokenHash",
    "token",
    "equipmentDeck",
    "equipmentDiscard",
    "requests",
    "known",
  ]);
  function scan(value: unknown, path = "") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      // A boolean card.known is the intended projection, unlike the private knowledge map.
      if (key !== "known" || typeof child !== "boolean")
        assert.equal(forbidden.has(key), false, `private field ${path}.${key}`);
      scan(child, `${path}.${key}`);
    }
  }
  scan(room);
  const raw = server.service.rooms.get(room.code)!;
  for (const player of raw.game!.players) {
    for (const card of player.cards)
      assert.equal(
        serialized.includes(JSON.stringify(card.id)),
        false,
        "stable private identity id leaked",
      );
    if (player.id !== viewer.playerId) {
      for (const equipment of player.equipment)
        assert.equal(
          serialized.includes(JSON.stringify(equipment.id)),
          false,
          "another hand leaked",
        );
    }
  }
}

test("room capacity is 4–8 and concurrent joins cannot overfill the final seat", async (t) => {
  for (const capacity of [4, 5, 6, 7, 8]) {
    await t.test(`${capacity} seats`, async (t) => {
      const f = await fixture(t);
      const host = await f.create(capacity);
      for (let i = 1; i < capacity - 1; i++) await f.add(host, `队员${i}`);
      const responses = await Promise.all(
        ["最后甲", "最后乙", "最后丙"].map((name) =>
          f.app.inject({
            method: "POST",
            url: `/api/rooms/${host.room.code}/join`,
            payload: { name },
          }),
        ),
      );
      assert.equal(
        responses.filter((response) => response.statusCode === 200).length,
        1,
      );
      assert.equal(
        responses.filter((response) => response.statusCode === 409).length,
        2,
      );
      const room = await f.view(host);
      assert.equal(room.players.length, capacity);
      assert.equal(room.capacity, capacity);
      assert.equal(
        new Set(room.players.map((player) => player.id)).size,
        capacity,
      );
    });
  }
  await t.test("invalid capacities are rejected", async (t) => {
    const f = await fixture(t);
    for (const capacity of [3, 9, 4.5]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/rooms",
        payload: { name: "房主", capacity },
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(f.service.rooms.size, 0);
  });
});

test("start requires host authority, four players, online connections and readiness", async (t) => {
  const f = await fixture(t);
  const host = await f.create();
  const sessions = [host, await f.add(host, "甲"), await f.add(host, "乙")];
  assert.equal((await f.request(host, { type: "start" })).statusCode, 400);
  sessions.push(await f.add(host, "丙"));
  for (const session of sessions.slice(1))
    await f.action(session, { type: "ready", ready: true });
  assert.equal(
    (await f.request(host, { type: "start" })).statusCode,
    400,
    "offline players must block start",
  );
  for (const session of sessions) await f.subscribe(session);
  assert.equal(
    (await f.request(sessions[1], { type: "start", playerId: host.playerId }))
      .statusCode,
    403,
  );
  await f.action(sessions[1], { type: "ready", ready: false });
  assert.equal(
    (await f.request(host, { type: "start" })).statusCode,
    400,
    "unready player must block start",
  );
  assert.equal((await f.view(host)).game, null);
  await f.action(sessions[1], { type: "ready", ready: true });
  assert.equal((await f.action(host, { type: "start" })).status, "playing");
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/rooms/${host.room.code}/join`,
        payload: { name: "迟到者" },
      })
    ).statusCode,
    409,
  );
});

test("HTTP and websocket reject absent, forged and other-room credentials", async (t) => {
  const f = await fixture(t);
  const host = await f.create();
  const outsider = await f.create(4, "别房房主");
  for (const token of ["", "invalid-token", outsider.token]) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    assert.equal(
      (
        await f.app.inject({
          method: "GET",
          url: `/api/rooms/${host.room.code}`,
          headers,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/rooms/${host.room.code}/action`,
          headers,
          payload: {
            type: "ready",
            ready: false,
            expectedRevision: 1,
            requestId: randomUUID(),
          },
        })
      ).statusCode,
      401,
    );
  }
  const socket = new WebSocket(`${f.address.replace(/^http/, "ws")}/ws`);
  const peer: SocketPeer = { socket, messages: [] };
  f.peers.push(peer);
  socket.on("message", (data) =>
    peer.messages.push(JSON.parse(data.toString())),
  );
  const closed = once(socket, "close");
  await once(socket, "open");
  socket.send(
    JSON.stringify({
      type: "subscribe",
      code: host.room.code,
      token: outsider.token,
    }),
  );
  const [code] = await closed;
  assert.equal(code, 1008);
  assert.equal(
    peer.messages.some((message) => message.type === "error"),
    true,
  );
  assert.equal(
    peer.messages.some((message) => message.type === "room"),
    false,
  );
  assert.equal((await f.view(host)).players[0].connected, false);
});

test("HTTP and websocket game projections disclose only the viewer’s own hand", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  for (const session of sessions) {
    const room = await f.view(session);
    assertPrivateProjection(room, session, sessions, f);
    const peer = f.peers[sessions.indexOf(session)];
    await eventually(
      () => peer.messages.some((message) => message.room?.status === "playing"),
      "started game broadcast",
    );
    const broadcast = peer.messages.findLast(
      (message) => message.room?.status === "playing",
    )!.room!;
    assertPrivateProjection(broadcast, session, sessions, f);
    assert.deepEqual(broadcast.game!.me.equipment, room.game!.me.equipment);
  }
  const initial = await f.view(sessions[0]);
  const investigator = sessions.find(
    (session) => session.playerId === initial.game!.currentPlayerId,
  )!;
  const target = sessions.find(
    (session) => session.playerId !== investigator.playerId,
  )!;
  const investigated = await f.action(investigator, {
    type: "investigate",
    targetId: target.playerId,
    cardIndex: 1,
  });
  const discovered = investigated.players.find(
    (player) => player.id === target.playerId,
  )!.cards[1];
  assert.equal(discovered.known, true);
  assert.notEqual(discovered.value, null);
  assert.equal(
    discovered.revealed,
    false,
    "a private investigation must not publicly reveal the card",
  );
  await assertPublicInvestigation(f, sessions, [
    {
      investigatorId: investigator.playerId,
      targetId: target.playerId,
      cardIndices: [1],
    },
  ]);
  const beforeInvalid = await f.view(sessions[0]);
  const next = sessions.find(
    (session) => session.playerId === beforeInvalid.game!.currentPlayerId,
  )!;
  const invalid = await f.request(next, {
    type: "investigate",
    targetId: sessions.find((session) => session !== next)!.playerId,
    cardIndex: 99,
  });
  assert.equal(invalid.statusCode, 400);
  const afterInvalid = await f.view(sessions[0]);
  assert.equal(afterInvalid.revision, beforeInvalid.revision);
  assert.deepEqual(afterInvalid.game!.logs, beforeInvalid.game!.logs);
});

test("equipment investigations publish exact slots over HTTP and websocket without disclosing identities", async (t) => {
  for (const kind of ["wiretap", "polygraph", "metalDetector"] as const) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const sessions = await f.startGame();
      const [actor, first, second] = sessions;
      const raw = f.service.get(actor.room.code).game!;
      const equipment = createEquipmentDeck().find(
        (card) => card.kind === kind,
      )!;
      raw.equipmentDeck = raw.equipmentDeck.filter(
        (card) => card.kind !== kind,
      );
      for (const player of raw.players)
        player.equipment = player.equipment.filter(
          (card) => card.kind !== kind,
        );
      const actorState = raw.players.find(
        (player) => player.id === actor.playerId,
      )!;
      raw.equipmentDeck.push(...actorState.equipment);
      actorState.equipment = [equipment];

      if (kind === "wiretap") {
        const room = await f.action(actor, {
          type: "useEquipment",
          cardId: equipment.id,
          targetId: first.playerId,
          cardIndex: 0,
          otherTargetId: second.playerId,
          otherCardIndex: 2,
        });
        const event = room.game!.logs.findLast(
          (entry) => entry.investigations,
        )!;
        assert.ok(
          event.text.includes("第 1 张") && event.text.includes("第 3 张"),
        );
        await assertPublicInvestigation(f, sessions, [
          {
            investigatorId: actor.playerId,
            targetId: first.playerId,
            cardIndices: [0],
          },
          {
            investigatorId: actor.playerId,
            targetId: second.playerId,
            cardIndices: [2],
          },
        ]);
      } else if (kind === "polygraph") {
        await f.action(actor, {
          type: "useEquipment",
          cardId: equipment.id,
          targetId: first.playerId,
        });
        await assertPublicInvestigation(f, sessions, [
          {
            investigatorId: actor.playerId,
            targetId: first.playerId,
            cardIndices: [0, 1, 2],
          },
          {
            investigatorId: first.playerId,
            targetId: actor.playerId,
            cardIndices: [0, 1, 2],
          },
        ]);
      } else {
        for (const session of [first, second]) {
          raw.players.find((player) => player.id === session.playerId)!.armed =
            true;
          raw.gunSupply -= 1;
        }
        const pending = await f.action(actor, {
          type: "useEquipment",
          cardId: equipment.id,
        });
        assert.equal(
          pending.game!.logs.some((entry) => entry.investigations),
          false,
          "a pending choice is not a completed investigation",
        );
        const firstEvent = [
          {
            investigatorId: actor.playerId,
            targetId: first.playerId,
            cardIndices: [2],
          },
        ];
        const firstResult = await f.action(actor, {
          type: "chooseInvestigation",
          targetId: first.playerId,
          cardIndex: 2,
        });
        assert.ok(
          firstResult
            .game!.logs.findLast((entry) => entry.investigations)!
            .text.includes("第 3 张"),
        );
        await assertPublicInvestigation(f, sessions, firstEvent);
        const secondEvent = [
          {
            investigatorId: actor.playerId,
            targetId: second.playerId,
            cardIndices: [0],
          },
        ];
        await f.action(actor, {
          type: "chooseInvestigation",
          targetId: second.playerId,
          cardIndex: 0,
        });
        await assertPublicInvestigation(f, sessions, secondEvent, [
          ...firstEvent,
          ...secondEvent,
        ]);
        const events = (await f.view(actor)).game!.logs.filter(
          (entry) => entry.investigations,
        );
        assert.equal(
          events.length,
          2,
          "each detector choice creates its own investigation event",
        );
      }
    });
  }
});

test("stale revisions reject atomically and successful request IDs are idempotent per player", async (t) => {
  const f = await fixture(t);
  const host = await f.create();
  const guest = await f.add(host, "来宾");
  const before = await f.view(host);
  const requestId = randomUUID();
  const first = await f.request(
    guest,
    { type: "ready", ready: true },
    before.revision,
    requestId,
  );
  assert.equal(first.statusCode, 200);
  const committed = first.json<{ room: RoomView }>().room;
  assert.equal(committed.revision, before.revision + 1);
  assert.equal(
    (await f.request(host, { type: "ready", ready: false }, before.revision))
      .statusCode,
    409,
  );
  assert.deepEqual(await f.view(host), { ...committed, game: null });
  const repeated = await f.request(
    guest,
    { type: "ready", ready: false },
    before.revision,
    requestId,
  );
  assert.equal(repeated.statusCode, 200);
  assert.equal(
    repeated.json<{ room: RoomView }>().room.revision,
    committed.revision,
  );
  assert.equal(
    (await f.view(guest)).players.find(
      (player) => player.id === guest.playerId,
    )!.ready,
    true,
  );
  // Another member can safely use the same client-generated ID for their own operation.
  assert.equal(
    (
      await f.request(
        host,
        { type: "ready", ready: false },
        committed.revision,
        requestId,
      )
    ).statusCode,
    200,
  );
  assert.equal((await f.view(host)).revision, committed.revision + 1);
});

test("reaction catalog resolves current IDs and legacy display values without accepting legacy sends", () => {
  assert.equal(REACTIONS.length, 25);
  assert.equal(new Set(REACTIONS.map((reaction) => reaction.id)).size, 25);
  for (const reaction of REACTIONS) {
    assert.equal(isReactionId(reaction.id), true);
    assert.equal(getReaction(reaction.id), reaction);
  }
  const legacy = [
    ["👍", "agree"],
    ["👎", "deny"],
    ["🤔", "doubt"],
    ["😂", "laugh"],
    ["🤫", "hush"],
    ["🎯", "lock"],
  ];
  for (const [value, id] of legacy) {
    assert.equal(getReaction(value)?.id, id);
    assert.equal(isReactionId(value), false);
  }
  for (const value of [
    "seat-9",
    "unknown",
    "__proto__",
    "<script>",
    "😱",
    "😎",
  ]) {
    assert.equal(getReaction(value), undefined);
    assert.equal(isReactionId(value), false);
  }
});

test("reaction selections preserve order and invalid saved combinations never display a partial fallback", () => {
  assert.equal(MAX_REACTION_PARTS, 3);
  for (const selection of [
    ["good"],
    ["card-left", "seat-3"],
    ["seat-3", "card-left", "good"],
  ]) {
    const frozen = Object.freeze([...selection]);
    assert.equal(isReactionSelection(frozen), true);
    assert.deepEqual(
      getEventReactions({ emoji: "laugh", reactions: frozen }).map(
        (part) => part.id,
      ),
      selection,
      "the complete ordered selection takes precedence over the legacy field",
    );
  }
  assert.deepEqual(
    getEventReactions({ emoji: "👍" }).map((part) => part.id),
    ["agree"],
  );
  assert.deepEqual(
    getEventReactions({ emoji: "doubt" }).map((part) => part.id),
    ["doubt"],
  );
  assert.deepEqual(getEventReactions({ emoji: "unknown" }), []);
  for (const selection of [
    [],
    ["seat-3", "card-left", "good", "lock"],
    ["good", "good"],
    ["good", "unknown"],
    ["👍"],
    new Array(1),
    null,
    "good",
    { 0: "good", length: 1 },
  ]) {
    assert.equal(isReactionSelection(selection), false);
    assert.deepEqual(
      getEventReactions({ emoji: "good", reactions: selection as string[] }),
      [],
      "a malformed new selection must not fall back to one apparently valid claim",
    );
  }
});

test("a combination is one private-safe HTTP/WebSocket event with one cooldown and idempotent retries", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const actor = sessions[0];
  const initial = structuredClone(f.service.get(actor.room.code));
  const reactions = ["seat-3", "card-left", "good"];
  const requestId = randomUUID();
  const response = await f.request(
    actor,
    { type: "emoji", reactions },
    -1,
    requestId,
  );
  assert.equal(response.statusCode, 200);
  const after = response.json<{ room: RoomView }>().room;
  assert.equal(after.revision, initial.revision + 1);
  assert.equal(after.emojis.length, 1);
  const event = after.emojis[0];
  assert.equal(event.playerId, actor.playerId);
  assert.equal(event.emoji, "seat-3");
  assert.deepEqual(event.reactions, reactions);
  assert.deepEqual(Object.keys(event).sort(), [
    "at",
    "emoji",
    "id",
    "playerId",
    "reactions",
  ]);
  const committed = structuredClone(f.service.get(actor.room.code));
  assert.equal(committed.requests.length, initial.requests.length + 1);
  assert.deepEqual(committed.game, initial.game);

  for (const [index, session] of sessions.entries()) {
    await eventually(
      () =>
        f.peers[index].messages.some(
          (message) => message.room?.revision === after.revision,
        ),
      "one complete combination delivered by websocket",
    );
    const websocket = f.peers[index].messages.findLast(
      (message) => message.room?.revision === after.revision,
    )!.room!;
    for (const room of [await f.view(session), websocket]) {
      assert.deepEqual(room.emojis, [event]);
      assertPrivateProjection(room, session, sessions, f);
    }
  }

  t.mock.timers.enable({ apis: ["Date"], now: event.at });
  t.mock.timers.tick(1999);
  assert.equal(
    (await f.request(actor, { type: "emoji", reactions: ["lock"] })).statusCode,
    429,
  );
  assert.deepEqual(f.service.get(actor.room.code), committed);
  const retry = await f.request(
    actor,
    { type: "emoji", reactions },
    -1,
    requestId,
  );
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json<{ room: RoomView }>().room, after);
  assert.deepEqual(f.service.get(actor.room.code), committed);

  t.mock.timers.tick(1);
  const next = await f.action(actor, { type: "emoji", reactions: ["lock"] });
  assert.equal(next.revision, after.revision + 1);
  assert.equal(next.emojis.length, 2);
  assert.deepEqual(next.emojis[1].reactions, ["lock"]);
  assert.equal(next.emojis[1].at - event.at, 2000);
  assert.deepEqual(f.service.get(actor.room.code).game, initial.game);
});

test("malformed combinations reject atomically even with a valid legacy fallback", async (t) => {
  const f = await fixture(t);
  const host = await f.create();
  const before = structuredClone(f.service.get(host.room.code));
  for (const reactions of [
    [],
    ["seat-3", "card-left", "good", "lock"],
    ["good", "good"],
    ["good", "unknown"],
    ["good", "👍"],
    ["good", null],
    null,
    "good",
    3,
    {},
  ]) {
    const response = await f.request(host, {
      type: "emoji",
      emoji: "good",
      reactions,
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(f.service.get(host.room.code), before);
  }
  const valid = await f.action(host, {
    type: "emoji",
    reactions: ["good", "card-left"],
  });
  assert.equal(
    valid.emojis.length,
    1,
    "rejections never consume the send cooldown",
  );
});

test("seat, role, action and interaction reactions broadcast over HTTP and authenticated WebSockets", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const representatives = ["seat-8", "boss", "cover", "doubt"];
  assert.deepEqual(
    representatives.map((id) => getReaction(id)?.group),
    ["seat", "role", "action", "interaction"],
  );
  let last: RoomView | undefined;
  for (const [index, id] of representatives.entries()) {
    last = await f.action(sessions[index], { type: "emoji", emoji: id });
    assert.equal(last.emojis.at(-1)?.playerId, sessions[index].playerId);
    assert.equal(last.emojis.at(-1)?.emoji, id);
  }
  for (const [index, session] of sessions.entries()) {
    await eventually(
      () =>
        f.peers[index].messages.some(
          (message) => message.room?.revision === last!.revision,
        ),
      "all reaction groups delivered by websocket",
    );
    const websocket = f.peers[index].messages.findLast(
      (message) => message.room?.revision === last!.revision,
    )!.room!;
    for (const room of [await f.view(session), websocket]) {
      assert.deepEqual(room.emojis, last!.emojis);
      assert.deepEqual(
        room.emojis.map((event) => event.emoji),
        representatives,
      );
      assertPrivateProjection(room, session, sessions, f);
    }
  }
});

test("left, middle and right card signals broadcast without revealing or investigating any identity", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const gameBefore = structuredClone(f.service.get(sessions[0].room.code).game);
  const cardSignals = ["card-left", "card-middle", "card-right"];
  assert.deepEqual(
    cardSignals.map((id) => getReaction(id)?.label),
    ["左", "中", "右"],
  );
  for (const id of cardSignals) {
    assert.equal(getReaction(id)?.group, "card");
    assert.equal(getReaction(id)?.tone, "neutral");
  }
  let last: RoomView | undefined;
  for (const [index, id] of cardSignals.entries()) {
    last = await f.action(sessions[index], { type: "emoji", emoji: id });
  }
  assert.deepEqual(f.service.get(sessions[0].room.code).game, gameBefore);
  for (const [index, session] of sessions.entries()) {
    await eventually(
      () =>
        f.peers[index].messages.some(
          (message) => message.room?.revision === last!.revision,
        ),
      "three card-position signals delivered by websocket",
    );
    const websocket = f.peers[index].messages.findLast(
      (message) => message.room?.revision === last!.revision,
    )!.room!;
    for (const room of [await f.view(session), websocket]) {
      assert.deepEqual(room.emojis, last!.emojis);
      assert.deepEqual(
        room.emojis.map((event) => event.emoji),
        cardSignals,
      );
      for (const [eventIndex, event] of room.emojis.entries()) {
        assert.equal(event.playerId, sessions[eventIndex].playerId);
        assert.deepEqual(Object.keys(event).sort(), [
          "at",
          "emoji",
          "id",
          "playerId",
        ]);
      }
      assertPrivateProjection(room, session, sessions, f);
    }
  }
});

test("reaction whitelist and cooldown apply without duplicate events or state changes on rejection", async (t) => {
  const f = await fixture(t);
  const host = await f.create();
  const initial = await f.view(host);
  const rawBefore = structuredClone(f.service.get(host.room.code));
  for (const value of [
    "<script>alert(1)</script>",
    "seat-9",
    "card-up",
    "unknown",
    "__proto__",
    "👍",
    "👎",
    "🤔",
    "😱",
    "😂",
    "😎",
    "🤫",
    "🎯",
    null,
    1,
    {},
  ]) {
    const invalid = await f.request(host, { type: "emoji", emoji: value });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(f.service.get(host.room.code), rawBefore);
  }
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const requestId = randomUUID();
  const sent = await f.request(
    host,
    { type: "emoji", emoji: "agree" },
    -1,
    requestId,
  );
  assert.equal(
    sent.statusCode,
    200,
    "emoji is allowed despite a stale game revision",
  );
  const after = await f.view(host);
  assert.equal(after.revision, initial.revision + 1);
  assert.equal(after.emojis.length, 1);
  assert.equal(after.emojis[0].emoji, "agree");
  t.mock.timers.tick(1999);
  assert.equal(
    (await f.request(host, { type: "emoji", emoji: "deny" })).statusCode,
    429,
  );
  assert.deepEqual(await f.view(host), after);
  assert.equal(
    (await f.request(host, { type: "emoji", emoji: "agree" }, -1, requestId))
      .statusCode,
    200,
  );
  assert.deepEqual(await f.view(host), after);
  t.mock.timers.tick(1);
  const later = await f.action(host, { type: "emoji", emoji: "deny" });
  assert.equal(later.revision, after.revision + 1);
  assert.deepEqual(
    later.emojis.map((event) => event.emoji),
    ["agree", "deny"],
  );
});

test("the same session token reconnects to its retained seat and private hand", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const session = sessions[1];
  const before = await f.view(session);
  await f.closePeer(f.peers[1]);
  await eventually(
    async () =>
      !(await f.view(session)).players.find(
        (player) => player.id === session.playerId,
      )!.connected,
    "disconnect recorded",
  );
  const offline = await f.view(session);
  assert.equal(
    typeof offline.players.find((player) => player.id === session.playerId)!
      .disconnectedAt,
    "number",
  );
  const reconnected = await f.subscribe(session);
  const after = await f.view(session);
  assert.equal(after.players.length, 4);
  assert.equal(
    after.players.find((player) => player.id === session.playerId)!
      .disconnectedAt,
    null,
  );
  assert.deepEqual(after.game!.me, before.game!.me);
  assert.deepEqual(
    after.players.map((player) => player.cards),
    before.players.map((player) => player.cards),
  );
  assertPrivateProjection(
    reconnected.messages.findLast((message) => message.room)!.room!,
    session,
    sessions,
    f,
  );
});

test("SQLite restart preserves game, private identity, revision and idempotency without raw tokens", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wujian-rooms-"));
  const dbPath = join(directory, "rooms.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await fixture(t, dbPath);
  const sessions = await first.startGame();
  const session = sessions[2];
  const requestId = randomUUID();
  const reactions = ["seat-3", "card-left", "good"];
  assert.equal(
    (
      await first.request(
        session,
        { type: "emoji", reactions },
        undefined,
        requestId,
      )
    ).statusCode,
    200,
  );
  const before = await first.view(session);
  await first.close();
  const stored = (await readFile(dbPath)).toString("utf8");
  for (const player of sessions)
    assert.equal(stored.includes(player.token), false);
  const second = await fixture(t, dbPath);
  const restored = await second.view(session);
  assert.equal(restored.revision, before.revision);
  assert.equal(restored.hostId, before.hostId);
  assert.equal(restored.status, "playing");
  assert.equal(
    restored.players.every((player) => !player.connected),
    true,
  );
  assert.deepEqual(restored.game, before.game);
  assert.deepEqual(restored.emojis, before.emojis);
  assert.deepEqual(restored.emojis[0].reactions, reactions);
  const duplicate = await second.request(
    session,
    { type: "emoji", reactions },
    -1,
    requestId,
  );
  assert.equal(duplicate.statusCode, 200);
  assert.equal(
    duplicate.json<{ room: RoomView }>().room.revision,
    before.revision,
  );
  assert.equal(duplicate.json<{ room: RoomView }>().room.emojis.length, 1);
  await second.subscribe(session);
  assert.equal(
    (await second.view(session)).players.filter((player) => player.connected)
      .length,
    1,
  );
  await second.close();
});

test("authenticated gameplay completes arm, turn rotation, shoot and server-only shot resolution", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const initial = await f.view(sessions[0]);
  const shooter = sessions.find(
    (session) => session.playerId === initial.game!.currentPlayerId,
  )!;
  const raw = f.service.rooms.get(shooter.room.code)!.game!;
  raw.reactionMs = 5;
  const victim = raw.players.find(
    (player) =>
      player.id !== shooter.playerId &&
      player.cards.every(
        (card) => card.value !== "agent" && card.value !== "kingpin",
      ),
  )!;
  assert.ok(
    victim,
    "four players always include an ordinary player other than the shooter",
  );
  let room = await f.action(shooter, { type: "arm", revealIndex: 0 });
  assert.equal(
    room.players.find((player) => player.id === shooter.playerId)!.armed,
    true,
  );
  assert.equal(
    room.players.find((player) => player.id === shooter.playerId)!.cards[0]
      .revealed,
    true,
  );
  assert.equal(room.game!.phase, "aim");
  room = await f.action(shooter, { type: "aim", targetId: victim.id });
  if (room.game!.currentPlayerId === shooter.playerId)
    room = await f.action(shooter, { type: "endTurn" });
  for (
    let count = 0;
    room.game!.currentPlayerId !== shooter.playerId && count < 4;
    count++
  ) {
    const current = sessions.find(
      (session) => session.playerId === room.game!.currentPlayerId,
    )!;
    const target = room.players.find(
      (player) =>
        player.id !== current.playerId &&
        player.cards.some((card) => !card.revealed),
    )!;
    const cardIndex = target.cards.findIndex((card) => !card.revealed);
    room = await f.action(current, {
      type: "investigate",
      targetId: target.id,
      cardIndex,
    });
    if (room.game!.currentPlayerId === current.playerId)
      room = await f.action(current, { type: "endTurn" });
  }
  assert.equal(room.game!.currentPlayerId, shooter.playerId);
  room = await f.action(shooter, { type: "shoot" });
  assert.equal(room.game!.phase, "reaction");
  assert.equal(room.game!.pendingShot!.targetId, victim.id);
  assert.equal(
    room.players.find((player) => player.id === victim.id)!.alive,
    true,
    "shot must wait for response window",
  );
  assert.equal(
    (await f.request(shooter, { type: "resolveShot" })).statusCode,
    403,
  );
  await delay(Math.max(0, room.game!.pendingShot!.deadline - Date.now()) + 2);
  f.service.tick();
  const settled = await f.view(shooter);
  const eliminated = settled.players.find((player) => player.id === victim.id)!;
  assert.equal(eliminated.alive, false);
  assert.equal(
    eliminated.cards.every((card) => card.revealed && card.value !== null),
    true,
  );
  assert.equal(eliminated.equipmentCount, 0);
  assert.equal(
    settled.players.find((player) => player.id === shooter.playerId)!.armed,
    false,
  );
  assert.equal(settled.game!.gunSupply, initial.game!.gunSupply);
  assert.equal(settled.game!.pendingShot, undefined);
  assert.equal(settled.status, "playing");
  const victimSession = sessions.find(
    (session) => session.playerId === victim.id,
  )!;
  const beforeRejectedReaction = structuredClone(
    f.service.get(shooter.room.code),
  );
  const rejected = await f.request(victimSession, {
    type: "emoji",
    emoji: "lock",
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, "出局后请安静观战");
  assert.deepEqual(f.service.get(shooter.room.code), beforeRejectedReaction);
});

test("a complete room reaches leader defeat, reveals the table and starts a fresh rematch", async (t) => {
  const f = await fixture(t);
  const sessions = await f.startGame();
  const host = sessions[0];
  const raw = f.service.rooms.get(host.room.code)!.game!;
  raw.reactionMs = 1;
  const leaderId = raw.players.find((p) =>
    p.cards.some((c) => c.value === "kingpin"),
  )!.id;
  let room = await f.view(host);
  for (let step = 0; room.status === "playing" && step < 60; step++) {
    const game = room.game!;
    if (game.phase === "reaction") {
      await delay(3);
      f.service.tick();
      room = await f.view(host);
      continue;
    }
    if (game.phase === "equipment") {
      const owner = sessions.find(
        (s) =>
          f.service.rooms.get(room.code)!.game!.equipmentChoices?.playerId ===
          s.playerId,
      )!;
      const ownView = await f.view(owner);
      room = await f.action(owner, {
        type: "chooseEquipment",
        cardId: ownView.game!.me.equipmentChoices![0].id,
      });
      continue;
    }
    const current = sessions.find((s) => s.playerId === game.currentPlayerId)!;
    const self = room.players.find((p) => p.id === current.playerId)!;
    const target =
      current.playerId === leaderId
        ? room.players.find((p) => p.id !== leaderId && p.alive)!
        : room.players.find((p) => p.id === leaderId)!;
    if (game.phase === "aim") {
      room = await f.action(current, { type: "aim", targetId: target.id });
    } else if (
      self.armed &&
      current.playerId !== leaderId &&
      self.aimingAt === leaderId
    ) {
      room = await f.action(current, { type: "shoot" });
    } else if (
      !self.armed &&
      game.gunSupply > 0 &&
      current.playerId !== leaderId
    ) {
      const index = self.cards.findIndex((c) => !c.revealed);
      room = await f.action(current, {
        type: "arm",
        ...(index >= 0 ? { revealIndex: index } : {}),
      });
    } else {
      const index = self.cards.findIndex((c) => !c.revealed);
      room = await f.action(current, {
        type: "equip",
        ...(index >= 0 ? { revealIndex: index } : {}),
      });
    }
  }
  assert.equal(room.status, "finished");
  assert.equal(room.game!.winner!.team, "honest");
  assert.ok(room.players.every((p) => p.cards.every((c) => c.value !== null)));
  const survivor = sessions.find((session) =>
    room.players.some(
      (player) => player.id === session.playerId && player.alive,
    ),
  )!;
  const finishedState = structuredClone(f.service.get(host.room.code));
  const endedReaction = await f.request(survivor, {
    type: "emoji",
    emoji: "agree",
  });
  assert.equal(endedReaction.statusCode, 400);
  assert.equal(endedReaction.json().error, "对局已结束，不能发送信号");
  assert.deepEqual(f.service.get(host.room.code), finishedState);
  assert.equal(
    (await f.request(sessions[1], { type: "rematch" })).statusCode,
    403,
  );
  room = await f.action(host, { type: "rematch" });
  assert.equal(room.status, "waiting");
  assert.equal(room.game, null);
  assert.equal(room.players.filter((p) => p.ready).length, 1);
  for (const session of sessions.slice(1))
    await f.action(session, { type: "ready", ready: true });
  room = await f.action(host, { type: "start" });
  assert.equal(room.status, "playing");
  assert.equal(room.game!.turn, 1);
  assert.equal(
    room.players.every((p) => p.alive && !p.wounded && !p.armed),
    true,
  );
});
