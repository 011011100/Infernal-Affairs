import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { WebSocket } from "ws";
import {
  createGame,
  applyGameAction,
  gameView,
  getWaitingPlayerId,
} from "./game.js";
import type { GameState, GameAction } from "../shared/types.js";
import { AVATARS, type RoomView } from "../shared/room.js";
import { isReactionSelection } from "../shared/reactions.js";
import { nextPracticeAction } from "./practiceBot.js";
import { RoomStore } from "./store.js";

interface Member {
  id: string;
  name: string;
  avatar: string;
  tokenHash: string;
  ready: boolean;
  disconnectedAt: number | null;
  lastEmoji: number;
}
interface Room {
  code: string;
  hostId: string;
  capacity: number;
  revision: number;
  members: Member[];
  game: GameState | null;
  emojis: RoomView["emojis"];
  createdAt: number;
  updatedAt: number;
  requests: Array<{ playerId: string; id: string }>;
  practice?: {
    gameId: string;
    ownerId: string;
    activePlayerId: string;
    autoplay: boolean;
    nextBotAt: number;
  };
}
export class RoomError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const codePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const PRACTICE_STEP_MS = 1400;

export class RoomService {
  rooms = new Map<string, Room>();
  private sockets = new Map<string, Set<WebSocket>>();
  private closing = false;
  constructor(private store: RoomStore) {
    for (const room of store.list<Room>()) {
      if (room.updatedAt < Date.now() - ROOM_TTL) {
        store.delete(room.code);
        continue;
      }
      for (const member of room.members) member.disconnectedAt = Date.now();
      if (room.practice && !room.practice.gameId) {
        room.practice.gameId = randomUUID();
        store.save(room.code, room);
      }
      this.rooms.set(room.code, room);
    }
  }
  private save(room: Room) {
    room.updatedAt = Date.now();
    this.store.save(room.code, room);
    this.rooms.set(room.code, room);
  }
  private member(input: unknown): { member: Member; token: string } {
    const body = input as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || typeof body.name !== "string")
      throw new RoomError("请输入昵称");
    const name = body.name.trim();
    if (
      [...name].length < 1 ||
      [...name].length > 12 ||
      /[\x00-\x1f\x7f]/.test(name)
    )
      throw new RoomError("昵称需要 1～12 个字符");
    const avatar =
      typeof body.avatar === "string" &&
      (AVATARS as readonly string[]).includes(body.avatar)
        ? body.avatar
        : AVATARS[0];
    const token = randomBytes(32).toString("base64url");
    return {
      token,
      member: {
        id: randomUUID(),
        name,
        avatar,
        tokenHash: hash(token),
        ready: false,
        disconnectedAt: Date.now(),
        lastEmoji: 0,
      },
    };
  }
  create(input: unknown) {
    if (this.rooms.size >= 1000)
      throw new RoomError("房间暂时已满，请稍后再试", 503);
    const capacity = (input as { capacity?: unknown })?.capacity ?? 8;
    if (
      !Number.isInteger(capacity) ||
      Number(capacity) < 4 ||
      Number(capacity) > 8
    )
      throw new RoomError("房间人数必须为 4～8 人");
    const { member, token } = this.member(input);
    member.ready = true;
    let code = "";
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    do {
      code = Array.from(
        { length: 6 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: member.id,
      capacity: Number(capacity),
      revision: 1,
      members: [member],
      game: null,
      emojis: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requests: [],
    };
    this.save(room);
    return { token, playerId: member.id, room: this.view(room, member.id) };
  }
  createPractice(input: unknown) {
    const body = input as Record<string, unknown> | null;
    const created = this.create({ ...body, capacity: body?.capacity ?? 6 });
    const room = this.get(created.room.code);
    while (room.members.length < room.capacity) {
      const seat = room.members.length + 1;
      let name = `陪练${seat}号`;
      if (room.members.some((member) => member.name === name)) name += "·";
      const { member } = this.member({ name, avatar: AVATARS[seat - 1] });
      member.ready = true;
      member.disconnectedAt = null;
      room.members.push(member);
    }
    room.practice = {
      gameId: randomUUID(),
      ownerId: created.playerId,
      activePlayerId: created.playerId,
      autoplay: true,
      nextBotAt: Date.now() + PRACTICE_STEP_MS,
    };
    room.game = createGame(
      room.members.map(({ id, name, avatar }) => ({ id, name, avatar })),
    );
    this.save(room);
    return {
      token: created.token,
      playerId: created.playerId,
      room: this.view(room, created.playerId),
    };
  }
  get(code: string) {
    const room = codePattern.test(code) && this.rooms.get(code);
    if (!room) throw new RoomError("房间不存在或已经过期", 404);
    return room;
  }
  join(code: string, input: unknown) {
    const room = structuredClone(this.get(code));
    if (room.practice)
      throw new RoomError("这是独立的单人测试房间，不能加入", 403);
    if (room.game) throw new RoomError("对局已开始，暂时不能加入", 409);
    if (room.members.length >= room.capacity)
      throw new RoomError("房间已满", 409);
    const { member, token } = this.member(input);
    if (room.members.some((p) => p.name === member.name))
      throw new RoomError("房间里已有这个昵称，请换一个");
    room.members.push(member);
    room.revision++;
    this.save(room);
    this.broadcast(code);
    return { token, playerId: member.id, room: this.view(room, member.id) };
  }
  authenticate(code: string, token: string) {
    const room = this.get(code);
    if (!token || token.length > 128)
      throw new RoomError("身份验证失败，请重新加入房间", 401);
    const digest = Buffer.from(hash(token));
    const member = room.members.find((p) =>
      timingSafeEqual(Buffer.from(p.tokenHash), digest),
    );
    if (!member || (room.practice && member.id !== room.practice.ownerId))
      throw new RoomError("身份验证失败，请重新加入房间", 401);
    return { room, member };
  }
  private connected(code: string, id: string) {
    return (this.sockets.get(`${code}:${id}`)?.size ?? 0) > 0;
  }
  view(room: Room, viewerId: string): RoomView {
    const perspective =
      room.practice?.ownerId === viewerId
        ? room.practice.activePlayerId
        : viewerId;
    const game = room.game ? gameView(room.game, perspective) : null;
    return {
      ...(room.game ? { waitingPlayerId: getWaitingPlayerId(room.game) } : {}),
      ...(room.practice
        ? {
            practice: {
              gameId: room.practice.gameId,
              activePlayerId: room.practice.activePlayerId,
              autoplay: room.practice.autoplay,
            },
          }
        : {}),
      code: room.code,
      hostId: room.hostId,
      capacity: room.capacity,
      revision: room.revision,
      status: game?.status ?? "waiting",
      game,
      createdAt: room.createdAt,
      players: room.members.map((member) => ({
        id: member.id,
        name: member.name,
        avatar: member.avatar,
        ready: member.ready,
        connected:
          room.practice && member.id !== room.practice.ownerId
            ? true
            : this.connected(room.code, member.id),
        disconnectedAt:
          room.practice && member.id !== room.practice.ownerId
            ? null
            : member.disconnectedAt,
        alive: true,
        wounded: false,
        armed: false,
        aimingAt: null,
        cards: [],
        equipmentCount: 0,
        ...(game?.players.find((p) => p.id === member.id) ?? {}),
      })),
      emojis: room.emojis.filter((e) => e.at > Date.now() - 30_000),
    };
  }
  action(code: string, token: string, input: unknown): RoomView {
    const { room: original, member } = this.authenticate(code, token);
    if (!input || typeof input !== "object") throw new RoomError("无效操作");
    const body = input as Record<string, unknown>;
    if (
      typeof body.requestId !== "string" ||
      !/^[\w-]{8,80}$/.test(body.requestId)
    )
      throw new RoomError("缺少操作编号");
    if (
      original.requests.some(
        (r) => r.playerId === member.id && r.id === body.requestId,
      )
    )
      return this.view(original, member.id);
    const practiceExit =
      body.type === "leave" && original.practice?.ownerId === member.id;
    if (
      body.expectedRevision !== original.revision &&
      body.type !== "emoji" &&
      !practiceExit
    )
      throw new RoomError("房间状态已更新，请根据最新画面重试", 409);
    const room = structuredClone(original);
    const self = room.members.find(
      (p) => p.id === (room.practice?.activePlayerId ?? member.id),
    )!;
    const practiceOnly = () => {
      if (!room.practice || room.practice.ownerId !== member.id)
        throw new RoomError("此操作只适用于你自己的单人测试房间", 403);
      return room.practice;
    };
    const hostOnly = () => {
      if (room.hostId !== member.id)
        throw new RoomError("只有房主可以执行此操作", 403);
    };
    if (
      room.practice &&
      ["ready", "start", "kick", "rematch", "skip"].includes(String(body.type))
    )
      throw new RoomError("请使用单人测试控制来切换座位或重新开始", 403);
    switch (body.type) {
      case "practiceSwitch": {
        const practice = practiceOnly();
        if (
          typeof body.playerId !== "string" ||
          !room.members.some((player) => player.id === body.playerId)
        )
          throw new RoomError("测试座位不存在");
        practice.activePlayerId = body.playerId;
        break;
      }
      case "practiceAuto": {
        const practice = practiceOnly();
        if (typeof body.enabled !== "boolean")
          throw new RoomError("无效的自动行动设置");
        practice.autoplay = body.enabled;
        break;
      }
      case "practiceStep":
        practiceOnly();
        if (!this.advancePractice(room))
          throw new RoomError("当前没有可推进的行动，请等待射击结算或重新开始");
        break;
      case "practiceReset": {
        const practice = practiceOnly();
        room.game = createGame(
          room.members.map(({ id, name, avatar }) => ({ id, name, avatar })),
        );
        room.emojis = [];
        for (const player of room.members) player.lastEmoji = 0;
        practice.gameId = randomUUID();
        practice.activePlayerId = practice.ownerId;
        break;
      }
      case "ready":
        if (room.game) throw new RoomError("对局已开始");
        if (typeof body.ready !== "boolean")
          throw new RoomError("无效的准备状态");
        self.ready = body.ready;
        break;
      case "start":
        hostOnly();
        if (room.game) throw new RoomError("对局已经开始");
        if (room.members.length < 4)
          throw new RoomError("至少需要 4 人才能开始");
        if (room.members.some((p) => !p.ready || !this.connected(code, p.id)))
          throw new RoomError("请等待所有玩家在线并准备");
        room.game = createGame(
          room.members.map(({ id, name, avatar }) => ({ id, name, avatar })),
        );
        break;
      case "rematch":
        hostOnly();
        if (!room.game || gameView(room.game, self.id).status !== "finished")
          throw new RoomError("本局结束后才能再来一局");
        room.game = null;
        room.members.forEach((p) => {
          p.ready = p.id === room.hostId;
        });
        room.emojis = [];
        break;
      case "leave":
        if (room.practice) {
          const view = this.view(room, member.id);
          this.store.delete(code);
          this.rooms.delete(code);
          for (const player of room.members)
            this.disconnectMember(code, player.id, "你已退出单人测试");
          return view;
        }
        if (room.game && gameView(room.game, self.id).status !== "finished")
          throw new RoomError("对局进行中会保留你的座位，关闭页面后可重连");
        room.members = room.members.filter((p) => p.id !== self.id);
        if (room.hostId === self.id && room.members[0]) {
          room.hostId = room.members[0].id;
          room.members[0].ready = true;
        }
        this.disconnectMember(code, self.id, "你已离开房间");
        if (!room.members.length) {
          this.store.delete(code);
          this.rooms.delete(code);
          return this.view(room, self.id);
        }
        break;
      case "kick": {
        hostOnly();
        if (room.game) throw new RoomError("开始后不能移出玩家");
        if (body.targetId === self.id) throw new RoomError("不能移出自己");
        if (!room.members.some((p) => p.id === body.targetId))
          throw new RoomError("玩家不存在");
        room.members = room.members.filter((p) => p.id !== body.targetId);
        this.disconnectMember(
          code,
          String(body.targetId),
          "房主已将你移出房间",
        );
        break;
      }
      case "emoji": {
        const hasSelection = Object.hasOwn(body, "reactions");
        const selection = hasSelection ? body.reactions : [body.emoji];
        if (!isReactionSelection(selection))
          throw new RoomError("请选择 1～3 个不同的有效信号");
        if (room.game?.status === "finished")
          throw new RoomError("对局已结束，不能发送信号");
        if (Date.now() - self.lastEmoji < 2000)
          throw new RoomError("表情发送太快啦，稍等一下", 429);
        if (
          room.game &&
          !gameView(room.game, self.id).players.find((p) => p.id === self.id)
            ?.alive
        )
          throw new RoomError("出局后请安静观战");
        self.lastEmoji = Date.now();
        room.emojis = [
          ...room.emojis.filter((e) => e.at > Date.now() - 30_000),
          {
            id: randomUUID(),
            playerId: self.id,
            emoji: selection[0],
            ...(hasSelection ? { reactions: [...selection] } : {}),
            at: Date.now(),
          },
        ].slice(-48);
        break;
      }
      case "skip": {
        hostOnly();
        if (!room.game) throw new RoomError("对局尚未开始");
        const waiting = room.members.find(
          (p) => p.id === getWaitingPlayerId(room.game!),
        );
        if (
          !waiting ||
          this.connected(code, waiting.id) ||
          !waiting.disconnectedAt ||
          Date.now() - waiting.disconnectedAt < 60_000
        )
          throw new RoomError("玩家离线满 60 秒后才可跳过等待");
        room.game = applyGameAction(room.game, waiting.id, { type: "skip" });
        break;
      }
      default:
        if (body.type === "resolveShot" || typeof body.type !== "string")
          throw new RoomError("无效操作", 403);
        if (!room.game) throw new RoomError("对局尚未开始");
        room.game = applyGameAction(
          room.game,
          self.id,
          body as unknown as GameAction,
        );
    }
    if (room.practice && body.type !== "emoji")
      room.practice.nextBotAt = Date.now() + PRACTICE_STEP_MS;
    room.revision++;
    room.requests = [
      ...room.requests,
      { playerId: member.id, id: body.requestId },
    ].slice(-256);
    this.save(room);
    this.broadcast(code);
    return this.view(room, member.id);
  }
  private advancePractice(room: Room): boolean {
    if (
      !room.practice ||
      !room.game ||
      room.game.status !== "playing" ||
      room.game.phase === "reaction"
    )
      return false;
    const next = nextPracticeAction(room.game);
    if (!next || next.playerId !== getWaitingPlayerId(room.game)) return false;
    room.game = applyGameAction(room.game, next.playerId, next.action);
    return true;
  }
  subscribe(code: string, token: string, socket: WebSocket) {
    const { room, member } = this.authenticate(code, token);
    const key = `${code}:${member.id}`;
    const set = this.sockets.get(key) ?? new Set<WebSocket>();
    if (set.size >= 4) throw new RoomError("此身份的连接过多，请关闭其他页面");
    set.add(socket);
    this.sockets.set(key, set);
    member.disconnectedAt = null;
    this.broadcast(code);
    return () => {
      set.delete(socket);
      if (this.closing) return;
      if (!set.size) {
        this.sockets.delete(key);
        const current = this.rooms.get(code);
        const existing = current?.members.find((p) => p.id === member.id);
        if (existing && current) {
          existing.disconnectedAt = Date.now();
          this.save(current);
        }
      }
      this.broadcast(code);
    };
  }
  private disconnectMember(code: string, playerId: string, reason: string) {
    const key = `${code}:${playerId}`;
    for (const socket of this.sockets.get(key) ?? []) {
      socket.send(JSON.stringify({ type: "removed", error: reason }));
      socket.close(1000, reason);
    }
    this.sockets.delete(key);
  }
  broadcast(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const member of room.members) {
      const peers = this.sockets.get(`${code}:${member.id}`);
      if (!peers?.size) continue;
      const message = JSON.stringify({
        type: "room",
        room: this.view(room, member.id),
      });
      for (const socket of peers)
        if (socket.readyState === 1) socket.send(message);
    }
  }
  tick() {
    for (const original of this.rooms.values()) {
      if (
        original.updatedAt < Date.now() - ROOM_TTL &&
        !original.members.some((m) => this.connected(original.code, m.id))
      ) {
        this.store.delete(original.code);
        this.rooms.delete(original.code);
        continue;
      }
      if (
        original.practice &&
        !this.connected(original.code, original.practice.ownerId)
      )
        continue;
      let room: Room | null = null;
      const view = original.game
        ? gameView(original.game, original.hostId)
        : null;
      if (
        view?.phase === "reaction" &&
        view.pendingShot &&
        view.pendingShot.deadline <= Date.now() &&
        original.game
      ) {
        room = structuredClone(original);
        room.game = applyGameAction(room.game!, view.pendingShot.shooterId, {
          type: "resolveShot",
        });
        if (room.practice)
          room.practice.nextBotAt = Date.now() + PRACTICE_STEP_MS;
      }
      if (original.practice) {
        const current = room ?? original;
        if (
          current.practice!.autoplay &&
          current.practice!.nextBotAt <= Date.now() &&
          current.game?.status === "playing" &&
          current.game.phase !== "reaction" &&
          getWaitingPlayerId(current.game) !== current.practice!.activePlayerId
        ) {
          const candidate = room ?? structuredClone(original);
          if (this.advancePractice(candidate)) {
            candidate.practice!.nextBotAt = Date.now() + PRACTICE_STEP_MS;
            room = candidate;
          }
        }
      } else {
        const host = original.members.find((p) => p.id === original.hostId);
        if (host?.disconnectedAt && Date.now() - host.disconnectedAt > 60_000) {
          const next = original.members.find((p) =>
            this.connected(original.code, p.id),
          );
          if (next) {
            room ??= structuredClone(original);
            room.hostId = next.id;
            if (!room.game)
              room.members.find((p) => p.id === next.id)!.ready = true;
          }
        }
      }
      if (room) {
        room.revision++;
        this.save(room);
        this.broadcast(room.code);
      }
    }
  }
  close() {
    this.closing = true;
    for (const sockets of this.sockets.values())
      for (const socket of sockets) socket.close(1001);
    this.sockets.clear();
  }
}
