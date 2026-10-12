import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Copy,
  Crosshair,
  DoorOpen,
  Eye,
  Fingerprint,
  Flag,
  HeartCrack,
  Info,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Radio,
  RotateCcw,
  Shield,
  ShieldCheck,
  Skull,
  Smile,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import type { EquipmentCard, GameLog } from "../shared/types";
import RulesManual from "./RulesManual";
import { ThemeToggle, useTheme } from "./Theme";
import type { RoomView } from "../shared/room";
import { AVATARS } from "../shared/room";
import type { ReactionId } from "../shared/reactions";
import ReactionPicker, { ReactionBubble } from "./ReactionPicker";
import {
  investigationBaseline,
  isInvestigationCueActive,
  receiveInvestigationSnapshot,
} from "./investigationCue";

type Session = { code: string; token: string; playerId: string };
// The optional 3D chunk must never prevent a weak-network client from playing.
const GunTable = lazy(() =>
  import("./GunTable").catch(() => ({ default: () => <></> })),
);
type Player = RoomView["players"][number];
type Connection = "connecting" | "connected" | "reconnecting" | "offline";
type Action = Record<string, unknown> & { type: string };
const SESSION_KEY = "wujian-session-v1";
const IDENTITY: Record<
  string,
  { name: string; en: string; className: string; description: string }
> = {
  honest: {
    name: "忠诚",
    en: "HONEST",
    className: "honest",
    description: "忠诚警察阵营",
  },
  crooked: {
    name: "变节",
    en: "CROOKED",
    className: "crooked",
    description: "变节警察阵营",
  },
  agent: {
    name: "探长",
    en: "THE AGENT",
    className: "honest leader agent",
    description: "忠诚警察的首领",
  },
  kingpin: {
    name: "主谋",
    en: "THE KINGPIN",
    className: "crooked leader kingpin",
    description: "变节警察的首领",
  },
};
const TEAM_NAMES: Record<string, string> = {
  honest: "忠诚警察",
  crooked: "变节警察",
  solo: "独行者",
};
function AmbientBackground() {
  const [paused, setPaused] = useState(() => document.hidden);
  useEffect(() => {
    const syncVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  return (
    <div
      className={`ambient-background ${paused ? "ambient-paused" : ""}`}
      aria-hidden="true"
    >
      <span className="ambient-light ambient-blue" />
      <span className="ambient-light ambient-red" />
    </div>
  );
}
function initialSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
function inviteCode() {
  return (
    new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? ""
  );
}
function nameOf(players: Player[], id?: string | null) {
  return players.find((p) => p.id === id)?.name || "未知玩家";
}
function cardPositions(indices: number[]) {
  return `第 ${indices.map((index) => index + 1).join("、")} 张身份牌`;
}
function investigationLabel(
  investigations: NonNullable<GameLog["investigations"]>,
  players: Player[],
  targetId: string,
  cardIndex: number,
) {
  const observers = investigations.filter(
    (event) =>
      event.targetId === targetId && event.cardIndices.includes(cardIndex),
  );
  return observers.length
    ? `${observers.map((event) => nameOf(players, event.investigatorId)).join("、")} 刚刚查看了这张牌`
    : undefined;
}
function IconButton({
  label,
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark">
        <Shield size={24} strokeWidth={1.3} />
        <span>无</span>
      </span>
      <div>
        <b>无间风云</b>
        <span>INFERNAL AFFAIRS</span>
      </div>
    </div>
  );
}
function Modal({
  title,
  eyebrow,
  children,
  onClose,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const list = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, [tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialog}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <div className="modal-header-actions">
            <ThemeToggle />
            <IconButton label="关闭弹窗" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="行动手册"
      eyebrow="FIELD MANUAL / 从第一张牌开始"
      onClose={onClose}
      className="rules-modal manual-modal"
    >
      <RulesManual onClose={onClose} />
    </Modal>
  );
}

function Home({
  onEnter,
  busy,
  onRules,
  onResume,
}: {
  onEnter: (
    name: string,
    avatar: string,
    capacity: number,
    code?: string,
  ) => void;
  busy: boolean;
  onRules: () => void;
  onResume?: () => void;
}) {
  const [mode, setMode] = useState<"create" | "join">(
    inviteCode() ? "join" : "create",
  );
  const [name, setName] = useState(
    () => localStorage.getItem("wujian-name") || "",
  );
  const [avatar, setAvatar] = useState(
    () => localStorage.getItem("wujian-avatar") || AVATARS[0],
  );
  const [capacity, setCapacity] = useState(6);
  const [code, setCode] = useState(inviteCode());
  const [avatarPicker, setAvatarPicker] = useState(false);
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 12 &&
    (mode === "create" || code.trim().length === 6);
  return (
    <div className="home">
      <header className="home-header">
        <Brand />
        <div className="home-header-actions">
          <ThemeToggle />
          <button className="text-button" onClick={onRules}>
            <BookOpen size={17} /> 行动手册 <ArrowRight size={16} />
          </button>
        </div>
      </header>
      <main className="home-main">
        <section className="hero">
          <div className="eyebrow hero-eyebrow">
            <span className="status-dot" /> ONLINE SOCIAL DEDUCTION
          </div>
          <h1>
            每个人，
            <br />
            都有<span>另一面。</span>
          </h1>
          <p className="hero-description">
            警徽之下，暗流涌动。
            <br />
            在一张牌桌上，找到值得你相信的人。
          </p>
          <div className="hero-facts">
            <span>
              <Users size={17} /> 4—8 人
            </span>
            <i />
            <span>
              <Smile size={17} /> 表情交锋
            </span>
            <i />
            <span>
              <LockKeyhole size={16} /> 私密房间
            </span>
          </div>
          <div className="case-preview" aria-hidden="true">
            <div className="case-stamp">
              CONFIDENTIAL
              <br />
              <small>机密档案 / 仅限内部</small>
            </div>
            <div className="preview-card preview-card-left">
              <span>INTEGRITY / 01</span>
              <Fingerprint size={59} strokeWidth={0.9} />
              <b>忠诚</b>
              <small>HONEST</small>
            </div>
            <div className="preview-card preview-card-center">
              <span>INTEGRITY / 02</span>
              <Shield size={65} strokeWidth={0.8} />
              <b>未知</b>
              <small>TRUST NO ONE</small>
            </div>
            <div className="preview-card preview-card-right">
              <span>INTEGRITY / 03</span>
              <Eye size={59} strokeWidth={0.9} />
              <b>变节</b>
              <small>CROOKED</small>
            </div>
            <div className="case-caption">
              <span>证据会说话。</span>
              <span>人，不一定。</span>
            </div>
          </div>
        </section>
        <section className="entry-panel">
          <div className="entry-top">
            <span className="eyebrow">YOUR NEXT MOVE</span>
            <span className="file-tag">档案 № 001</span>
          </div>
          <h2>今晚，谁是自己人？</h2>
          {onResume && (
            <button className="text-button resume-button" onClick={onResume}>
              <RotateCcw size={14} /> 回到之前的牌桌
            </button>
          )}
          <p className="entry-subtitle">叫上朋友，一起进入这场信任博弈。</p>
          <div className="entry-tabs" role="tablist" aria-label="进入游戏方式">
            <button
              role="tab"
              aria-selected={mode === "create"}
              className={mode === "create" ? "active" : ""}
              onClick={() => setMode("create")}
            >
              创建房间
            </button>
            <button
              role="tab"
              aria-selected={mode === "join"}
              className={mode === "join" ? "active" : ""}
              onClick={() => setMode("join")}
            >
              加入房间
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) {
                localStorage.setItem("wujian-name", name.trim());
                localStorage.setItem("wujian-avatar", avatar);
                onEnter(
                  name.trim(),
                  avatar,
                  capacity,
                  mode === "join" ? code.trim() : undefined,
                );
              }
            }}
          >
            <label className="field-label" htmlFor="player-name">
              你的行动代号 <span>1—12 个字符</span>
            </label>
            <div className="identity-input">
              <button
                type="button"
                className="avatar-button"
                onClick={() => setAvatarPicker(!avatarPicker)}
                aria-label="选择头像"
                aria-expanded={avatarPicker}
              >
                {avatar}
                <ChevronDown size={12} />
              </button>
              <input
                id="player-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={12}
                placeholder="起一个让人记住的名字"
                autoComplete="nickname"
                required
              />
            </div>
            {avatarPicker && (
              <div className="avatar-picker">
                {AVATARS.map((item) => (
                  <button
                    className={avatar === item ? "selected" : ""}
                    key={item}
                    type="button"
                    onClick={() => {
                      setAvatar(item);
                      setAvatarPicker(false);
                    }}
                    aria-label={`头像 ${item}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            {mode === "create" ? (
              <>
                <label className="field-label">
                  房间人数上限 <span>至少 4 人即可开始</span>
                </label>
                <div className="capacity-selector">
                  {[4, 5, 6, 7, 8].map((number) => (
                    <button
                      className={capacity === number ? "selected" : ""}
                      type="button"
                      key={number}
                      aria-pressed={capacity === number}
                      onClick={() => setCapacity(number)}
                    >
                      {number}
                      <small>人</small>
                    </button>
                  ))}
                </div>
                <div className="entry-note">
                  <LockKeyhole size={15} />
                  <span>创建后分享房间码，持房间码或链接即可加入。</span>
                </div>
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="room-code">
                  房间码 <span>向房主获取</span>
                </label>
                <input
                  id="room-code"
                  className="room-code-input"
                  value={code}
                  onChange={(event) =>
                    setCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                  maxLength={6}
                  minLength={6}
                  placeholder="输入房间码"
                  autoComplete="off"
                  required
                />
                <div className="entry-note">
                  <Users size={15} />
                  <span>朋友已经在等你了，输入房间码入座。</span>
                </div>
              </>
            )}
            <button
              className="button primary entry-submit"
              disabled={!valid || busy}
              type="submit"
            >
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={18} /> 正在连接牌桌
                </>
              ) : (
                <>
                  {mode === "create"
                    ? "创建房间，邀请好友"
                    : "加入房间，立即入座"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="entry-bottom">
            <span>无需注册</span>
            <span>即时开局</span>
            <span>浏览器即玩</span>
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <span>一场关于信任的游戏</span>
        <span className="footer-line" />
        <span>THE TRUTH HAS TWO SIDES.</span>
        <button onClick={onRules}>
          查看行动手册 <ChevronRight size={14} />
        </button>
      </footer>
    </div>
  );
}

function TableHeader({
  room,
  connection,
  onRules,
  onLeave,
  onShare,
}: {
  room: RoomView;
  connection: Connection;
  onRules: () => void;
  onLeave: () => void;
  onShare: () => void;
}) {
  return (
    <header className="table-header">
      <Brand small />
      <div className="room-header-info">
        <span className="room-code-label">房间</span>
        <button
          className="room-code-button"
          onClick={onShare}
          title="复制邀请链接"
        >
          {room.code}
          <Copy size={13} />
        </button>
        <span
          className={`connection-state ${connection}`}
          title={
            connection === "connected"
              ? "已连接到服务器"
              : "连接恢复后可继续游戏"
          }
        >
          {connection === "connected" ? (
            <Wifi size={14} />
          ) : (
            <WifiOff size={14} />
          )}
          <span>
            {connection === "connected"
              ? "实时在线"
              : connection === "connecting"
                ? "连接中"
                : connection === "reconnecting"
                  ? "重连中"
                  : "已断线"}
          </span>
        </span>
      </div>
      <div className="header-actions">
        <ThemeToggle />
        <IconButton label="行动手册" onClick={onRules}>
          <BookOpen size={19} />
        </IconButton>
        <IconButton label="离开房间" onClick={onLeave}>
          <LogOut size={19} />
        </IconButton>
      </div>
    </header>
  );
}
function Lobby({
  room,
  meId,
  busy,
  onAction,
  onShare,
}: {
  room: RoomView;
  meId: string;
  busy: boolean;
  onAction: (action: Action) => void;
  onShare: () => void;
}) {
  const me = room.players.find((p) => p.id === meId)!;
  const isHost = room.hostId === meId;
  const allReady =
    room.players.length >= 4 &&
    room.players.every((p) => p.ready && p.connected);
  const countReady = room.players.filter((p) => p.ready).length;
  return (
    <main className="lobby">
      <div className="lobby-heading">
        <span className="eyebrow">BRIEFING ROOM / 集结室</span>
        <h1>
          牌桌已备好，<span>等你的人。</span>
        </h1>
        <p>身份尚未揭晓，信任从现在开始。</p>
      </div>
      <div className="lobby-layout">
        <section className="lobby-seats-panel">
          <div className="panel-heading">
            <h2>
              <Users size={19} /> 行动小组{" "}
              <span>
                {room.players.length} / {room.capacity}
              </span>
            </h2>
            <span className="subtle-label">{countReady} 人已准备</span>
          </div>
          <div className={`lobby-seats seats-${room.capacity}`}>
            {Array.from({ length: room.capacity }, (_, i) => {
              const player = room.players[i];
              return (
                <div
                  key={player?.id || i}
                  className={`lobby-seat ${player ? "occupied" : "empty"} ${player?.id === meId ? "is-me" : ""}`}
                >
                  <span className="seat-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {player ? (
                    <>
                      <div className="lobby-avatar">
                        {player.avatar}
                        <span
                          className={`presence-dot ${player.connected ? "online" : ""}`}
                        />
                      </div>
                      <h3>
                        {player.name} {player.id === meId && <small>你</small>}
                      </h3>
                      <span
                        className={`ready-label ${player.ready ? "ready" : ""}`}
                      >
                        {player.ready ? (
                          <Check size={13} />
                        ) : (
                          <MoreHorizontal size={16} />
                        )}{" "}
                        {player.ready
                          ? "已准备"
                          : player.connected
                            ? "准备中"
                            : "暂时离线"}
                      </span>
                      {player.id === room.hostId && (
                        <span className="host-tag">房主</span>
                      )}
                      {isHost && player.id !== meId && (
                        <button
                          className="kick-player"
                          onClick={() =>
                            onAction({ type: "kick", targetId: player.id })
                          }
                          title={`移出 ${player.name}`}
                          aria-label={`移出 ${player.name}`}
                          disabled={busy}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="empty-seat-icon">
                        <Users size={25} strokeWidth={1} />
                      </div>
                      <h3>空席以待</h3>
                      <button className="invite-seat" onClick={onShare}>
                        邀请好友 <ArrowRight size={12} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="lobby-panel-footer">
            <LockKeyhole size={15} />
            <span>邀请制房间 · 凭房间码或链接加入</span>
          </div>
        </section>
        <aside className="lobby-sidebar">
          <div className="invite-card">
            <span className="eyebrow">INVITATION CODE</span>
            <span className="large-room-code">{room.code}</span>
            <p>把房间码发给朋友，或者直接分享链接。</p>
            <button className="button outline full-width" onClick={onShare}>
              <Copy size={16} /> 复制邀请链接
            </button>
          </div>
          <div className="ready-card">
            <div className="readiness">
              <span>集结进度</span>
              <b>
                {countReady}
                <small> / {room.capacity}</small>
              </b>
            </div>
            <div className="progress-track">
              <div
                style={{ width: `${(countReady / room.capacity) * 100}%` }}
              />
            </div>
            <p>
              {room.players.length < 4
                ? `再邀请 ${4 - room.players.length} 位朋友即可开局`
                : allReady
                  ? "所有人已准备，可以开始行动。"
                  : "等待所有人点击准备。"}
            </p>
            <button
              className={`button ${me.ready ? "outline" : "primary"} full-width`}
              onClick={() => onAction({ type: "ready", ready: !me.ready })}
              disabled={busy}
            >
              {me.ready ? (
                <>
                  <CheckCheck size={18} /> 已准备 · 点击取消
                </>
              ) : (
                <>
                  <Check size={18} /> 我准备好了
                </>
              )}
            </button>
            {isHost && (
              <button
                className="button primary full-width start-game"
                onClick={() => onAction({ type: "start" })}
                disabled={!allReady || busy}
              >
                开始游戏 <ArrowRight size={18} />
              </button>
            )}
            <span className="start-hint">
              {isHost
                ? "至少 4 人且全员准备后，由你开始游戏。"
                : "准备完成后，等待房主开始游戏。"}
            </span>
          </div>
        </aside>
      </div>
      <div className="lobby-tip">
        <Fingerprint size={24} strokeWidth={1} />
        <p>
          记住：对方说的话，不一定和他的身份一样。
          <span>一副好表情，也可以是你的武器。</span>
        </p>
      </div>
    </main>
  );
}

function IdentityCard({
  card,
  index,
  own = false,
  selectable = false,
  selected = false,
  onClick,
  small = false,
  inspectionLabel,
}: {
  card: Player["cards"][number];
  index: number;
  own?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  inspectionLabel?: string;
}) {
  const identity = card.value ? IDENTITY[card.value] : null;
  return (
    <button
      type="button"
      className={`identity-card ${small ? "small-card" : ""} ${identity?.className || "hidden-card"} ${selected ? "selected" : ""} ${card.revealed ? "public-card" : ""} ${selectable ? "selectable" : ""} ${card.wounded ? "wounded-card" : ""} ${inspectionLabel ? "inspected-card" : ""}`}
      disabled={!selectable}
      onClick={onClick}
      title={inspectionLabel}
      aria-label={`第 ${index + 1} 张身份牌：${identity?.name || "未知"}，${card.revealed ? "已公开" : own ? "仅你可见" : card.known ? "已调查" : "未调查"}${card.wounded ? "，已受伤" : ""}${inspectionLabel ? `，${inspectionLabel}` : ""}`}
    >
      <span className="card-order">0{index + 1}</span>
      {inspectionLabel && (
        <span className="card-inspection-marker" aria-hidden="true">
          <Eye size={small ? 12 : 14} />
        </span>
      )}
      {card.wounded && (
        <span className="card-wound" aria-hidden="true">
          <HeartCrack size={small ? 11 : 12} />
          {!small && "受伤"}
        </span>
      )}
      {identity ? (
        <>
          {card.value === "agent" || card.value === "kingpin" ? (
            <ShieldCheck size={small ? 17 : 30} strokeWidth={1.2} />
          ) : (
            <Fingerprint size={small ? 17 : 30} strokeWidth={1.2} />
          )}
          <b>{identity.name}</b>
          {!small && <span className="card-en">{identity.en}</span>}
        </>
      ) : (
        <>
          <Shield size={small ? 18 : 30} strokeWidth={1} />
          <b>?</b>
        </>
      )}
      <span className="card-visibility">
        {card.revealed ? (
          <Eye size={small ? 8 : 11} />
        ) : identity ? (
          <LockKeyhole size={small ? 8 : 11} />
        ) : null}
        {!small &&
          (card.revealed
            ? "已公开"
            : own
              ? "仅你可见"
              : card.known
                ? "已调查"
                : "待调查")}
      </span>
    </button>
  );
}

function PlayerSeat({
  player,
  index,
  currentId,
  myId,
  players,
  reaction,
  shotTarget,
  onClick,
  selectable = false,
  selected = false,
  plantedEvidence = false,
  investigations = [],
}: {
  player: Player;
  index: number;
  currentId: string;
  myId: string;
  players: Player[];
  reaction?: RoomView["emojis"][number];
  shotTarget?: string;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  plantedEvidence?: boolean;
  investigations?: NonNullable<GameLog["investigations"]>;
}) {
  return (
    <div
      className={`player-seat ${player.id === currentId ? "current-seat" : ""} ${player.id === myId ? "my-seat" : ""} ${!player.alive ? "eliminated-seat" : ""} ${player.alive && player.wounded ? "wounded-seat" : ""} ${selectable ? "targetable-seat" : ""} ${selected ? "selected-seat" : ""} ${shotTarget === player.id ? "under-fire" : ""} ${investigations.some((event) => event.targetId === player.id) ? "inspected-seat" : ""}`}
      data-player-id={player.id}
      data-table-half={index < Math.ceil(players.length / 2) ? "top" : "bottom"}
      onClick={selectable ? onClick : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={(event) => {
        if (selectable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.();
        }
      }}
      aria-label={selectable ? `选择 ${player.name}` : undefined}
    >
      <div className="seat-topline">
        <span className="seat-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        {player.id === currentId && player.alive ? (
          <span className="turn-badge">行动中</span>
        ) : (
          <span
            className={`player-online ${player.connected ? "" : "disconnected"}`}
            title={player.connected ? "在线" : "离线"}
          />
        )}
      </div>
      <div className="player-name-row">
        <span className="player-avatar">{player.avatar}</span>
        <div>
          <b>
            {player.name}
            {player.id === myId && <small>你</small>}
          </b>
          <span className="player-state">
            {!player.alive ? (
              <>
                <Skull size={11} /> 已出局
              </>
            ) : player.armed ? (
              <>
                <Crosshair size={11} /> 持有枪械
              </>
            ) : player.cards.every((card) => card.revealed) ? (
              "身份已公开"
            ) : (
              "身份待查"
            )}
          </span>
        </div>
      </div>
      <div className="seat-cards">
        {player.cards.map((card, i) => (
          <IdentityCard
            key={i}
            card={card}
            index={i}
            small
            own={player.id === myId}
            inspectionLabel={investigationLabel(
              investigations,
              players,
              player.id,
              i,
            )}
          />
        ))}
      </div>
      {player.alive && player.wounded && (
        <div className="wound-status" role="status">
          <HeartCrack size={13} />
          <span>
            <b>已受伤</b>
            <small>再中弹即出局</small>
          </span>
        </div>
      )}
      <div className="seat-bottomline">
        <span>
          <Clipboard size={11} /> {player.equipmentCount}
        </span>
        {player.armed && player.aimingAt ? (
          <span className="aim-label">
            <Crosshair size={11} /> {nameOf(players, player.aimingAt)}
          </span>
        ) : (
          <span
            className="seat-secret"
            title={
              plantedEvidence
                ? "栽赃生效：普通忠诚与变节身份按相反阵营计算"
                : undefined
            }
          >
            {plantedEvidence
              ? "栽赃生效"
              : `${player.cards.filter((c) => c.revealed).length} / 3 已公开`}
          </span>
        )}
      </div>
      <div className="gun-dock" data-gun-dock={player.id} aria-hidden="true" />
      {reaction && (
        <ReactionBubble
          key={reaction.id}
          event={reaction}
          sender={player.name}
        />
      )}
    </div>
  );
}

function TargetPicker({
  players,
  meId,
  allowSelf = false,
  targetId,
  onTarget,
  cardIndex,
  onCard,
  otherTargetId,
  heading = "选择一位玩家",
  status = "alive",
  eligibleIds,
  hiddenOnly = false,
}: {
  players: Player[];
  meId: string;
  allowSelf?: boolean;
  targetId: string;
  onTarget: (id: string) => void;
  cardIndex?: number;
  onCard?: (index: number) => void;
  otherTargetId?: string;
  heading?: string;
  status?: "alive" | "dead";
  eligibleIds?: string[];
  hiddenOnly?: boolean;
}) {
  const target = players.find((p) => p.id === targetId);
  return (
    <div className="target-picker">
      <label className="field-label">{heading}</label>
      <div className="target-players">
        {players
          .filter(
            (p) =>
              (status === "dead" ? !p.alive : p.alive) &&
              (allowSelf || p.id !== meId) &&
              p.id !== otherTargetId &&
              (!eligibleIds || eligibleIds.includes(p.id)),
          )
          .map((p) => (
            <button
              key={p.id}
              type="button"
              className={targetId === p.id ? "selected" : ""}
              onClick={() => onTarget(p.id)}
            >
              <span>{p.avatar}</span>
              <b>
                {p.name}
                {p.id === meId ? "（你）" : ""}
              </b>
              {targetId === p.id && <Check size={13} />}
            </button>
          ))}
      </div>
      {target && onCard && (
        <>
          <label className="field-label">选择身份牌</label>
          <div className="target-cards">
            {target.cards.map((card, i) => (
              <IdentityCard
                key={i}
                card={card}
                index={i}
                selectable={!hiddenOnly || !card.revealed}
                selected={cardIndex === i}
                onClick={() => onCard(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Game({
  room,
  syncEpoch,
  meId,
  busy,
  onAction,
  toast,
}: {
  room: RoomView;
  syncEpoch: number;
  meId: string;
  busy: boolean;
  onAction: (action: Action) => Promise<boolean>;
  toast: (message: string) => void;
}) {
  const game = room.game!;
  const players = room.players;
  const { theme } = useTheme();
  const tableRef = useRef<HTMLDivElement>(null);
  const gunPlayers = useMemo(
    () =>
      players.map(({ id, armed, aimingAt, alive }) => ({
        id,
        armed,
        aimingAt,
        alive,
      })),
    [players],
  );
  const me = players.find((p) => p.id === meId)!;
  const [mode, setMode] = useState<
    "investigate" | "arm" | "equip" | "aim" | "shoot" | null
  >(null);
  const [targetId, setTargetId] = useState("");
  const [cardIndex, setCardIndex] = useState<number | undefined>();
  const [equipment, setEquipment] = useState<EquipmentCard | null>(null);
  const [otherTargetId, setOtherTargetId] = useState("");
  const [otherCardIndex, setOtherCardIndex] = useState<number | undefined>();
  const [reactionCooldownUntil, setReactionCooldownUntil] = useState(0);
  const [showResult, setShowResult] = useState(true);
  const [now, setNow] = useState(Date.now());
  const isTurn = game.currentPlayerId === meId;
  const isAction =
    isTurn && game.phase === "action" && me.alive && room.status === "playing";
  const isAim =
    isTurn && game.phase === "aim" && me.alive && room.status === "playing";
  const isRedirect =
    game.phase === "redirect" && game.pendingShot?.shooterId === meId;
  const mustReveal =
    game.phase === "reveal" && game.pendingRevealPlayerId === meId;
  const mustInvestigate =
    game.phase === "investigation" && !!game.me.investigationTargets?.length;
  const pending = game.pendingShot;
  const active = players.find((p) => p.id === game.currentPlayerId);
  const hiddenCards = me.cards
    .map((c, i) => (!c.revealed ? i : -1))
    .filter((i) => i !== -1);
  const myEquipment = game.me.equipment || [];
  const latestInvestigation = game.logs
    .filter((entry) => entry.investigations?.length)
    .at(-1);
  const latestInvestigationId = latestInvestigation?.id;
  const lastLogId = game.logs.at(-1)?.id;
  const investigationSnapshot = {
    syncEpoch,
    id: latestInvestigationId,
    tailId: lastLogId,
  };
  const [investigationState, setInvestigationState] = useState(() =>
    investigationBaseline(investigationSnapshot),
  );
  const activeInvestigations = isInvestigationCueActive(
    investigationState,
    investigationSnapshot,
  )
    ? (latestInvestigation?.investigations ?? [])
    : [];
  useEffect(() => {
    setInvestigationState((previous) =>
      receiveInvestigationSnapshot(previous, {
        syncEpoch,
        id: latestInvestigationId,
        tailId: lastLogId,
      }),
    );
  }, [syncEpoch, latestInvestigationId, lastLogId]);
  useEffect(() => {
    const cue = investigationState.cue;
    if (!cue) return;
    const timer = window.setTimeout(
      () =>
        setInvestigationState((previous) =>
          previous.cue === cue ? { ...previous, cue: null } : previous,
        ),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [investigationState.cue]);
  const waitingPlayer = players.find((p) => p.id === room.waitingPlayerId);
  const offlineSeconds = waitingPlayer?.disconnectedAt
    ? Math.floor((now - waitingPlayer.disconnectedAt) / 1000)
    : 0;
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const container = logEnd.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [lastLogId]);
  useEffect(() => {
    setMode(null);
    setTargetId("");
    setCardIndex(undefined);
  }, [
    game.phase,
    game.currentPlayerId,
    game.turn,
    game.pendingRevealPlayerId,
    game.me.investigationTargets?.join(","),
  ]);
  useEffect(() => {
    if (equipment && !myEquipment.some((item) => item.id === equipment.id))
      setEquipment(null);
  }, [myEquipment, equipment]);
  useEffect(() => {
    if (room.status === "finished") setShowResult(true);
  }, [room.status]);
  const selectMode = (next: typeof mode) => {
    setMode(next);
    setTargetId("");
    setCardIndex(undefined);
  };
  const closeMode = useCallback(() => setMode(null), []);
  const closeEquipment = useCallback(() => setEquipment(null), []);
  const recentReaction = (playerId: string) =>
    room.emojis
      .filter(
        (e) =>
          e.playerId === playerId &&
          now - e.at < ((e.reactions?.length ?? 1) > 1 ? 6500 : 4000),
      )
      .at(-1);
  const sendReaction = async (
    ids: ReactionId[],
    requestId: string,
  ): Promise<boolean> => {
    if (
      busy ||
      !me.alive ||
      room.status !== "playing" ||
      Date.now() < reactionCooldownUntil
    )
      return false;
    const sent = await onAction({ type: "emoji", reactions: ids, requestId });
    if (sent) setReactionCooldownUntil(Date.now() + 2100);
    return sent;
  };
  function submitMode() {
    if (!mode) return;
    const action: Action = { type: mode };
    if (mode === "investigate" || mode === "aim") action.targetId = targetId;
    if (mode === "investigate") action.cardIndex = cardIndex;
    if (mode === "arm" || mode === "equip") action.revealIndex = cardIndex;
    onAction(action);
    setMode(null);
  }
  const modeReady =
    mode === "shoot" ||
    (mode === "aim" && !!targetId) ||
    (mode === "investigate" &&
      !!targetId &&
      cardIndex !== undefined &&
      !players.find((p) => p.id === targetId)?.cards[cardIndex].revealed) ||
    ((mode === "arm" || mode === "equip") &&
      (!hiddenCards.length || cardIndex !== undefined));
  const equipmentTimingAllowed =
    equipment &&
    !["equipment", "reveal", "investigation", "redirect"].includes(
      game.phase,
    ) &&
    (equipment.timing !== "reaction" || game.phase === "reaction") &&
    (equipment.timing !== "otherTurn" || !isTurn) &&
    (equipment.timing !== "ownTurn" ||
      (isTurn && ["action", "aim"].includes(game.phase)));
  const equipmentReady =
    equipmentTimingAllowed &&
    equipment &&
    (equipment.target === "none" ||
      (targetId &&
        (equipment.target === "player" ||
          (equipment.target === "card" && cardIndex !== undefined) ||
          (otherTargetId &&
            (equipment.target === "twoPlayers" ||
              (cardIndex !== undefined && otherCardIndex !== undefined))))));
  let instruction = `等待 ${active?.name || "玩家"} 行动`;
  let subInstruction = "观察局势，记住线索。你随时可以使用符合条件的装备。";
  if (isAction) {
    instruction = "轮到你了，选择一个行动";
    subInstruction = "调查、拿枪、拿装备，或向瞄准的人开枪。";
  }
  if (isAim) {
    instruction = me.armed
      ? "主行动已完成，选择瞄准对象"
      : "主行动已完成，结束你的回合";
    subInstruction = me.armed
      ? "你可以保持原目标，也可以把枪口转向其他人。"
      : "把行动权交给下一位玩家。";
  }
  if (game.phase === "equipment") {
    instruction = isTurn
      ? "从抽到的装备中选择一张"
      : `${active?.name} 正在选择装备`;
    subInstruction = "保留一张，其他装备放回牌堆。";
  }
  if (pending) {
    instruction = `${nameOf(players, pending.shooterId)} 向 ${nameOf(players, pending.targetId)} 开枪`;
    subInstruction = "反应窗口：现在可以使用适合的装备。";
  }
  if (game.phase === "reveal") {
    instruction = mustReveal
      ? "请选一张身份牌公开"
      : `等待 ${nameOf(players, game.pendingRevealPlayerId)} 公开身份`;
    subInstruction = "装备正在生效，完成身份选择后继续对局。";
  }
  if (game.phase === "investigation") {
    instruction = mustInvestigate
      ? "选择金属探测器的调查目标"
      : "正在进行装备调查";
    subInstruction = "调查每名持枪玩家的一张隐藏身份，结果仅使用者可见。";
  }
  if (game.phase === "redirect") {
    instruction = isRedirect
      ? "限制令生效，请重新选择射击目标"
      : `等待 ${nameOf(players, pending?.shooterId)} 重新瞄准`;
    subInstruction = "射手必须选择自己和原目标以外的存活玩家。";
  }
  if (!me.alive) {
    instruction = "你已出局，继续观察这场博弈";
    subInstruction = "你的身份已公开，等待这一局结束。";
  }
  if (room.status === "finished") {
    instruction = "本局行动结束";
    subInstruction = game.winner?.reason || "查看所有身份，复盘刚才的选择。";
  }
  return (
    <main className="game-layout">
      <section className="game-main">
        <div className="game-section-heading">
          <div>
            <span className="eyebrow">OPERATION IN PROGRESS</span>
            <h1>
              {room.status === "finished"
                ? "真相，浮出水面。"
                : "言语有真假，枪口有方向。"}
            </h1>
          </div>
          <div
            className="turn-counter"
            title={game.direction === 1 ? "顺时针轮转" : "逆时针轮转"}
          >
            <span>{game.direction === 1 ? "↻" : "↺"} 回合</span>
            <b>{String(game.turn).padStart(2, "0")}</b>
          </div>
        </div>
        {latestInvestigation && (
          <section
            className={`investigation-notice ${activeInvestigations.length ? "is-recent" : ""}`}
            aria-label="公开调查动态"
            aria-live="polite"
          >
            <div className="investigation-notice-heading">
              <Eye size={16} />
              <b>{activeInvestigations.length ? "刚刚调查" : "最近调查"}</b>
              <small>牌位公开 · 内容仅查看者可见</small>
            </div>
            <div className="investigation-events">
              {latestInvestigation.investigations?.map((event, index) => (
                <p key={`${latestInvestigation.id}-${index}`}>
                  <b>{nameOf(players, event.investigatorId)}</b> 查看了{" "}
                  <b>{nameOf(players, event.targetId)}</b> 的{" "}
                  <strong>{cardPositions(event.cardIndices)}</strong>
                </p>
              ))}
            </div>
          </section>
        )}
        <div ref={tableRef} className={`game-table players-${players.length}`}>
          <div className="table-lines" aria-hidden="true" />
          <div className="table-center">
            <div className="gun-rack" data-gun-rack aria-hidden="true" />
            <div className="gun-supply">
              <Crosshair size={13} />
              <span>枪械余量</span>
              <b>{game.gunSupply}</b>
            </div>
            {pending && game.phase === "reaction" && (
              <div className="shot-countdown">
                <Zap size={14} /> 射击反应 ·{" "}
                {Math.max(0, Math.ceil((pending.deadline - now) / 1000))}s
              </div>
            )}
          </div>
          <div className="players-ring">
            {players.map((player, i) => (
              <PlayerSeat
                key={player.id}
                player={player}
                index={i}
                currentId={game.currentPlayerId}
                myId={meId}
                players={players}
                plantedEvidence={
                  game.players.find((p) => p.id === player.id)?.plantedEvidence
                }
                reaction={recentReaction(player.id)}
                shotTarget={pending?.targetId}
                investigations={activeInvestigations}
              />
            ))}
          </div>
          <Suspense fallback={null}>
            <GunTable
              players={gunPlayers}
              gunSupply={game.gunSupply}
              syncKey={`${room.code}:${syncEpoch}`}
              theme={theme}
              tableRef={tableRef}
            />
          </Suspense>
        </div>
        <section className="my-dossier">
          <div className="dossier-heading">
            <h2>
              <Fingerprint size={19} /> 你的秘密档案
            </h2>
            <span className={`team-badge ${game.me.team}`}>
              {TEAM_NAMES[game.me.team] || "身份未定"}
            </span>
            <span className="private-label">
              <LockKeyhole size={11} /> 仅你可见
            </span>
          </div>
          {me.alive && me.wounded && (
            <div className="injury-notice" role="status">
              <HeartCrack size={21} />
              <span>
                <b>你已受伤</b>
                <small>再次中弹将被击败，请留意防御装备。</small>
              </span>
            </div>
          )}
          <div className="dossier-content">
            <div className="my-identities">
              {me.cards.map((card, i) => (
                <IdentityCard
                  key={i}
                  card={card}
                  index={i}
                  own
                  inspectionLabel={investigationLabel(
                    activeInvestigations,
                    players,
                    meId,
                    i,
                  )}
                />
              ))}
            </div>
            <div className="equipment-hand">
              <div className="equipment-heading">
                <span>
                  随身装备 <b>{myEquipment.length}</b>
                </span>
                <small>点击查看与使用</small>
              </div>
              {myEquipment.length ? (
                <div className="equipment-list">
                  {myEquipment.map((item) => (
                    <button
                      key={item.id}
                      className="equipment-card"
                      onClick={() => {
                        setEquipment(item);
                        setTargetId("");
                        setCardIndex(undefined);
                        setOtherTargetId("");
                        setOtherCardIndex(undefined);
                      }}
                      disabled={!me.alive || room.status === "finished"}
                    >
                      <span className="equipment-icon">
                        <Clipboard size={19} />
                      </span>
                      <span>
                        <b>{item.title}</b>
                        <small>{item.description}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-equipment">
                  <Clipboard size={22} strokeWidth={1} />
                  <span>
                    目前没有装备<small>在你的回合选择「拿装备」获得。</small>
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
      <aside className="game-sidebar">
        <section
          className={`action-panel ${isTurn && room.status === "playing" ? "your-turn" : ""} ${pending ? "reaction-panel" : ""}`}
        >
          <div className="action-label">
            <span className={`status-dot ${isTurn ? "" : "dim"}`} />
            {pending
              ? "REACTION WINDOW"
              : room.status === "finished"
                ? "CASE CLOSED"
                : isTurn
                  ? "YOUR TURN / 你的回合"
                  : "STAND BY / 观察局势"}
          </div>
          <h2>{instruction}</h2>
          <p>{subInstruction}</p>
          {room.status === "playing" && (
            <>
              <div className="action-buttons">
                <button
                  disabled={
                    !isAction ||
                    busy ||
                    !players.some(
                      (p) =>
                        p.id !== meId &&
                        p.alive &&
                        p.cards.some((c) => !c.revealed),
                    )
                  }
                  onClick={() => selectMode("investigate")}
                >
                  <Eye size={20} />
                  <span>
                    <b>调查身份</b>
                    <small>查看一张隐藏身份牌</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button
                  disabled={
                    !isAction || me.armed || game.gunSupply === 0 || busy
                  }
                  onClick={() => selectMode("arm")}
                >
                  <Crosshair size={20} />
                  <span>
                    <b>拿一把枪</b>
                    <small>
                      {me.armed
                        ? "你已经持有枪械"
                        : game.gunSupply === 0
                          ? "桌上已没有可用枪械"
                          : "公开身份牌，拿起枪"}
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button
                  disabled={!isAction || busy}
                  onClick={() => selectMode("equip")}
                >
                  <Clipboard size={20} />
                  <span>
                    <b>获取装备</b>
                    <small>公开身份牌，获得装备</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button
                  className="shoot-action"
                  disabled={!isAction || !me.armed || !me.aimingAt || busy}
                  onClick={() => selectMode("shoot")}
                >
                  <Zap size={20} />
                  <span>
                    <b>开枪射击</b>
                    <small>
                      {me.armed && me.aimingAt
                        ? `当前瞄准 ${nameOf(players, me.aimingAt)}`
                        : "需要持枪并已瞄准目标"}
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>
              {isRedirect && (
                <button
                  className="button primary full-width aim-button"
                  onClick={() => selectMode("aim")}
                  disabled={busy}
                >
                  <Crosshair size={17} /> 重新选择射击目标
                </button>
              )}
              {isAim &&
                (me.armed ? (
                  <button
                    className="button primary full-width aim-button"
                    onClick={() => selectMode("aim")}
                    disabled={busy}
                  >
                    <Crosshair size={17} /> 选择瞄准对象{" "}
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <button
                    className="button primary full-width aim-button"
                    onClick={() => onAction({ type: "endTurn" })}
                    disabled={busy}
                  >
                    结束回合 <ArrowRight size={17} />
                  </button>
                ))}
              {pending && game.phase === "reaction" && (
                <div className="reaction-note">
                  <HeartCrack size={17} />
                  <span>
                    剩余{" "}
                    {Math.max(0, Math.ceil((pending.deadline - now) / 1000))} 秒
                    · 查看你的装备
                  </span>
                </div>
              )}
            </>
          )}
          {room.status === "finished" && (
            <>
              <button
                className="button primary full-width"
                onClick={() => setShowResult(true)}
              >
                查看对局结果 <Flag size={16} />
              </button>
              {room.hostId === meId && (
                <button
                  className="button outline full-width rematch-button"
                  onClick={() => onAction({ type: "rematch" })}
                  disabled={busy}
                >
                  <RotateCcw size={16} /> 再来一局
                </button>
              )}
            </>
          )}
        </section>
        {room.hostId === meId &&
          waitingPlayer &&
          !waitingPlayer.connected &&
          waitingPlayer.disconnectedAt &&
          room.status === "playing" && (
            <div className="offline-wait">
              <p>
                {waitingPlayer.name} 已离线 {offlineSeconds} 秒
              </p>
              <button
                className="button outline full-width"
                disabled={busy || offlineSeconds < 60}
                onClick={() => onAction({ type: "skip" })}
              >
                {offlineSeconds < 60
                  ? `再等 ${60 - offlineSeconds} 秒可跳过等待`
                  : "跳过离线玩家的当前等待"}
              </button>
            </div>
          )}
        <section className="log-panel">
          <div className="panel-heading">
            <h2>
              <Radio size={16} /> 行动记录
            </h2>
            <span className="live-tag">LIVE</span>
          </div>
          <div
            className="game-logs"
            role="log"
            aria-label="公开行动记录"
            aria-live="polite"
          >
            {game.logs.map((log) => (
              <div
                className={`game-log ${log.investigations?.length ? "investigation-log" : ""}`}
                key={log.id}
              >
                {log.investigations?.length ? (
                  <Eye
                    size={12}
                    className="log-inspection-icon"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="log-dot" />
                )}
                <p>{log.text}</p>
                <time>
                  {new Date(log.at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </section>
        <ReactionPicker
          disabled={!me.alive || room.status === "finished"}
          disabledReason={
            room.status === "finished" ? "对局已结束" : "出局后请安静观战"
          }
          busy={busy}
          cooldown={now < reactionCooldownUntil}
          latest={recentReaction(meId)}
          onSend={sendReaction}
        />
      </aside>
      {mode && (
        <Modal
          title={
            mode === "investigate"
              ? "调查一张身份牌"
              : mode === "arm"
                ? "拿起你的枪"
                : mode === "equip"
                  ? "获取一件装备"
                  : mode === "aim"
                    ? "你的枪口，指向谁？"
                    : "确认开枪射击"
          }
          eyebrow="MAKE YOUR MOVE / 执行行动"
          onClose={closeMode}
        >
          {mode === "investigate" || mode === "aim" ? (
            <>
              <p className="modal-description">
                {mode === "investigate"
                  ? "选一张尚未公开的牌。所有人会看到你查看的牌位，牌面内容只有你能看到。"
                  : isRedirect
                    ? "限制令要求你选择另一名目标，随后重新进入射击反应窗口。"
                    : "瞄准结果会对全桌公开，选择后结束本回合。"}
              </p>
              <TargetPicker
                players={players}
                meId={meId}
                hiddenOnly={mode === "investigate"}
                eligibleIds={
                  isRedirect
                    ? players
                        .filter(
                          (p) =>
                            p.id !== pending?.targetId &&
                            p.id !== pending?.shooterId,
                        )
                        .map((p) => p.id)
                    : undefined
                }
                targetId={targetId}
                onTarget={(id) => {
                  setTargetId(id);
                  setCardIndex(undefined);
                }}
                cardIndex={cardIndex}
                onCard={mode === "investigate" ? setCardIndex : undefined}
              />
              {mode === "investigate" &&
                cardIndex !== undefined &&
                players.find((p) => p.id === targetId)?.cards[cardIndex]
                  .revealed && (
                  <p className="inline-error">
                    这张牌已公开，请选择其他身份牌。
                  </p>
                )}
            </>
          ) : mode === "arm" || mode === "equip" ? (
            <>
              <p className="modal-description">
                {hiddenCards.length
                  ? "作为行动代价，选择公开自己的一张身份牌。其他玩家将能看到它。"
                  : "你的身份牌已经全部公开，本次无需再公开身份。"}
              </p>
              <div className="target-cards">
                {me.cards.map((card, i) => (
                  <IdentityCard
                    key={i}
                    card={card}
                    index={i}
                    own
                    selectable={!card.revealed}
                    selected={cardIndex === i}
                    onClick={() => setCardIndex(i)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="shot-confirm">
              <Zap size={35} />
              <h3>射击 {nameOf(players, me.aimingAt)}</h3>
              <p>
                射击后进入反应窗口。其他人可能使用装备改变结果，请谨慎判断你的目标。
              </p>
            </div>
          )}
          <button
            className={`button ${mode === "shoot" ? "danger" : "primary"} full-width modal-confirm`}
            disabled={!modeReady || busy}
            onClick={submitMode}
          >
            {mode === "investigate"
              ? "确认调查"
              : mode === "arm"
                ? "公开并拿枪"
                : mode === "equip"
                  ? "公开并拿装备"
                  : mode === "aim"
                    ? isRedirect
                      ? "确认新的射击目标"
                      : "确认瞄准，结束回合"
                    : "确认射击"}
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {equipment && (
        <Modal
          title={equipment.title}
          eyebrow="TACTICAL EQUIPMENT / 战术装备"
          onClose={closeEquipment}
        >
          <div className="equipment-description">
            <Clipboard size={25} />
            <p>{equipment.description}</p>
          </div>
          {equipment.target !== "none" && (
            <TargetPicker
              players={players}
              meId={meId}
              hiddenOnly={equipment.kind === "wiretap"}
              allowSelf={
                ![
                  "blackmail",
                  "wiretap",
                  "polygraph",
                  "defibrillator",
                  "taser",
                ].includes(equipment.kind)
              }
              status={equipment.kind === "defibrillator" ? "dead" : "alive"}
              eligibleIds={
                ["k9Unit", "taser"].includes(equipment.kind)
                  ? players.filter((p) => p.armed).map((p) => p.id)
                  : equipment.kind === "evidenceBag"
                    ? players
                        .filter((p) => p.equipmentCount > 0 && p.id !== meId)
                        .map((p) => p.id)
                    : equipment.kind === "truthSerum"
                      ? players
                          .filter((p) => p.cards.some((c) => !c.revealed))
                          .map((p) => p.id)
                      : undefined
              }
              targetId={targetId}
              onTarget={(id) => {
                setTargetId(id);
                setCardIndex(undefined);
              }}
              cardIndex={cardIndex}
              onCard={
                equipment.target === "card" || equipment.target === "twoCards"
                  ? setCardIndex
                  : undefined
              }
              otherTargetId={otherTargetId}
            />
          )}{" "}
          {(equipment.target === "twoPlayers" ||
            equipment.target === "twoCards") && (
            <TargetPicker
              players={players}
              meId={meId}
              hiddenOnly={equipment.kind === "wiretap"}
              allowSelf={false}
              targetId={otherTargetId}
              onTarget={(id) => {
                setOtherTargetId(id);
                setOtherCardIndex(undefined);
              }}
              cardIndex={otherCardIndex}
              onCard={
                equipment.target === "twoCards" ? setOtherCardIndex : undefined
              }
              otherTargetId={targetId}
              heading="选择另一位玩家"
            />
          )}
          <button
            className="button primary full-width modal-confirm"
            disabled={!equipmentReady || busy}
            onClick={() => {
              onAction({
                type: "useEquipment",
                cardId: equipment.id,
                targetId: targetId || undefined,
                cardIndex,
                otherTargetId: otherTargetId || undefined,
                otherCardIndex,
              });
            }}
          >
            使用装备 <Sparkles size={17} />
          </button>
          <p className="equipment-use-note">
            {!equipmentTimingAllowed
              ? equipment.timing === "reaction"
                ? "这张装备需要在射击反应窗口使用。"
                : equipment.timing === "otherTurn" && isTurn
                  ? "这张装备需要在其他玩家回合使用。"
                  : equipment.timing === "ownTurn" && !isTurn
                    ? "这张装备需要在自己的回合使用。"
                    : "请等待当前装备效果结算完成。"
              : "使用时机与目标由服务器检查，不符合条件时不会消耗装备。"}
          </p>
        </Modal>
      )}
      {mustReveal && (
        <Modal
          title="选择一张身份牌公开"
          eyebrow="EQUIPMENT EFFECT / 装备效果"
          onClose={() => toast("请先选择公开一张身份牌。")}
        >
          <p className="modal-description">
            装备要求你公开一张隐藏身份。由你决定公开哪一张，所有玩家都会看到它。
          </p>
          <div className="target-cards">
            {me.cards.map((card, i) => (
              <IdentityCard
                key={i}
                card={card}
                index={i}
                own
                selectable={!card.revealed}
                selected={cardIndex === i}
                onClick={() => setCardIndex(i)}
              />
            ))}
          </div>
          <button
            className="button primary full-width modal-confirm"
            disabled={
              busy || cardIndex === undefined || me.cards[cardIndex]?.revealed
            }
            onClick={() => onAction({ type: "chooseReveal", cardIndex })}
          >
            公开这张身份牌 <Eye size={17} />
          </button>
        </Modal>
      )}
      {mustInvestigate && (
        <Modal
          title="调查持枪玩家的身份"
          eyebrow="METAL DETECTOR / 金属探测器"
          onClose={() => toast("请先完成金属探测器的调查。")}
        >
          <p className="modal-description">
            还需调查 {game.me.investigationTargets?.length}{" "}
            人。选择一位目标的一张隐藏身份，结果仅你可见。
          </p>
          <TargetPicker
            players={players}
            meId={meId}
            hiddenOnly
            eligibleIds={game.me.investigationTargets}
            targetId={targetId}
            onTarget={(id) => {
              setTargetId(id);
              setCardIndex(undefined);
            }}
            cardIndex={cardIndex}
            onCard={setCardIndex}
          />
          <button
            className="button primary full-width modal-confirm"
            disabled={
              busy ||
              !targetId ||
              cardIndex === undefined ||
              !!players.find((p) => p.id === targetId)?.cards[cardIndex]
                ?.revealed
            }
            onClick={() =>
              onAction({ type: "chooseInvestigation", targetId, cardIndex })
            }
          >
            确认调查 <Eye size={17} />
          </button>
        </Modal>
      )}
      {game.me.equipmentChoices?.length ? (
        <Modal
          title="选择你要保留的装备"
          eyebrow="EQUIPMENT DRAW / 装备补给"
          onClose={() => toast("请先选择一张装备，才能继续回合。")}
        >
          <p className="modal-description">
            保留其中一张，仔细阅读效果后做出选择。
          </p>
          <div className="equipment-choices">
            {game.me.equipmentChoices.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() =>
                  onAction({ type: "chooseEquipment", cardId: item.id })
                }
              >
                <Clipboard size={27} />
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <span>
                  保留这张 <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
      {room.status === "finished" && game.winner && showResult && (
        <Modal
          title={`${TEAM_NAMES[game.winner.team] || "本局"}胜利`}
          eyebrow="CASE CLOSED / 真相大白"
          onClose={() => setShowResult(false)}
          className="result-modal"
        >
          <div className={`victory-emblem ${game.winner.team}`}>
            <ShieldCheck size={52} strokeWidth={1} />
          </div>
          <p className="result-reason">{game.winner.reason}</p>
          <div className="result-roster">
            {players.map((player) => (
              <div key={player.id}>
                <span className="result-avatar">{player.avatar}</span>
                <b>
                  {player.name}
                  {player.id === meId && <small>你</small>}
                </b>
                <span className="result-identities">
                  {player.cards.map((card, i) => (
                    <span
                      key={i}
                      className={
                        card.value ? IDENTITY[card.value].className : ""
                      }
                    >
                      {card.value ? IDENTITY[card.value].name : "?"}
                    </span>
                  ))}
                </span>
                {!player.alive && <Skull size={14} />}
              </div>
            ))}
          </div>
          {room.hostId === meId ? (
            <button
              className="button primary full-width"
              onClick={() => {
                setShowResult(false);
                onAction({ type: "rematch" });
              }}
              disabled={busy}
            >
              <RotateCcw size={17} /> 再来一局
            </button>
          ) : (
            <p className="start-hint">等待房主开启下一局。</p>
          )}
          <button
            className="text-button result-close"
            onClick={() => setShowResult(false)}
          >
            返回牌桌，看看行动记录 <ArrowRight size={14} />
          </button>
        </Modal>
      )}
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [{ room, syncEpoch }, setRoomSnapshot] = useState<{
    room: RoomView | null;
    syncEpoch: number;
  }>({ room: null, syncEpoch: 0 });
  const setRoom = useCallback((next: RoomView | null) => {
    setRoomSnapshot((previous) => ({ ...previous, room: next }));
  }, []);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!session);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [rules, setRules] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notification, setNotification] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const roomRef = useRef(room);
  roomRef.current = room;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [room?.code, room?.status]);
  const toast = useCallback((text: string) => {
    setNotification({ id: Date.now(), text });
    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotification(null), 5000);
  }, []);
  const closeRules = useCallback(() => setRules(false), []);
  const closeLeaving = useCallback(() => setLeaving(false), []);
  const updateRoom = useCallback((next: RoomView, restored = false) => {
    setRoomSnapshot((previous) => {
      if (
        previous.room?.code === next.code &&
        next.revision < previous.room.revision
      ) {
        return previous;
      }
      return {
        room: next,
        syncEpoch: previous.syncEpoch + (restored ? 1 : 0),
      };
    });
  }, []);
  const saveSession = useCallback((next: Session | null) => {
    setSession(next);
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false,
      socket: WebSocket | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      attempts = 0;
    const connect = () => {
      if (cancelled) return;
      setConnection(attempts ? "reconnecting" : "connecting");
      socket = new WebSocket(
        `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`,
      );
      let awaitingSnapshot = true;
      socket.onopen = () => {
        attempts = 0;
        setConnection("connected");
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            code: session.code,
            token: session.token,
          }),
        );
      };
      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "room" && message.room) {
            updateRoom(message.room, awaitingSnapshot);
            awaitingSnapshot = false;
            setLoading(false);
          } else if (message.type === "removed") {
            cancelled = true;
            clearTimeout(timer);
            socket?.close();
            saveSession(null);
            setRoom(null);
            setLoading(false);
            setLeaving(false);
            window.history.replaceState({}, "", window.location.pathname);
            toast(message.error || "你已离开房间");
          } else if (message.type === "error") {
            toast(message.error || "房间连接失败");
          }
        } catch {
          /* Ignore unknown websocket messages. */
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setConnection("reconnecting");
        attempts += 1;
        timer = setTimeout(
          connect,
          Math.min(15000, 800 * 2 ** Math.min(attempts, 5)),
        );
      };
      socket.onerror = () => socket?.close();
    };
    setLoading(true);
    fetch(`/api/rooms/${encodeURIComponent(session.code)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          if ([401, 403, 404, 410].includes(response.status)) {
            saveSession(null);
            setRoom(null);
            toast(data.error || "房间已失效，请重新加入。");
          } else {
            toast(data.error || "无法恢复房间，请稍后重试。");
          }
          setLoading(false);
          return;
        }
        updateRoom(data.room, true);
        setLoading(false);
        connect();
      })
      .catch(() => {
        if (!cancelled) {
          toast("无法连接服务器，正在尝试重新连接。");
          setLoading(false);
          connect();
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [session, saveSession, toast, updateRoom]);
  async function enter(
    name: string,
    avatar: string,
    capacity: number,
    code?: string,
  ) {
    setBusy(true);
    try {
      const response = await fetch(
        code ? `/api/rooms/${encodeURIComponent(code)}/join` : "/api/rooms",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            code ? { name, avatar } : { name, avatar, capacity },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "进入房间失败，请重试");
      saveSession({
        code: data.room.code,
        token: data.token,
        playerId: data.playerId,
      });
      setRoom(data.room);
      window.history.replaceState({}, "", `?room=${data.room.code}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "网络暂时不可用，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function action(payload: Action): Promise<boolean> {
    if (!session || !roomRef.current || busy) return false;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(session.code)}/action`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            ...payload,
            requestId: payload.requestId ?? crypto.randomUUID(),
            expectedRevision: roomRef.current.revision,
          }),
        },
      );
      const data = await response.json();
      if (data.room) updateRoom(data.room, response.status === 409);
      if (response.status === 409) {
        const latest = await fetch(
          `/api/rooms/${encodeURIComponent(session.code)}`,
          { headers: { Authorization: `Bearer ${session.token}` } },
        );
        if (latest.ok) {
          const fresh = await latest.json();
          updateRoom(fresh.room, true);
        }
      }
      if (!response.ok) throw new Error(data.error || "行动未完成");
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "连接中断，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    if (!session) return;
    if (room?.status === "playing") {
      setSession(null);
      setRoom(null);
      setLeaving(false);
      setLoading(false);
      toast("座位已保留。刷新页面即可重新回到牌桌。");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(session.code)}/action`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            type: "leave",
            requestId: crypto.randomUUID(),
            expectedRevision: roomRef.current?.revision,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "离开失败，请重试");
      saveSession(null);
      setRoom(null);
      setLeaving(false);
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "无法连接服务器，请稍后重试",
      );
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!room) return;
    const link = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(`邀请链接已复制 · 房间 ${room.code}`);
    } catch {
      toast(`房间码：${room.code}，请复制地址栏链接分享。`);
    }
  }
  return (
    <>
      <AmbientBackground />
      {!session ? (
        <Home
          onEnter={enter}
          busy={busy}
          onRules={() => setRules(true)}
          onResume={
            initialSession()
              ? () => {
                  setSession(initialSession());
                  setLoading(true);
                }
              : undefined
          }
        />
      ) : loading || !room ? (
        <div className="loading-screen">
          <Brand />
          <ThemeToggle />
          <LoaderCircle className="spin" size={29} />
          <h2>{loading ? "正在回到你的牌桌" : "正在恢复房间连接"}</h2>
          <p>请稍等，正在与服务器同步最新状态。</p>
          <button
            className="text-button"
            onClick={() => {
              saveSession(null);
              setRoom(null);
              setLoading(false);
            }}
          >
            返回首页 <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="room-app">
          <TableHeader
            room={room}
            connection={connection}
            onRules={() => setRules(true)}
            onLeave={() => setLeaving(true)}
            onShare={share}
          />
          {connection !== "connected" && (
            <div className="connection-banner">
              <LoaderCircle className="spin" size={14} />{" "}
              正在恢复实时连接，重连后将同步最新状态。
            </div>
          )}
          {room.status === "waiting" ? (
            <Lobby
              room={room}
              meId={session.playerId}
              busy={busy || connection !== "connected"}
              onAction={action}
              onShare={share}
            />
          ) : (
            <Game
              room={room}
              syncEpoch={syncEpoch}
              meId={session.playerId}
              busy={busy || connection !== "connected"}
              onAction={action}
              toast={toast}
            />
          )}
        </div>
      )}
      {rules && <Rules onClose={closeRules} />}{" "}
      {leaving && (
        <Modal
          title="离开当前房间？"
          eyebrow="LEAVE THE TABLE"
          onClose={closeLeaving}
        >
          <p className="modal-description">
            {room?.status === "playing"
              ? "对局会保留你的座位和重连凭据。你将返回首页，刷新页面即可回到原来的牌桌。"
              : "离开后会释放你的座位，你可以通过房间码重新加入。"}
          </p>
          <div className="modal-button-row">
            <button className="button outline" onClick={closeLeaving}>
              留在牌桌
            </button>
            <button className="button danger" disabled={busy} onClick={leave}>
              {room?.status === "playing" ? "暂时离桌" : "确认离开"}{" "}
              <DoorOpen size={16} />
            </button>
          </div>
        </Modal>
      )}
      {notification && (
        <div className="toast" role="status" key={notification.id}>
          <Info size={17} />
          <span>{notification.text}</span>
          <button aria-label="关闭提示" onClick={() => setNotification(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
