/**
 * Facility line art for the cold open.
 *
 * Two depth planes of studio architecture — a ceiling grid far away and a
 * lighting truss close overhead — drawn as strokes so they cost nothing to
 * render and stay crisp at any viewport. Opacity and parallax are applied by
 * `.cw-arch--far` / `.cw-arch--near`, not here.
 */

function Truss({ y, from, to }: { y: number; from: number; to: number }) {
  const bays = [];
  const step = 96;
  for (let x = from; x < to; x += step) {
    bays.push(<path key={x} d={`M${x} ${y} L${x + step / 2} ${y + 34} L${x + step} ${y}`} />);
  }
  return (
    <g>
      <path d={`M${from} ${y} H${to}`} />
      <path d={`M${from} ${y + 34} H${to}`} />
      {bays}
    </g>
  );
}

export function ArchitectureFar() {
  const hangers = [180, 340, 500, 660, 820, 980, 1140, 1300, 1460];
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      {/* Ceiling grid */}
      <path d="M0 96 H1600 M0 140 H1600 M0 184 H1600" />
      {hangers.map((x) => (
        <path key={x} d={`M${x} 96 V${210 + (x % 3) * 26}`} />
      ))}
      {/* Distant gallery of dark monitors */}
      <g opacity="0.8">
        <rect x="132" y="392" width="150" height="86" />
        <rect x="298" y="392" width="150" height="86" />
        <rect x="1160" y="404" width="132" height="76" />
        <rect x="1308" y="404" width="132" height="76" />
      </g>
      {/* Structural columns */}
      <path d="M96 190 V700 M1504 190 V700" />
    </svg>
  );
}

export function ArchitectureNear() {
  const lamps = [268, 512, 1088, 1332];
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
      <Truss y={128} from={-40} to={1640} />
      {lamps.map((x) => (
        <g key={x}>
          <path d={`M${x} 162 V214`} />
          <path d={`M${x - 30} 214 H${x + 30} L${x + 18} 268 H${x - 18} Z`} />
          {/* Filament, so a fixture reads as a light rather than an empty shape. */}
          <circle cx={x} cy={264} r={3} fill="currentColor" stroke="none" opacity="0.7" />
        </g>
      ))}
      {/* Side equipment racks, seen edge-on */}
      <g opacity="0.85">
        <path d="M-20 470 H188 V812 H-20" />
        <path d="M-20 534 H188 M-20 598 H188 M-20 662 H188 M-20 726 H188" />
        <path d="M1412 470 H1620 V812 H1412" />
        <path d="M1412 534 H1620 M1412 598 H1620 M1412 662 H1620 M1412 726 H1620" />
      </g>
      {/* Control desk profile, low and central */}
      <path d="M556 742 H1044 L1076 812 H524 Z" />
      <path d="M584 742 V812 M1016 742 V812" />
    </svg>
  );
}
