import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Radio, X } from "lucide-react";
import { REACTIONS, getReaction, type ReactionId } from "../shared/reactions";
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
  const reaction = getReaction(event.emoji);
  if (!reaction) return null;
  return (
    <span
      className="reaction-bubble"
      data-tone={reaction.tone}
      data-reaction={reaction.id}
      role="status"
      aria-label={`${sender} 发出表情：${reaction.label}`}
    >
      <ReactionGlyph id={reaction.id} />
      <span>{reaction.label}</span>
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
  onSend: (id: ReactionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
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
  const latestReaction = latest && getReaction(latest.emoji);

  useEffect(() => {
    if (disabled) setOpen(false);
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
              <p>表达判断，不代表真实身份</p>
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
                      aria-label={`发送表情：${reaction.label}`}
                      disabled={disabled || cooldown || busy}
                      onClick={() => onSend(reaction.id)}
                    >
                      <ReactionGlyph id={reaction.id} />
                      <span>{reaction.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="reaction-panel-status" role="status">
            {cooldown ? "稍等一下，每 2 秒可发送一次" : "点击即发送，全桌可见"}
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
          : latestReaction
            ? `已发送「${latestReaction.label}」· 全桌可见`
            : "编号、判断、行动，用信号交流"}
      </span>
    </div>
  );
}
