/**
 * The Channelwright Studios facility, drawn once.
 *
 * The continuity problem in pass 1 was structural: every department owned its
 * own opaque stage, so a scene boundary was a cut. Here the hall is a single
 * drawing split into three depth planes that live in one persistent layer
 * behind every scene. Scenes swap their *content*; the building never changes,
 * it only slides past at three different rates.
 *
 * Geometry note: each plane sizes itself from viewport height (`width: auto`
 * against a fixed viewBox), so the hall keeps its proportions on every aspect
 * ratio and the lateral travel can be expressed as one calc in CSS.
 */

const STROKE = "currentColor";
/* Cold glass for anything with a screen in it, warm-neutral for casework. */
const GLASS = "rgba(150, 190, 235, .07)";
const CASE = "rgba(242, 239, 230, .035)";

/* -------------------------------------------------------------- far plane */

/** Back wall: glazed partitions, a distant equipment gallery, bay numbering. */
export function HallFar() {
  const bays = [0, 800, 1600];
  return (
    <svg viewBox="0 250 2600 450" preserveAspectRatio="xMinYMid meet" aria-hidden="true" fill="none" stroke={STROKE} strokeWidth="1.4">
      {/* Datum lines: one continuous horizon reading across the whole hall. */}
      <path d="M0 372 H2600" opacity="0.5" />
      <path d="M0 700 H2600" opacity="0.32" />

      {bays.map((x) => (
        <g key={x}>
          {/* Structural pier between bays */}
          <path d={`M${x + 8} 250 V700 M${x + 44} 250 V700 M${x + 8} 250 H${x + 44} M${x + 8} 700 H${x + 44}`} opacity="0.6" />
          {/* Glazed partition: mullions only, so the wall reads as glass. */}
          <g opacity="0.34">
            <path d={`M${x + 44} 372 H${x + 800} M${x + 44} 470 H${x + 800} M${x + 44} 596 H${x + 800}`} />
            {[160, 320, 480, 640].map((o) => (
              <path key={o} d={`M${x + 44 + o} 372 V700`} />
            ))}
          </g>
          {/* Equipment gallery seen through the glass */}
          <g opacity="0.44">
            <rect x={x + 120} y={488} width={186} height={104} fill={GLASS} />
            <rect x={x + 330} y={504} width={130} height={88} fill={GLASS} />
            <rect x={x + 512} y={496} width={158} height={96} fill={GLASS} />
          </g>
        </g>
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------- mid plane */

/**
 * Operating floor: monitor banks, racks and desks. Only this plane carries
 * live telemetry — background equipment should read as switched on, not as a
 * dashboard, so the information is deliberately unreadable at this distance.
 */
export function HallMid() {
  const stations = [340, 1180, 2020, 2860];
  return (
    <svg viewBox="0 470 3400 340" preserveAspectRatio="xMinYMid meet" aria-hidden="true" fill="none" stroke={STROKE} strokeWidth="1.6">
      {/* Continuous floor datum + wall base. Crossing this line between
          departments is what makes them read as one room. */}
      <path d="M0 806 H3400" opacity="0.55" />

      {stations.map((x, index) => {
        const tall = index % 2 === 0;
        const top = tall ? 470 : 512;
        return (
          <g key={x}>
            {/* Monitor bank: three screens on a shared yoke */}
            <g opacity="0.9">
              <rect x={x} y={top} width={188} height={112} fill={GLASS} />
              <rect x={x + 200} y={top + 14} width={146} height={92} fill={GLASS} />
              <rect x={x + 358} y={top + 26} width={110} height={72} fill={GLASS} />
              <path d={`M${x + 94} ${top + 112} V${top + 152} M${x + 40} ${top + 152} H${x + 148}`} opacity="0.7" />
            </g>

            {/* Telemetry inside the near screen: a trace, not an interface. */}
            <path
              className="cw-hall__trace"
              style={{ animationDelay: `${(index % 4) * -1.7}s` }}
              d={`M${x + 12} ${top + 74} l18 -22 14 30 16 -40 15 34 18 -14 16 24 17 -30 15 26 18 -12 15 18 16 -26`}
              strokeWidth="1.3"
              opacity="0.6"
            />
            {/* Signal map on the mid screen: a sparse scatter, no axes. */}
            <g opacity="0.4">
              {[24, 58, 92, 46, 108, 74].map((o, dot) => (
                <circle key={o} cx={x + 214 + o} cy={top + 34 + ((dot * 23) % 62)} r="2.4" fill={STROKE} stroke="none" />
              ))}
            </g>
            {/* Rack of status lights beside the desk */}
            <g>
              <path d={`M${x + 520} 560 H${x + 596} V806 H${x + 520} Z`} fill={CASE} opacity="0.7" />
              {[0, 1, 2].map((row) => (
                <circle
                  key={row}
                  className="cw-hall__led"
                  style={{ animationDelay: `${(index * 5 + row) * -0.9}s` }}
                  cx={x + 538 + (row % 2) * 18}
                  cy={600 + row * 58}
                  r="3.6"
                  fill={STROKE}
                  stroke="none"
                />
              ))}
            </g>
            {/* Desk in profile, seated at the floor datum */}
            <path d={`M${x - 30} 700 H${x + 470} L${x + 494} 806 H${x - 54} Z`} fill={CASE} opacity="0.5" />
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------- near plane */

/**
 * Overhead rig. Runs unbroken over every department, which is the single
 * strongest continuity cue available: the truss the visitor sees above
 * Department 01 is the same truss still overhead in Department 02.
 */
export function HallNear() {
  const bays = 12;
  const pitch = 400;
  /* Four web panels per bay rather than two: shallow diagonals over a long
     span read as a decorative zigzag, which is what pass 1 produced. */
  const web = pitch / 4;
  return (
    <svg viewBox="0 62 4600 380" preserveAspectRatio="xMinYMid meet" aria-hidden="true" fill="none" stroke={STROKE} strokeWidth="2">
      {/* Truss chords. Two rails plus diagonal webbing between them: read as a
          structural member carrying load, not a decorative zigzag. */}
      <path d="M0 96 H4600 M0 168 H4600" />
      <path d="M0 62 H4600" opacity="0.45" />
      {Array.from({ length: bays * 4 }, (_, i) => {
        const x = i * web;
        const up = i % 2 === 0;
        return (
          <path
            key={`web-${x}`}
            d={up ? `M${x} 168 L${x + web} 96` : `M${x} 96 L${x + web} 168`}
            opacity="0.72"
          />
        );
      })}
      {/* Verticals at every bay: gives the truss a repeat, and therefore a
          measurable speed as it passes overhead. */}
      {Array.from({ length: bays }, (_, i) => (
        <path key={`post-${i}`} d={`M${i * pitch} 62 V168`} opacity="0.6" />
      ))}

      {/* Cable tray slung below the truss, running the length of the hall. */}
      <path d="M0 236 H4600 M0 272 H4600" opacity="0.5" />
      {Array.from({ length: bays * 2 }, (_, i) => (
        <path key={`tray-${i}`} d={`M${i * (pitch / 2) + 60} 236 V272`} opacity="0.28" strokeWidth="1.2" />
      ))}

      {/* Pendant fixtures on drop rods, alternating pitch so the rhythm is not
          metronomic. Filaments carry the light rather than a glow filter. */}
      {Array.from({ length: bays }, (_, i) => {
        const x = i * pitch + (i % 3 === 0 ? 140 : 60);
        const drop = i % 2 === 0 ? 372 : 316;
        return (
          <g key={`lamp-${i}`}>
            <path d={`M${x} 272 V${drop}`} strokeWidth="1.4" opacity="0.6" />
            <path d={`M${x - 46} ${drop} H${x + 46} L${x + 28} ${drop + 62} H${x - 28} Z`} fill="rgba(242, 239, 230, .04)" />
            <path d={`M${x - 22} ${drop + 60} H${x + 22}`} strokeWidth="4" opacity={i % 4 === 1 ? 0.4 : 0.85} />
          </g>
        );
      })}
    </svg>
  );
}
