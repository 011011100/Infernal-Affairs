import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clipboard,
  Crosshair,
  Eye,
  Fingerprint,
  Info,
  Lightbulb,
  Search,
  Wifi,
} from "lucide-react";
import { EQUIPMENT } from "../shared/equipment";
import {
  EQUIPMENT_NOTES,
  MANUAL_CHAPTERS,
  MANUAL_FAQ,
  type ManualChapterId,
} from "./manualContent";
import RuleDemo from "./RuleDemo";
import "./manual.css";

const CHAPTER_ICONS = {
  identity: Fingerprint,
  turn: Crosshair,
  investigation: Eye,
  shooting: Crosshair,
  equipment: Clipboard,
  online: Wifi,
};
const DEMOS = {
  identity: "identity",
  turn: "turn",
  investigation: "investigation",
  shooting: "shooting",
  equipment: "exchange",
} as const;

function Disclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`manual-disclosure ${open ? "is-open" : ""}`}>
      <h4>
        <button
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {title}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </h4>
      {open && (
        <div id={id} className="manual-disclosure-body">
          {children}
        </div>
      )}
    </div>
  );
}

function EquipmentCatalog() {
  const [query, setQuery] = useState("");
  const matches = EQUIPMENT.filter((card) => {
    const notes = EQUIPMENT_NOTES[card.kind];
    return `${card.title} ${card.description} ${notes.timing} ${notes.example} ${notes.note}`.includes(
      query.trim(),
    );
  });
  return (
    <section className="manual-catalog" aria-label="装备速查">
      <div className="manual-section-heading">
        <div>
          <span className="eyebrow">EQUIPMENT INDEX</span>
          <h3>16 种装备，随时查阅</h3>
        </div>
        <span className="manual-count">{matches.length} / 16</span>
      </div>
      <label className="manual-search">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索装备或效果，如：公开、交换、射击"
          aria-label="搜索装备或效果"
          type="search"
        />
      </label>
      <div className="manual-equipment-list">
        {matches.map((card) => {
          const notes = EQUIPMENT_NOTES[card.kind];
          return (
            <article className="manual-equipment" key={card.kind}>
              <div className="manual-equipment-heading">
                <Clipboard size={16} aria-hidden="true" />
                <h4>{card.title}</h4>
              </div>
              <span className="manual-timing">{notes.timing}</span>
              <p>{card.description}</p>
              <Disclosure title={`${card.title}怎么用`}>
                <p>
                  <b>举个例子</b>
                  {notes.example}
                </p>
                <p>
                  <b>留意这点</b>
                  {notes.note}
                </p>
              </Disclosure>
            </article>
          );
        })}
      </div>
      {matches.length === 0 && (
        <p className="manual-empty" role="status">
          没有找到匹配的装备，试试名称或效果关键词。
        </p>
      )}
    </section>
  );
}

export default function RulesManual({ onClose }: { onClose: () => void }) {
  const [chapterId, setChapterId] = useState<ManualChapterId>("identity");
  const reader = useRef<HTMLDivElement>(null);
  const chapterIndex = MANUAL_CHAPTERS.findIndex(
    (chapter) => chapter.id === chapterId,
  );
  const chapter = MANUAL_CHAPTERS[chapterIndex];
  useEffect(() => {
    reader.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [chapterId]);
  return (
    <div className="manual-shell">
      <aside className="manual-sidebar">
        <p className="manual-nav-caption">从认清身份，到打完一局</p>
        <nav className="manual-chapters" aria-label="行动手册章节">
          {MANUAL_CHAPTERS.map((item, index) => {
            const Icon = CHAPTER_ICONS[item.id];
            return (
              <button
                key={item.id}
                className={item.id === chapterId ? "is-active" : ""}
                aria-current={item.id === chapterId ? "step" : undefined}
                onClick={() => setChapterId(item.id)}
              >
                <span className="manual-chapter-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
                <ChevronDown
                  size={14}
                  className="manual-chapter-arrow"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </nav>
        <div className="manual-sidebar-note">
          <BookOpen size={18} />
          <p>
            演示可以暂停、倒回。
            <br />
            随时查阅，不影响当前对局。
          </p>
        </div>
        <div className="manual-factions">
          <span>
            <i />
            忠诚警察
          </span>
          <span>
            <i />
            变节警察
          </span>
        </div>
      </aside>
      <div
        className="manual-reader"
        ref={reader}
        tabIndex={0}
        role="region"
        aria-label={`${chapter.label}正文`}
      >
        <header className="manual-chapter-heading">
          <div className="manual-chapter-meta">
            <span className="eyebrow">{chapter.kicker}</span>
            <span>{String(chapterIndex + 1).padStart(2, "0")} / 06</span>
          </div>
          <h3>{chapter.title}</h3>
          <p>{chapter.intro}</p>
          {chapterId === "equipment" && (
            <button
              className="manual-lookup-shortcut"
              onClick={() =>
                reader.current
                  ?.querySelector<HTMLInputElement>('input[type="search"]')
                  ?.focus()
              }
            >
              <Search size={14} aria-hidden="true" />
              直接查找装备
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        </header>
        {chapterId !== "online" && (
          <RuleDemo key={chapterId} kind={DEMOS[chapterId]} />
        )}
        <div className="manual-takeaway">
          <Lightbulb size={19} aria-hidden="true" />
          <div>
            <span>记住这一句</span>
            <p>{chapter.takeaway}</p>
          </div>
        </div>
        <section
          className="manual-explanations"
          aria-label={`${chapter.label}详细规则`}
        >
          {chapter.sections.map((section, index) => (
            <article key={section.title}>
              <span className="manual-detail-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h4>{section.title}</h4>
                <p>{section.body}</p>
              </div>
            </article>
          ))}
        </section>
        <section className="manual-pitfalls" aria-label="容易弄错的地方">
          <h4>
            <Info size={16} aria-hidden="true" />
            容易弄错的地方
          </h4>
          <ul>
            {chapter.pitfalls.map((pitfall) => (
              <li key={pitfall}>{pitfall}</li>
            ))}
          </ul>
        </section>
        {chapterId === "equipment" && <EquipmentCatalog />}
        {chapterId === "online" && (
          <section className="manual-faq" aria-label="常见问题">
            <div className="manual-section-heading">
              <div>
                <span className="eyebrow">AT THE TABLE</span>
                <h3>遇到这些情况怎么办？</h3>
              </div>
            </div>
            {MANUAL_FAQ.map((faq) => (
              <Disclosure key={faq.question} title={faq.question}>
                <p>{faq.answer}</p>
              </Disclosure>
            ))}
          </section>
        )}
        <footer className="manual-footer">
          <button
            className="button outline"
            disabled={chapterIndex === 0}
            onClick={() => setChapterId(MANUAL_CHAPTERS[chapterIndex - 1].id)}
          >
            <ArrowLeft size={16} />
            上一章
          </button>
          {chapterIndex < MANUAL_CHAPTERS.length - 1 ? (
            <button
              className="button primary"
              onClick={() => setChapterId(MANUAL_CHAPTERS[chapterIndex + 1].id)}
            >
              下一章：{MANUAL_CHAPTERS[chapterIndex + 1].label}
              <ArrowRight size={16} />
            </button>
          ) : (
            <button className="button primary" onClick={onClose}>
              <Check size={16} />
              明白了，回到游戏
            </button>
          )}
        </footer>
        <p className="manual-edition">
          本手册对应当前线上版：4—8 人 · 经典 16 种装备 · 6 秒射击响应。
        </p>
      </div>
    </div>
  );
}
