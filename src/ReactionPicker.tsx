import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, Radio, Send, X } from "lucide-react";
import {
  REACTIONS,
  MAX_REACTION_PARTS,
  getReaction,
  getEventReactions,
  type ReactionId,
} from "../shared/reactions";
import type { RoomView } from "../shared/room";
import { ReactionGlyph } from "./ReactionGlyph";
import "./reactions.css";

const GROUPS = [
  { id: "seat", label: "玩家编号", hint: "你说的是谁" },
  { id: "card", label: "卡牌位置", hint: "三张身份牌" },
  { id: "role", label: "身份判断", hint: "亮明你的看法" },
  { id: "action", label: "行动提示", hint: "传达下一步" },
  { id: "interaction", label: "情绪互动", hint: "一点态度" },
] as const;

type ReactionEvent = RoomView["emojis"][number];

export function ReactionBubble({
  event,
  sender,
}: {
  event: ReactionEvent;
  sender: string;
}) {
  const reactions = getEventReactions(event);
  if (!reactions.length) return null;
  const combined = reactions.length > 1;
  return (
    <span
      className="reaction-bubble"
      data-tone={combined ? "neutral" : reactions[0].tone}
      data-reaction={reactions.map((reaction) => reaction.id).join("+")}
      data-combined={combined}
      role="status"
      aria-label={`${sender} 发出信号：${reactions.map((reaction) => reaction.label).join("＋")}`}
    >
      {combined ? (
        reactions.map((reaction, index) => (
          <Fragment key={reaction.id}>
            {index > 0 && (
              <span className="reaction-separator" aria-hidden="true">
                ＋
              </span>
            )}
            <span className="reaction-bubble-part" data-tone={reaction.tone}>
              <ReactionGlyph id={reaction.id} />
              <span>{reaction.label}</span>
            </span>
          </Fragment>
        ))
      ) : (
        <>
          <ReactionGlyph id={reactions[0].id} />
          <span>{reactions[0].label}</span>
        </>
      )}
    </span>
  );
}

export default function ReactionPicker({
  disabled,
  disabledReason,
  busy,
  cooldown,
  latest,
  onSend,
}: {
  disabled: boolean;
  disabledReason: string;
  busy: boolean;
  cooldown: boolean;
  latest?: ReactionEvent;
  onSend: (ids: ReactionId[], requestId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [selection, setSelection] = useState<ReactionId[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const requestId = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 16,
    top: 16,
    maxHeight: 740,
  });
  const panelId = useId();
  const latestReactions = latest ? getEventReactions(latest) : [];

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setSelection([]);
      requestId.current = null;
    }
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const maxHeight = Math.min(740, window.innerHeight - 32);
      const width = panel.current.offsetWidth;
      const height = Math.min(panel.current.scrollHeight + 2, maxHeight);
      setPosition({
        left: Math.max(
          16,
          Math.min(anchor.right - width, window.innerWidth - width - 16),
        ),
        top: Math.max(
          16,
          Math.min(anchor.top - height - 12, window.innerHeight - height - 16),
        ),
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function toggle(id: ReactionId) {
    if (disabled || sendingRef.current) return;
    requestId.current = null;
    setSelection((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < MAX_REACTION_PARTS
          ? [...current, id]
          : current,
    );
  }

  function clear() {
    if (sendingRef.current) return;
    requestId.current = null;
    setSelection([]);
  }

  async function send() {
    if (!selection.length || disabled || busy || cooldown || sendingRef.current)
      return;
    sendingRef.current = true;
    setSending(true);
    try {
      // Keep the same ID after a lost response so retry cannot duplicate a send.
      requestId.current ??= crypto.randomUUID();
      if (await onSend([...selection], requestId.current)) {
        requestId.current = null;
        setSelection([]);
        close();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div
      className="reaction-area"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      {open && (
        <div
          className="reaction-picker-panel"
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="表情与信号"
          style={{
            ...position,
            ...(keyboardOpen ? { transition: "none" } : {}),
          }}
        >
          <div className="reaction-panel-header">
            <div>
              <h3>表情与信号</h3>
              <p>最多组合 {MAX_REACTION_PARTS} 个 · 表达判断，不验证身份</p>
            </div>
            <button
              ref={closeButton}
              className="reaction-panel-close"
              aria-label="关闭表情面板"
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>
          <div className="reaction-groups">
            {GROUPS.map((group) => (
              <section
                className="reaction-group"
                data-group={group.id}
                key={group.id}
                aria-label={group.label}
              >
                <div className="reaction-group-heading">
                  <h4>{group.label}</h4>
                  <span>{group.hint}</span>
                </div>
                <div className="reaction-grid">
                  {REACTIONS.filter(
                    (reaction) => reaction.group === group.id,
                  ).map((reaction) => (
                    <button
                      key={reaction.id}
                      className="reaction-button"
                      data-tone={reaction.tone}
                      data-reaction={reaction.id}
                      aria-label={`选择信号：${reaction.label}`}
                      aria-pressed={selection.includes(reaction.id)}
                      disabled={
                        disabled ||
                        sending ||
                        (selection.length >= MAX_REACTION_PARTS &&
                          !selection.includes(reaction.id))
                      }
                      onClick={() => toggle(reaction.id)}
                    >
                      <ReactionGlyph id={reaction.id} />
                      <span>{reaction.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="reaction-composer">
            <div className="reaction-draft-heading">
              <span>
                待发送 {selection.length}/{MAX_REACTION_PARTS}
              </span>
              <button
                className="reaction-clear"
                disabled={!selection.length || sending}
                onClick={clear}
              >
                清空
              </button>
            </div>
            <div
              className="reaction-draft"
              aria-label="组合预览"
              aria-live="polite"
            >
              {selection.length ? (
                selection.map((id, index) => {
                  const reaction = getReaction(id)!;
                  return (
                    <Fragment key={id}>
                      {index > 0 && (
                        <span className="reaction-separator" aria-hidden="true">
                          ＋
                        </span>
                      )}
                      <button
                        className="reaction-draft-token"
                        data-tone={reaction.tone}
                        aria-label={`移除信号：${reaction.label}`}
                        disabled={sending}
                        onClick={() => toggle(id)}
                      >
                        <ReactionGlyph id={id} />
                        <span>{reaction.label}</span>
                        <X size={10} aria-hidden="true" />
                      </button>
                    </Fragment>
                  );
                })
              ) : (
                <span className="reaction-draft-empty">
                  例如：3号 ＋ 左 ＋ 好人
                </span>
              )}
            </div>
            <div className="reaction-compose-actions">
              <span className="reaction-compose-hint" role="status">
                {cooldown ? "稍等一下，每 2 秒发一组" : "选择后发送，全桌可见"}
              </span>
              <button
                className="reaction-send"
                disabled={
                  !selection.length || disabled || busy || cooldown || sending
                }
                onClick={() => void send()}
              >
                <Send size={13} />
                <span>{sending ? "发送中…" : "发送"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        className="reaction-toggle"
        ref={trigger}
        onClick={(event) => {
          setKeyboardOpen(event.detail === 0);
          setOpen(!open);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
      >
        <Radio size={18} />
        <span>表情与信号</span>
        <ChevronDown size={15} />
      </button>
      <span className="reaction-picker-note" aria-live="polite">
        {disabled
          ? disabledReason
          : latestReactions.length
            ? `已发送「${latestReactions.map((reaction) => reaction.label).join("＋")}」· 全桌可见`
            : "选好编号、卡位和判断，一起发送"}
      </span>
    </div>
  );
}
