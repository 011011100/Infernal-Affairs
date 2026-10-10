import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  Crosshair,
  Eye,
  Fingerprint,
  HeartCrack,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Shield,
  ShieldCheck,
  Skull,
} from "lucide-react";
import "./rule-demo.css";

type DemoKind = "identity" | "turn" | "investigation" | "shooting" | "exchange";
type Face = "honest" | "crooked" | "agent" | "kingpin";
type Viewpoint = "observer" | "investigator";
type ShotExample = "ordinary" | "leader" | "wounded";
type Step = { title: string; description: string };

const CARD_LABELS: Record<Face, string> = {
  honest: "忠诚",
  crooked: "变节",
  agent: "探长",
  kingpin: "主谋",
};
const TITLES: Record<DemoKind, string> = {
  identity: "三张牌，怎样决定阵营？",
  turn: "从拿枪到射击，要跨过一个回合",
  investigation: "牌位全桌可见，牌面仍然保密",
  shooting: "宣告射击之后，还没有立即中枪",
  exchange: "牌换了，首领与伤势也会跟着走",
};
const STEPS: Record<Exclude<DemoKind, "shooting">, Step[]> = {
  identity: [
    {
      title: "每人三张身份，先看自己的牌",
      description:
        "你的三张身份牌仅自己可见。这里先从普通身份的例子开始；点击下一步，看看它们怎样决定阵营。",
    },
    {
      title: "没有首领牌，就按普通牌多数判断",
      description:
        "两张忠诚、一张变节，因此属于忠诚警察。反过来，两张变节、一张忠诚，就属于变节警察。",
    },
    {
      title: "换一个例子：首领身份优先",
      description:
        "即使另外两张都是变节，只要持有探长牌，仍然属于忠诚警察。持有主谋牌时，则属于变节警察。",
    },
    {
      title: "特殊例子：一人同时持有两张首领牌",
      description:
        "若在对局中通过换牌同时获得探长和主谋，该玩家立即独自获胜。开局时两张首领牌会分给不同玩家。",
    },
  ],
  turn: [
    {
      title: "轮到你，只做一个主行动",
      description:
        "调查、拿枪、拿装备、开枪，四选一；行动必须满足对应条件。白夜这一次准备选择拿枪。装备的使用另按装备说明处理。",
    },
    {
      title: "选择拿枪：先公开自己一张牌",
      description:
        "白夜公开第 1 张变节牌，从公共区拿一把枪。这已经用掉本回合的主行动，不能紧接着再开枪。若自己的牌都已公开，则无需再翻牌。",
    },
    {
      title: "持枪行动结束，选择瞄准对象",
      description:
        "白夜把枪口指向阿影。瞄准关系对全桌公开；确认瞄准后，本回合结束。此时只是瞄准，还没有射击。",
    },
    {
      title: "等待其他玩家依次行动",
      description:
        "枪和瞄准对象会保留，但其他人可能使用装备改变局势。轮到别人时，白夜不能直接把开枪当作自己的主行动。",
    },
    {
      title: "再次轮到白夜，才可以选择射击",
      description:
        "如果白夜仍持有枪，且瞄准的目标仍存活，便可把开枪作为新的主行动。这是下一次自己的回合，不是拿枪回合的第二个行动。",
    },
  ],
  investigation: [
    {
      title: "白夜想知道阿影的身份",
      description:
        "阿影的三张牌尚未公开。这里展示的是教学样本；切换视角，可以比较旁观者和调查者分别能看到什么。",
    },
    {
      title: "选择阿影的第 2 张身份牌",
      description:
        "白夜选定目标和牌位。调查发生后，全桌都能看到“白夜查看了阿影的第 2 张身份牌”，包括阿影自己。",
    },
    {
      title: "调查结果是私人信息",
      description:
        "旁观者仍只见问号；切到白夜视角，才会看见调查到的牌面。阿影原本就知道自己的牌，调查没有把身份公开给其他人。",
    },
    {
      title: "醒目标记消退，公开记录仍保留",
      description:
        "后续行动或提示时间结束后，牌位高亮消失，记录仍可查看。换牌后知识跟随原牌；闪光弹使旧身份情报失效，历史动作记录仍然保留。",
    },
  ],
  exchange: [
    {
      title: "白夜使用勒索，目标必须是另外两人",
      description:
        "教学中展示完整牌面以便理解：阿影持有受伤的探长牌和两张变节牌；小林持有两张忠诚、一张变节。白夜不能把自己选为勒索目标。",
    },
    {
      title: "各选一张牌，不是交换整副身份",
      description:
        "白夜选择阿影的第 3 张探长牌，以及小林的第 3 张变节牌。两人都必须存活；被选中的牌可以是明牌，也可以是暗牌。",
    },
    {
      title: "两张实体身份牌交换位置",
      description:
        "交换的是身份牌本身。原来的明暗状态和首领牌上的伤势标记都随牌移动，不会因为换到另一个人手里而重置。",
    },
    {
      title: "伤势随探长牌移到小林",
      description:
        "小林得到的探长牌仍然受伤，之后若中枪会被击败。阿影不再持有这张首领牌，也不再承接它的伤势。",
    },
    {
      title: "按交换后的三张牌重新判断阵营",
      description:
        "阿影现在是三张变节，转入变节警察阵营；小林持有探长，成为忠诚警察首领。此前知道某张牌的人仍认得原牌，换牌不等于失忆。",
    },
  ],
};

function shootingSteps(example: ShotExample): Step[] {
  const ending =
    example === "ordinary"
      ? {
          title: "普通玩家中枪：公开身份并出局",
          description:
            "若没有装备改变结果，阿影的三张身份全部公开，普通玩家直接出局。射手的枪归还公共区；目标若持枪，也会放下枪。",
        }
      : example === "leader"
        ? {
            title: "未受伤的首领第一次中枪：受伤存活",
            description:
              "阿影的三张牌全部公开，探长牌留下伤势标记，并获得一张装备；若手牌超出一张，先择留。射手的枪归还公共区。",
          }
        : {
            title: "已受伤的首领再次中枪：被击败",
            description:
              "这个例子从之前已经受伤的探长开始；现在是另一次射击。探长被击败，变节警察获胜，并非同一回合连开两枪。",
          };
  return [
    {
      title: "射击前，已经持枪并瞄准",
      description:
        "白夜在自己的行动阶段，持有一把枪，且枪口已指向存活的阿影。这里用三个独立例子比较结算结果。",
    },
    {
      title: "宣告射击，不立即结算伤害",
      description:
        "白夜选择开枪，全桌得知射手与目标。宣告后进入装备响应阶段，暂时还不能判断阿影是否会中枪。",
    },
    {
      title: "真实对局有 6 秒装备响应窗口",
      description:
        "玩家可以使用符合时机的装备，例如限制令让射手重选另一目标，警犬让射手放下枪。教学暂停在这个窗口，不把演示播放速度当作真实倒计时。",
    },
    ending,
  ];
}

function DemoCard({
  value = "honest",
  faceUp = false,
  selected = false,
  injured = false,
  index,
  publicCard = false,
  movingClass = "",
}: {
  value?: Face;
  faceUp?: boolean;
  selected?: boolean;
  injured?: boolean;
  index: number;
  publicCard?: boolean;
  movingClass?: string;
}) {
  const leader = value === "agent" || value === "kingpin";
  return (
    <div className={`rd-card ${selected ? "is-selected" : ""} ${movingClass}`}>
      <div className={`rd-card-flipper ${faceUp ? "is-face-up" : ""}`}>
        <div className="rd-card-side rd-card-back">
          <span className="rd-card-index">{index + 1}</span>
          <Shield size={21} strokeWidth={1.1} />
          <b>?</b>
        </div>
        <div className={`rd-card-side rd-card-front rd-face-${value}`}>
          <span className="rd-card-index">{index + 1}</span>
          <span className="rd-card-face-content" key={value}>
            {leader ? (
              <ShieldCheck size={21} strokeWidth={1.3} />
            ) : (
              <Fingerprint size={21} strokeWidth={1.3} />
            )}
            <b>{CARD_LABELS[value]}</b>
          </span>
          <span className="rd-card-privacy">
            {publicCard ? <Eye size={9} /> : <LockKeyhole size={9} />}
          </span>
          {injured && (
            <span className="rd-card-injury">
              <HeartCrack size={11} />
            </span>
          )}
        </div>
      </div>
      {selected && <span className="rd-card-focus-dot" />}
    </div>
  );
}

function DemoPlayer({
  name,
  avatar,
  active = false,
  children,
  className = "",
  tag,
}: {
  name: string;
  avatar: string;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  tag?: string;
}) {
  return (
    <div className={`rd-player ${active ? "is-active" : ""} ${className}`}>
      <div className="rd-player-heading">
        <span className="rd-avatar">{avatar}</span>
        <b>{name}</b>
        {tag && <small>{tag}</small>}
      </div>
      {children}
    </div>
  );
}

function IdentityScene({ step }: { step: number }) {
  const cards: Face[] =
    step < 2
      ? ["honest", "honest", "crooked"]
      : step === 2
        ? ["crooked", "crooked", "agent"]
        : ["agent", "kingpin", "crooked"];
  return (
    <div
      className={`rd-scene rd-identity-scene rd-step-${step}`}
      aria-hidden="true"
    >
      <div className="rd-scene-kicker">
        {step < 2
          ? "普通身份示例"
          : step === 2
            ? "切换示例 · 首领优先"
            : "特殊局势示例 · 双首领"}
      </div>
      <div className="rd-identity-hand">
        {cards.map((value, index) => (
          <DemoCard
            key={index}
            value={value}
            index={index}
            faceUp={step > 0}
            selected={
              step === 1
                ? index < 2
                : step === 2
                  ? index === 2
                  : step === 3 && index < 2
            }
          />
        ))}
      </div>
      <div
        className={`rd-result-chip ${step === 3 ? "rd-result-solo" : "rd-result-honest"} ${step ? "is-visible" : ""}`}
      >
        {step === 3 ? (
          <>
            <ShieldCheck size={15} /> 同持双首领 · 独自获胜
          </>
        ) : step === 2 ? (
          <>
            <ShieldCheck size={15} /> 探长优先 · 忠诚警察
          </>
        ) : (
          <>
            <Check size={15} /> 2 忠诚 ＞ 1 变节
          </>
        )}
      </div>
      <div className="rd-scene-foot">
        <LockKeyhole size={12} />
        {step === 0
          ? "你的三张身份牌，只有你先知道"
          : "教学展示完整牌面；真实对局不会自动公开"}
      </div>
    </div>
  );
}

function TurnScene({ step }: { step: number }) {
  return (
    <div
      className={`rd-scene rd-turn-scene rd-step-${step}`}
      aria-hidden="true"
    >
      <div className="rd-turn-indicator">
        <span className={step === 3 ? "" : "is-active"}>白夜的回合</span>
        <ArrowRight size={12} />
        <span className={step === 3 ? "is-active" : ""}>
          {step === 4 ? "已完成一轮等待" : "其他玩家"}
        </span>
      </div>
      <div className="rd-duel">
        <DemoPlayer
          name="白夜"
          avatar="🦊"
          active={step !== 3}
          tag={step === 4 ? "新回合" : undefined}
        >
          <div className="rd-mini-hand">
            {(["crooked", "honest", "honest"] as Face[]).map((value, index) => (
              <DemoCard
                key={index}
                index={index}
                value={value}
                faceUp={step >= 1 && index === 0}
                publicCard={index === 0}
              />
            ))}
          </div>
          <span className={`rd-gun-tag ${step >= 1 ? "is-visible" : ""}`}>
            <Crosshair size={14} /> 持枪
          </span>
        </DemoPlayer>
        <div className="rd-aim-bridge">
          <div className={`rd-aim-line ${step >= 2 ? "is-visible" : ""}`}>
            <ArrowRight size={19} />
          </div>
          <small>{step >= 2 ? "瞄准" : "公共枪池"}</small>
          {step < 2 && (
            <Crosshair
              className={`rd-pool-gun ${step === 1 ? "is-taken" : ""}`}
              size={21}
            />
          )}
        </div>
        <DemoPlayer name="阿影" avatar="🐺" active={step === 3}>
          <div className="rd-mini-hand">
            {[0, 1, 2].map((index) => (
              <DemoCard key={index} index={index} />
            ))}
          </div>
          <span className={`rd-target-tag ${step >= 2 ? "is-visible" : ""}`}>
            <Crosshair size={12} /> 被瞄准
          </span>
        </DemoPlayer>
      </div>
      <div className="rd-main-actions">
        {[
          { title: "调查", icon: Eye },
          { title: "拿枪", icon: Crosshair },
          { title: "拿装备", icon: Clipboard },
          { title: "开枪", icon: Crosshair },
        ].map(({ title, icon: Icon }, index) => (
          <span
            key={title}
            className={
              (step >= 1 && step <= 2 && index === 1) ||
              (step === 4 && index === 3)
                ? "is-chosen"
                : ""
            }
          >
            <Icon size={13} />
            {title}
          </span>
        ))}
      </div>
      <div className="rd-scene-foot">
        {step === 0
          ? "本回合只能选择一个主行动"
          : step === 1
            ? "主行动已使用，接下来只选择瞄准对象"
            : step === 2
              ? "确认瞄准 → 本回合结束"
              : step === 3
                ? "等待轮转，不能在他人回合主动射击"
                : "重新获得主行动机会：满足条件后可选开枪"}
      </div>
    </div>
  );
}

function InvestigationScene({
  step,
  viewpoint,
}: {
  step: number;
  viewpoint: Viewpoint;
}) {
  const checked = step >= 2;
  return (
    <div
      className={`rd-scene rd-investigation-scene rd-step-${step}`}
      aria-hidden="true"
    >
      <div className="rd-perspective-label">
        {viewpoint === "observer" ? (
          <>
            <UsersIcon /> 旁观者看到的牌桌
          </>
        ) : (
          <>
            <Eye size={14} /> 白夜看到的牌桌
          </>
        )}
      </div>
      <div className="rd-investigation-table">
        <div className={`rd-observer ${step >= 1 ? "is-looking" : ""}`}>
          <span>🦊</span>
          <b>白夜</b>
          <Eye size={22} />
        </div>
        <div
          className={`rd-investigation-link ${step >= 1 && step < 3 ? "is-visible" : ""}`}
        >
          <ArrowRight size={19} />
          <small>第 2 张</small>
        </div>
        <DemoPlayer name="阿影" avatar="🐺">
          <div className="rd-mini-hand">
            {(["crooked", "honest", "crooked"] as Face[]).map(
              (value, index) => (
                <DemoCard
                  key={index}
                  value={value}
                  index={index}
                  faceUp={
                    index === 1 && checked && viewpoint === "investigator"
                  }
                  selected={index === 1 && step >= 1 && step < 3}
                />
              ),
            )}
          </div>
        </DemoPlayer>
      </div>
      <div className={`rd-public-event ${step >= 1 ? "is-visible" : ""}`}>
        <Eye size={13} />
        <span>
          白夜查看了阿影的 <b>第 2 张身份牌</b>
        </span>
      </div>
      <div className={`rd-private-result ${checked ? "is-visible" : ""}`}>
        <LockKeyhole size={13} />
        {viewpoint === "observer"
          ? "你不是调查者，牌面仍然不可见"
          : "仅白夜可见：第 2 张是忠诚牌"}
      </div>
    </div>
  );
}

function UsersIcon() {
  return <span className="rd-view-icon">◎</span>;
}

function ShootingScene({
  step,
  example,
}: {
  step: number;
  example: ShotExample;
}) {
  const leader = example !== "ordinary";
  const resolved = step === 3;
  const wounded = example === "wounded" || (example === "leader" && resolved);
  const eliminated = resolved && example !== "leader";
  const values: Face[] = leader
    ? ["crooked", "agent", "honest"]
    : ["honest", "honest", "crooked"];
  return (
    <div
      className={`rd-scene rd-shooting-scene rd-step-${step}`}
      aria-hidden="true"
    >
      <div className="rd-scene-kicker">
        {example === "ordinary"
          ? "例 A · 普通玩家"
          : example === "leader"
            ? "例 B · 首领第一次中枪"
            : "例 C · 已在先前回合受伤的首领"}
      </div>
      <div className="rd-duel rd-shooting-duel">
        <DemoPlayer name="白夜" avatar="🦊" active={!resolved}>
          <span className={`rd-large-gun ${resolved ? "is-spent" : ""}`}>
            <Crosshair size={32} />
          </span>
          <small className="rd-gun-caption">
            {resolved ? "枪归还公共区" : "已持枪并瞄准"}
          </small>
        </DemoPlayer>
        <div
          className={`rd-shot-bridge ${step >= 1 ? "is-declared" : ""} ${resolved ? "is-resolved" : ""}`}
        >
          <div className="rd-shot-ray" />
          <Crosshair size={18} />
          <small>{resolved ? "结算" : step ? "宣告" : "瞄准"}</small>
        </div>
        <DemoPlayer
          name="阿影"
          avatar="🐺"
          className={eliminated ? "is-eliminated" : wounded ? "is-wounded" : ""}
        >
          <div className="rd-mini-hand">
            {values.map((value, index) => (
              <DemoCard
                key={index}
                value={value}
                index={index}
                faceUp={resolved || example === "wounded"}
                publicCard={resolved || example === "wounded"}
                injured={value === "agent" && wounded && !eliminated}
              />
            ))}
          </div>
          <span
            className={`rd-shot-health ${eliminated ? "is-out" : wounded ? "is-wounded" : ""}`}
          >
            {eliminated ? (
              <>
                <Skull size={13} /> 已出局
              </>
            ) : wounded ? (
              <>
                <HeartCrack size={13} /> 已受伤
              </>
            ) : leader ? (
              "首领 · 尚未受伤"
            ) : (
              "普通玩家"
            )}
          </span>
        </DemoPlayer>
      </div>
      <div className={`rd-response-window ${step === 2 ? "is-visible" : ""}`}>
        <Clock3 size={18} />
        <b>6 秒</b>
        <span>
          真实装备响应时间<small>本教学按步骤暂停，不模拟倒计时</small>
        </span>
      </div>
      <div
        className={`rd-shot-outcome ${resolved ? "is-visible" : ""} ${example === "leader" ? "is-wounded" : ""}`}
      >
        {example === "leader" ? (
          <>
            <HeartCrack size={15} /> 存活受伤 + 获得 1 张装备
          </>
        ) : example === "wounded" ? (
          <>
            <Skull size={15} /> 探长被击败 · 变节警察获胜
          </>
        ) : (
          <>
            <Skull size={15} /> 公开全部身份 · 普通玩家出局
          </>
        )}
      </div>
    </div>
  );
}

function ExchangeScene({ step }: { step: number }) {
  const swapped = step >= 3;
  const moving = step === 2;
  const selected = step >= 1;
  const movingState = moving ? "is-moving" : swapped ? "is-swapped" : "";
  return (
    <div
      className={`rd-scene rd-exchange-scene rd-step-${step}`}
      aria-hidden="true"
    >
      <div className="rd-exchange-actor">
        <span>🦊</span>
        <b>白夜</b>
        <ArrowLeftRight size={15} />
        <span>使用「勒索」</span>
        <small>教学展示全牌</small>
      </div>
      <div className="rd-exchange-table">
        <div className="rd-exchange-row">
          <div className="rd-exchange-name">
            <span>🐺 阿影</span>
            <small className={swapped ? "rd-team-crooked" : "rd-team-honest"}>
              {swapped ? "变节警察" : "探长 · 忠诚警察"}
            </small>
          </div>
          <div className="rd-mini-hand">
            <DemoCard index={0} value="crooked" faceUp publicCard />
            <DemoCard index={1} value="crooked" faceUp publicCard />
            <DemoCard
              index={2}
              value="agent"
              faceUp
              publicCard
              injured
              selected={selected}
              movingClass={`rd-moving-agent ${movingState}`}
            />
          </div>
        </div>
        <div className="rd-exchange-row">
          <div className="rd-exchange-name">
            <span>🐱 小林</span>
            <small className="rd-team-honest">
              {swapped ? "探长 · 忠诚警察" : "忠诚警察"}
            </small>
          </div>
          <div className="rd-mini-hand">
            <DemoCard index={0} value="honest" faceUp />
            <DemoCard index={1} value="honest" faceUp />
            <DemoCard
              index={2}
              value="crooked"
              faceUp
              selected={selected}
              movingClass={`rd-moving-crooked ${movingState}`}
            />
          </div>
        </div>
        <div className={`rd-exchange-path ${selected ? "is-visible" : ""}`}>
          <ArrowLeftRight size={17} />
        </div>
      </div>
      <div className={`rd-exchange-outcome ${swapped ? "is-visible" : ""}`}>
        <HeartCrack size={14} />
        <span>伤势随探长牌交给小林，明牌仍是明牌</span>
      </div>
    </div>
  );
}

function DemoPlayback({ kind }: { kind: DemoKind }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRun, setPlaybackRun] = useState(0);
  const [viewpoint, setViewpoint] = useState<Viewpoint>("observer");
  const [shotExample, setShotExample] = useState<ShotExample>("ordinary");
  const steps = kind === "shooting" ? shootingSteps(shotExample) : STEPS[kind];
  const currentStep =
    kind === "investigation" && step === 2
      ? {
          ...steps[step],
          description:
            viewpoint === "observer"
              ? "当前是旁观者视角：你知道白夜查看了阿影的第 2 张牌，但仍看不到内容。阿影原本知道自己的牌，此次新获知牌面的是白夜。切换白夜视角，可以看到两者的差别。"
              : "当前是白夜视角：白夜看到阿影的第 2 张是忠诚牌。这个结果只对白夜和原本就知道自己身份的阿影可见，其他旁观者仍看见问号，牌没有因此公开。",
        }
      : steps[step];
  const last = steps.length - 1;
  useEffect(() => {
    if (!playing || document.hidden || step >= last) return;
    const timer = window.setTimeout(() => {
      if (document.hidden) {
        setPlaying(false);
        return;
      }
      const next = Math.min(step + 1, last);
      setStep(next);
      if (next === last) setPlaying(false);
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [playing, step, last, playbackRun]);
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);
  function chooseStep(next: number) {
    setPlaying(false);
    setStep(Math.max(0, Math.min(next, last)));
  }
  function replay() {
    setStep(0);
    setPlaybackRun((previous) => previous + 1);
    setPlaying(!document.hidden);
  }
  return (
    <section
      className={`rule-demo rd-kind-${kind}`}
      aria-label={`互动教学：${TITLES[kind]}`}
    >
      <header className="rd-heading">
        <div>
          <span>可控演示 · 独立教学样本</span>
          <h3>{TITLES[kind]}</h3>
        </div>
        <span className="rd-step-count">
          {step + 1}
          <i>/ {steps.length}</i>
        </span>
      </header>
      {kind === "investigation" && (
        <div className="rd-choice-row" role="group" aria-label="演示观察视角">
          <span>切换视角</span>
          <button
            type="button"
            className={viewpoint === "observer" ? "is-selected" : ""}
            aria-pressed={viewpoint === "observer"}
            onClick={() => {
              setPlaying(false);
              setViewpoint("observer");
            }}
          >
            旁观者
          </button>
          <button
            type="button"
            className={viewpoint === "investigator" ? "is-selected" : ""}
            aria-pressed={viewpoint === "investigator"}
            onClick={() => {
              setPlaying(false);
              setViewpoint("investigator");
            }}
          >
            白夜（调查者）
          </button>
        </div>
      )}
      {kind === "shooting" && (
        <div
          className="rd-choice-row rd-shot-choices"
          role="group"
          aria-label="选择独立射击示例"
        >
          {(
            [
              { value: "ordinary", label: "普通玩家" },
              { value: "leader", label: "未受伤首领" },
              { value: "wounded", label: "已受伤首领" },
            ] as const
          ).map((example) => (
            <button
              type="button"
              key={example.value}
              className={shotExample === example.value ? "is-selected" : ""}
              aria-pressed={shotExample === example.value}
              onClick={() => {
                setPlaying(false);
                setShotExample(example.value);
                setStep(0);
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
      )}
      <div className="rd-controls">
        <div className="rd-playback-buttons">
          <button
            type="button"
            className="rd-play-button"
            onClick={() => {
              if (playing) setPlaying(false);
              else if (step === last) replay();
              else setPlaying(!document.hidden);
            }}
            aria-label={
              playing ? "暂停演示" : step === last ? "重新播放演示" : "播放演示"
            }
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            <span>{playing ? "暂停" : "播放"}</span>
          </button>
          <button
            type="button"
            onClick={() => chooseStep(step - 1)}
            disabled={step === 0}
            title="上一步"
            aria-label="上一步"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => chooseStep(step + 1)}
            disabled={step === last}
            title="下一步"
            aria-label="下一步"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={replay}
            title="从头重播"
            aria-label="从头重播"
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div
          className="rd-step-selector"
          role="group"
          aria-label="直接选择教学步骤"
        >
          {steps.map((item, index) => (
            <button
              type="button"
              key={index}
              className={step === index ? "is-current" : ""}
              onClick={() => chooseStep(index)}
              aria-label={`第 ${index + 1} 步：${item.title}`}
              aria-current={step === index ? "step" : undefined}
              title={item.title}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
      <p className="rd-playback-hint">
        {playing
          ? "每步停留 3.6 秒，播放到末步自动暂停。"
          : step === last
            ? "演示结束。可选任意步骤回看，或从头重播。"
            : "默认暂停。点击播放，或用箭头逐步查看。"}
      </p>
      {kind === "identity" ? (
        <IdentityScene step={step} />
      ) : kind === "turn" ? (
        <TurnScene step={step} />
      ) : kind === "investigation" ? (
        <InvestigationScene step={step} viewpoint={viewpoint} />
      ) : kind === "shooting" ? (
        <ShootingScene step={step} example={shotExample} />
      ) : (
        <ExchangeScene step={step} />
      )}
      <div className="rd-explanation" aria-live="polite" aria-atomic="true">
        <span className="rd-explanation-number">0{step + 1}</span>
        <div>
          <h4>{currentStep.title}</h4>
          <p>{currentStep.description}</p>
        </div>
      </div>
    </section>
  );
}

export default function RuleDemo({ kind }: { kind: DemoKind }) {
  return <DemoPlayback key={kind} kind={kind} />;
}
