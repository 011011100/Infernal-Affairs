import type { ReactionId } from "../shared/reactions";
import "./reactions.css";

const SEAT_NUMBERS: Partial<Record<ReactionId, string>> = {
  "seat-1": "01",
  "seat-2": "02",
  "seat-3": "03",
  "seat-4": "04",
  "seat-5": "05",
  "seat-6": "06",
  "seat-7": "07",
  "seat-8": "08",
};

function Thumb({ down = false }: { down?: boolean }) {
  return (
    <g transform={down ? "rotate(180 24 24)" : undefined}>
      <path
        className="reaction-glyph-tint"
        d="M18 22 24 13c1.5-2.5 4-1 4 1.5L27 21h6c2 0 3 1.5 2.5 3.5L33 34H18Z"
      />
      <path d="M18 22 24 13c1.5-2.5 4-1 4 1.5L27 21h6c2 0 3 1.5 2.5 3.5L33 34H18" />
      <rect x="12" y="22" width="6" height="12" rx="1.5" />
      <path className="reaction-glyph-detail" d="M23 28h7M23 31h6" />
      <circle className="reaction-glyph-solid" cx="15" cy="30.5" r="0.8" />
    </g>
  );
}

function Symbol({ id }: { id: ReactionId }) {
  const number = SEAT_NUMBERS[id];
  if (number) {
    return (
      <>
        <path
          className="reaction-glyph-detail"
          d="M13 15v-3h7m8 0h7v3M13 33v3h7m8 0h7v-3"
        />
        <text className="reaction-glyph-number" x="24" y="25.5">
          {number}
        </text>
        <path className="reaction-glyph-detail" d="M21 39h6" />
      </>
    );
  }
  switch (id) {
    case "card-left":
    case "card-middle":
    case "card-right": {
      const selected = { "card-left": 0, "card-middle": 1, "card-right": 2 }[
        id
      ];
      return (
        <>
          {[0, 1, 2].map((position) => (
            <g key={position} opacity={position === selected ? 1 : 0.35}>
              <rect
                x={9 + position * 11}
                y="15"
                width="8"
                height="18"
                rx="1.5"
                className={
                  position === selected ? "reaction-glyph-solid" : undefined
                }
              />
              {position === selected && (
                <path
                  className="reaction-glyph-cutout"
                  d={`m${13 + position * 11} 20 2 4-2 4-2-4Z`}
                />
              )}
            </g>
          ))}
          <path
            className="reaction-glyph-bold"
            d={`M${10 + selected * 11} 37h6`}
          />
        </>
      );
    }
    case "good":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="m24 10 12 5v9c0 6-5 11-12 15-7-4-12-9-12-15v-9Z"
          />
          <path d="m24 10 12 5v9c0 6-5 11-12 15-7-4-12-9-12-15v-9Z" />
          <path className="reaction-glyph-bold" d="m18 24 4 4 9-10" />
          <path className="reaction-glyph-detail" d="m17 17 7-3 7 3" />
        </>
      );
    case "bad":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="m24 10 12 5v9c0 6-5 11-12 15-7-4-12-9-12-15v-9Z"
          />
          <path d="m21 11-9 4v9c0 6 4 10 10 14m6-26 8 3v9c0 5-3 9-8 12" />
          <path className="reaction-glyph-bold" d="m25 11-5 10 8 3-6 13" />
          <path d="m15.5 20 2.5 1m12-1 2.5-1" />
        </>
      );
    case "sheriff":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="m24 8 5 9 10-1-6 8 6 8-10-1-5 9-5-9-10 1 6-8-6-8 10 1Z"
          />
          <path d="m24 8 5 9 10-1-6 8 6 8-10-1-5 9-5-9-10 1 6-8-6-8 10 1Z" />
          <circle cx="24" cy="24" r="6.2" />
          <path
            className="reaction-glyph-solid"
            d="m24 20 1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4Z"
          />
        </>
      );
    case "boss":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="m11 17 7 6 6-11 6 11 7-6-3 16H14Z"
          />
          <path d="m11 17 7 6 6-11 6 11 7-6-3 16H14Z" />
          <path className="reaction-glyph-bold" d="M15 37h18" />
          <path className="reaction-glyph-detail" d="M15 30h18" />
          <path
            className="reaction-glyph-solid"
            d="m24 24 2.5 3-2.5 3-2.5-3Z"
          />
          <circle className="reaction-glyph-solid" cx="11" cy="15" r="1.7" />
          <circle className="reaction-glyph-solid" cx="24" cy="10" r="1.7" />
          <circle className="reaction-glyph-solid" cx="37" cy="15" r="1.7" />
        </>
      );
    case "investigate":
      return (
        <>
          <circle className="reaction-glyph-tint" cx="21" cy="21" r="10" />
          <circle cx="21" cy="21" r="10" />
          <path d="M14 21q7-8 14 0-7 8-14 0Z" />
          <circle className="reaction-glyph-solid" cx="21" cy="21" r="2.3" />
          <path className="reaction-glyph-bold" d="m29 29 7 7" />
          <path className="reaction-glyph-detail" d="M35 10v5m-2.5-2.5h5" />
        </>
      );
    case "cover":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M10 23Q24 6 38 23l-4 1q-10-10-20 0Z"
          />
          <path className="reaction-glyph-bold" d="M10 23Q24 6 38 23" />
          <path d="m10 23 4 1m24-1-4 1M24 10v3" />
          <circle cx="19" cy="27" r="3" />
          <circle cx="29" cy="27" r="3" />
          <path d="M13 36v-1c0-4 12-4 12 0v1m0-1c0-4 10-4 10 0v1" />
          <path className="reaction-glyph-detail" d="M12 39h24" />
        </>
      );
    case "shoot":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M11 19h20v7h-7l-3 10h-7l3-10h-6Z"
          />
          <path d="M11 19h20v7h-7l-3 10h-7l3-10h-6Z" />
          <path d="M14 16h14v3m-4 7v5h-2" />
          <path
            className="reaction-glyph-detail"
            d="M13.5 22h14M18 30h3m-4 3h3"
          />
          <path
            className="reaction-glyph-bold"
            d="m35 16 3-3m-2 9h4m-5 6 3 3"
          />
        </>
      );
    case "wait":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M17 33c-2-3-5-7-5-9 0-3 3-4 5-1l2 3V15c0-3 4-3 4 0v-3c0-3 4-3 4 0v3c0-3 4-3 4 0v3c0-3 4-3 4 0v11c0 6-4 10-10 10-3 0-6-3-8-6Z"
          />
          <path d="M17 33c-2-3-5-7-5-9 0-3 3-4 5-1l2 3V15c0-3 4-3 4 0v-3c0-3 4-3 4 0v3c0-3 4-3 4 0v3c0-3 4-3 4 0v11c0 6-4 10-10 10-3 0-6-3-8-6Z" />
          <path
            className="reaction-glyph-detail"
            d="M23 16v7m4-7v7m4-4v5M22 29q4-3 8 0"
          />
        </>
      );
    case "agree":
      return <Thumb />;
    case "deny":
      return <Thumb down />;
    case "laugh":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M12 14q12-7 24 0l-2 14c-1 7-6 11-10 12-4-1-9-5-10-12Z"
          />
          <path d="M12 14q12-7 24 0l-2 14c-1 7-6 11-10 12-4-1-9-5-10-12Z" />
          <path
            className="reaction-glyph-bold"
            d="m16 21 4-2 2 2m4 0 2-2 4 2"
          />
          <path
            className="reaction-glyph-solid"
            d="M17 26q7 3 14 0c0 6-4 9-7 9s-7-3-7-9Z"
          />
          <path
            className="reaction-glyph-cutout"
            d="M19 28q5 1.5 10 0v2q-5 2-10 0Z"
          />
        </>
      );
    case "hush":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M12 15q12-8 24 0l-2 14q-2 6-10 10-8-4-10-10Z"
          />
          <path d="M12 15q12-8 24 0l-2 14q-2 6-10 10-8-4-10-10Z" />
          <path d="m16 21 5 1m6 0 5-1M19 29h10" />
          <path
            className="reaction-glyph-cutout"
            d="M22 38V26c0-3 4-3 4 0v12Z"
          />
          <path d="M22 38V26c0-3 4-3 4 0v12" />
          <path className="reaction-glyph-detail" d="M24 27v5" />
        </>
      );
    case "doubt":
      return (
        <>
          <path
            className="reaction-glyph-tint"
            d="M12 17q9-6 20-1l-1 14q-2 7-10 9-8-5-8-12Z"
          />
          <path d="M28 13q-7-2-16 4l1 10q0 7 8 12 8-2 10-9l.5-5" />
          <path className="reaction-glyph-bold" d="m16 23 5-2m4 2 4 1" />
          <path d="m19 31 7-1" />
          <path d="M31 12c0-5 8-5 8 0 0 3-4 3-4 6" />
          <circle className="reaction-glyph-solid" cx="35" cy="22" r="1.2" />
        </>
      );
    case "lock":
      return (
        <>
          <path
            className="reaction-glyph-bold"
            d="M17 11h-6v6m20-6h6v6M11 31v6h6m20-6v6h-6"
          />
          <path className="reaction-glyph-tint" d="m24 15 9 9-9 9-9-9Z" />
          <path d="m24 15 9 9-9 9-9-9ZM24 9v5m0 20v5M9 24h5m20 0h5" />
          <circle className="reaction-glyph-solid" cx="24" cy="24" r="3" />
        </>
      );
    default:
      return null;
  }
}

export function ReactionGlyph({
  id,
  className = "",
}: {
  id: ReactionId;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`reaction-glyph ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        className="reaction-glyph-frame"
        d="M12 4.5h24l7.5 7.5v24L36 43.5H12L4.5 36V12Z"
      />
      <path className="reaction-glyph-frame-detail" d="M12 8h6m12 32h6" />
      <Symbol id={id} />
    </svg>
  );
}
