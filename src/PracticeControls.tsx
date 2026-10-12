import {
  ArrowRight,
  Check,
  FlaskConical,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import type { RoomView } from "../shared/room";
import "./practice.css";

interface PracticeControlsProps {
  room: RoomView;
  busy: boolean;
  onAction: (
    action: Record<string, unknown> & { type: string },
  ) => Promise<boolean>;
}

export default function PracticeControls({
  room,
  busy,
  onAction,
}: PracticeControlsProps) {
  const practice = room.practice;
  if (!practice) return null;

  const finished = room.status === "finished";
  const resolvingShot = room.game?.phase === "reaction";
  const waitingIndex = room.players.findIndex(
    (player) => player.id === room.waitingPlayerId,
  );
  const waitingPlayer = room.players[waitingIndex];
  const waitingIsActive = waitingPlayer?.id === practice.activePlayerId;
  const canStep = !busy && !finished && !resolvingShot && Boolean(room.game);

  return (
    <section
      className="practice-controls"
      aria-label="单人测试工具"
      aria-busy={busy}
    >
      <div className="practice-heading">
        <span className="practice-badge">
          <FlaskConical size={13} aria-hidden="true" />
          单人测试
        </span>
        <p>当前只显示所选座位能看到的情报</p>
      </div>

      <div className="practice-seats" role="group" aria-label="切换查看座位">
        {room.players.map((player, index) => (
          <button
            type="button"
            key={player.id}
            className="practice-seat"
            aria-pressed={player.id === practice.activePlayerId}
            aria-label={`${index + 1}号 ${player.name}${player.alive ? "" : "，已出局"}`}
            title={player.name}
            disabled={busy}
            data-alive={player.alive}
            onClick={() => {
              if (player.id !== practice.activePlayerId) {
                void onAction({ type: "practiceSwitch", playerId: player.id });
              }
            }}
          >
            <span className="practice-seat-number">{index + 1}</span>
            <span className="practice-seat-name">{player.name}</span>
            {!player.alive && <small>出局</small>}
          </button>
        ))}
      </div>

      <div className="practice-footer">
        <div className="practice-waiting">
          <span className="practice-waiting-status" role="status">
            {finished
              ? "本局已结束，可切换座位复盘"
              : resolvingShot
                ? "射击结算中"
                : waitingPlayer
                  ? `${waitingIndex + 1}号 ${waitingPlayer.name} 待操作${waitingIsActive ? " · 当前座位" : ""}`
                  : "等待对局开始"}
          </span>
          {!finished && waitingPlayer && !waitingIsActive && (
            <button
              type="button"
              className="practice-jump"
              disabled={busy}
              onClick={() =>
                void onAction({
                  type: "practiceSwitch",
                  playerId: waitingPlayer.id,
                })
              }
            >
              切到待操作玩家
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="practice-actions">
          <button
            type="button"
            className="practice-auto"
            aria-pressed={practice.autoplay}
            disabled={busy || finished}
            onClick={() =>
              void onAction({
                type: "practiceAuto",
                enabled: !practice.autoplay,
              })
            }
          >
            <span className="practice-auto-check" aria-hidden="true">
              {practice.autoplay && <Check size={11} />}
            </span>
            自动推进其他玩家
          </button>
          <button
            type="button"
            className="practice-action"
            disabled={!canStep}
            title={resolvingShot ? "射击结算中" : undefined}
            onClick={() => void onAction({ type: "practiceStep" })}
          >
            <SkipForward size={13} aria-hidden="true" />
            代走一步
          </button>
          <button
            type="button"
            className="practice-action"
            disabled={busy}
            onClick={() => void onAction({ type: "practiceReset" })}
          >
            <RotateCcw size={13} aria-hidden="true" />
            重新开局
          </button>
        </div>
      </div>
    </section>
  );
}
