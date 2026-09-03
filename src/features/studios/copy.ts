/**
 * Single source of narrative copy for Channelwright Studios.
 *
 * The cinematic and reduced-motion renderings both read from here, so the
 * accessible version can never quietly say something different from the one
 * most visitors see. Claims are constrained by `./capabilities.ts`.
 */

export const OPEN = {
  slate: ["Every channel starts with an idea.", "The difference is what happens next."],
  overline: "Channelwright Studios",
  title: ["One idea enters.", "An entire media operation", "comes to life."],
  emphasis: "One idea",
  lede: "The AI operating system for building and running a YouTube media business. Evidence before strategy, strategy before production, and a human decision at every gate.",
  primaryCta: "Enter the studio",
  secondaryCta: "See what is built",
  hint: "Scroll to enter",
} as const;

export const INTELLIGENCE = {
  index: "01",
  department: "Intelligence Room",
  heading: "Find the opportunity before you make the video.",
  body: [
    "Most tools begin at the script. Channelwright begins three decisions earlier — retrieving YouTube evidence, handing it to an independent critic, and running a bounded revision pass before anyone is asked to approve a thing.",
    "What leaves this room is not a topic. It is a set of claims you can open, argue with, and trace back to where they came from.",
  ],
  panelTitle: "Opportunity field",
  panelNote: "Illustrative",
  axisX: "Audience demand",
  axisY: "Competitive saturation",
  streamTitle: "Channel research",
  streamNote: "7 steps",
  /** Mirrors the registered CHANNEL_RESEARCH graph in src/domain/production-workflows.ts. */
  steps: [
    { key: "retrieve-youtube-evidence", label: "Retrieve YouTube evidence", tag: "youtube-research" },
    { key: "draft-research", label: "Draft research", tag: "research-synthesis" },
    { key: "initial-qa", label: "Independent QA", tag: "critic" },
    { key: "bounded-revision", label: "Bounded revision", tag: "research-revision" },
    { key: "final-qa", label: "Final QA", tag: "critic" },
    { key: "synthesize-validation", label: "Finalise artifact", tag: "finalizer" },
    { key: "review-research", label: "Human review", tag: "approval", role: "human" as const },
  ],
  ledger: [
    { value: "Claims", note: "Each one bound to a source ID.", tone: "plain" as const },
    { value: "Contradictions", note: "Held in the record, not smoothed away.", tone: "warn" as const },
    { value: "Unknowns", note: "Declared rather than guessed at.", tone: "plain" as const },
  ],
  readout: [
    { at: 0.06, label: "Raw signals", value: "212" },
    { at: 0.3, label: "Clustered", value: "41" },
    { at: 0.52, label: "Candidates", value: "4" },
    { at: 0.7, label: "Selected", value: "1" },
  ],
  verdict: "Opportunity verified",
  rejected: "3 rejected \u2014 saturation, thin evidence, no monetisation path",
} as const;

/**
 * Environmental copy: signage, thresholds and instrument labelling that belong
 * to the facility rather than to a paragraph. Kept here so the reduced-motion
 * rendering can reuse the same words as headings where it needs them.
 */
export const WORLD = {
  facility: "Channelwright Studios",
  thresholdLabel: "Operating floor \u00b7 Authorised",
  dept01: { index: "01", name: "Intelligence Room", note: "Research \u00b7 Evidence \u00b7 Ranking" },
  dept02: { index: "02", name: "Strategy Room", note: "Positioning \u00b7 Versioned decisions" },
  dept03: { index: "03", name: "Writers' Room", note: "Brief \u00b7 Script \u00b7 Sourced claims" },
  dept04: { index: "04", name: "Production Floor", note: "Render \u00b7 QA gates \u00b7 Master" },
  dept05: { index: "05", name: "Control Room", note: "Packaging \u00b7 Selection \u00b7 Release lock" },
} as const;

/**
 * The signal's designation as it is worked on, keyed to journey progress.
 * Every state describes something the shipped workflows actually produce \u2014
 * see `./capabilities.ts`. No state may promise a downstream outcome.
 *
 * Ranges are fractions of the whole journey's `--j`, so they were rescaled
 * when Department 03 extended the building, again when Department 04 did,
 * and again for Department 05 \u2014 see `LANDMARK` in `./world.tsx` for the
 * same rescale applied to the fixed props (ratio ~.8276 for this pass).
 */
export const SIGNAL = {
  states: [
    { from: -0.0261, to: 0.1436, label: "Raw signal \u00b7 unverified" },
    { from: 0.1305, to: 0.2546, label: "In research \u00b7 retrieving evidence" },
    { from: 0.2416, to: 0.3264, label: "Claims bound to sources \u00b7 QA passed" },
    { from: 0.32, to: 0.4113, label: "Approved research \u00b7 ranked backlog" },
    { from: 0.4047, to: 0.5288, label: "Strategy input \u00b7 awaiting decision" },
    { from: 0.5157, to: 0.6463, label: "Script structured \u00b7 locked at QA" },
    { from: 0.6455, to: 0.811, label: "Master validated \u00b7 queued for release" },
    { from: 0.803, to: 0.99, label: "Release package \u00b7 locked at exact version" },
  ],
} as const;

/**
 * Department 02, established rather than fully staged. Pass 2 proves the
 * continuous-world grammar across one transition; 02 arrives, powers up and
 * states what it is for, and is deliberately not given 01's screen time.
 */
export const STRATEGY = {
  index: "02",
  department: "Strategy Room",
  heading: "A channel is a position, not a playlist.",
  body: [
    "Approved research does not become a video. It becomes a strategy \u2014 audience, promise, and the hypothesis the next slate is meant to test \u2014 versioned so production can only ever run against a decision someone actually approved.",
  ],
  panelTitle: "Strategy record",
  panelNote: "Versioned",
  rows: [
    { key: "position", label: "Position", value: "Approved at an exact version" },
    { key: "supersede", label: "Superseded strategy", value: "Retained in the record" },
    { key: "gate", label: "Stale strategy", value: "Blocks production start" },
  ],
  instrumentTitle: "Version gate",
  instrumentNote: "Illustrative",
  readout: [
    { at: 0.08, label: "Versions filed", value: "3" },
    { at: 0.42, label: "Superseded", value: "2" },
    { at: 0.5, label: "Approved", value: "v3" },
    { at: 0.68, label: "Blocked at gate", value: "1" },
  ],
  verdict: "Gate holds \u2014 only v3 clears",
  rejected: "v1, v2 retained \u2014 struck through, not deleted",
  arrival: "Department 02 \u00b7 arriving",
} as const;

/**
 * Department 03, built to the standard set by 01 and 02. Approved strategy
 * does not become a video; it becomes a brief, then a script the room can
 * defend — structured, sourced, checked, and versioned before it leaves.
 */
export const WRITERS = {
  index: "03",
  department: "Writers' Room",
  heading: "A brief is not a script until it can defend itself.",
  body: [
    "Approved strategy becomes a brief — audience, promise, and the slot it earns — before a line is written. The brief becomes a script: a hook and timed sections, each claim bound to a researched source, checked by an independent QA pass, and revised only within a bound before a human approves an exact version.",
  ],
  panelTitle: "Brief record",
  panelNote: "Structured",
  rows: [
    { key: "brief", label: "Brief", value: "Audience, promise, and the slot it earns" },
    { key: "structure", label: "Script structure", value: "Hook and timed sections" },
    { key: "revision", label: "Failed QA", value: "Bounded revision, not infinite" },
  ],
  instrumentTitle: "Script sequencer",
  instrumentNote: "Illustrative",
  readout: [
    { at: 0.08, label: "Sections drafted", value: "5" },
    { at: 0.36, label: "Claims sourced", value: "11" },
    { at: 0.54, label: "Flagged for revision", value: "1" },
    { at: 0.76, label: "Locked at", value: "v2" },
  ],
  verdict: "Script approved at v2",
  rejected: "1 section revised — unsourced claim caught at QA",
  arrival: "Department 03 · arriving",
} as const;

/**
 * Department 04, built to the standard set by 01–03. Where the Writers' Room
 * resolves a brief into a script it can defend, the Production Floor
 * resolves that script into a master it can release — rendered once,
 * deterministically, and blocked from leaving until every gate checking it
 * reports a pass.
 */
export const PRODUCTION = {
  index: "04",
  department: "Production Floor",
  heading: "A script does not leave as a video until it can pass every gate.",
  body: [
    "The approved script becomes a composition, rendered once to a deterministic 1920×1080 master and probed for its own container, codecs, loudness and checksum. Nothing clears the floor until six independent QA gates — technical, rights, claims, visual, subjective-audio and platform — each report a pass, and a human approves the exact version that did.",
  ],
  panelTitle: "Production record",
  panelNote: "Gated",
  rows: [
    { key: "render", label: "Master render", value: "1920×1080, deterministic, checksum-probed" },
    { key: "gates", label: "QA gates", value: "Technical, rights, claims, visual, audio, platform" },
    { key: "approval", label: "Human approval", value: "Exact version, before it can leave the floor" },
  ],
  instrumentTitle: "Render line",
  instrumentNote: "Illustrative",
  readout: [
    { at: 0.1, label: "Render started", value: "1" },
    { at: 0.42, label: "Gates cleared", value: "6/6" },
    { at: 0.64, label: "Checksum", value: "Verified" },
    { at: 0.82, label: "Approved at", value: "v1" },
  ],
  verdict: "Master approved for release",
  rejected: "0 blocked — technical, rights, claims, visual, audio, platform all clear",
  arrival: "Department 04 · arriving",
} as const;

/**
 * Department 05, built to the standard set by 01–04. Where the Production
 * Floor resolves a script into a master it can release, the Control Room
 * resolves that master's packaging — title candidates and thumbnail
 * concepts, each carrying its own deception-risk judgement — into the one
 * exact release package a human locks and hands off.
 */
export const CONTROL = {
  index: "05",
  department: "Control Room",
  heading: "Publishing is a decision, not a default.",
  body: [
    "Packaging proposes candidates — several titles, several thumbnails, each judged for its own deception risk. Never a chosen one. A human selects exactly one of each, and the material-risk options are struck through and kept in the record.",
  ],
  panelTitle: "Release record",
  panelNote: "Selected",
  rows: [
    { key: "candidates", label: "Packaging candidates", value: "Title options and thumbnail concepts, each risk-scored" },
    { key: "selection", label: "Release selection", value: "Exact title + thumbnail, chosen from the approved set" },
    { key: "binding", label: "Hypothesis binding", value: "Bound to the strategy KPI this release is meant to test" },
  ],
  instrumentTitle: "Release compositor",
  instrumentNote: "Illustrative",
  readout: [
    { at: 0.08, label: "Candidates drafted", value: "9" },
    { at: 0.36, label: "Flagged for deception risk", value: "2" },
    { at: 0.6, label: "Title + thumbnail selected", value: "1 + 1" },
    { at: 0.84, label: "Locked at", value: "v1" },
  ],
  verdict: "Release package locked at v1",
  rejected: "2 rejected — material deception risk (overstated comparison, shock framing)",
  arrival: "Department 05 · arriving",
} as const;

export const REGISTER = {
  kicker: "Capability register",
  heading: "What is built, what is proven, and what is not.",
  body: "This site is written against the codebase rather than a roadmap. Every capability below carries the status the repository can actually support — including the parts of the loop that are still open.",
  legend: [
    { status: "OPERATING" as const, note: "Registered workflow, provider-backed, human-approvable." },
    { status: "PROVEN" as const, note: "Demonstrated deterministically in-repo, not yet a running service." },
    { status: "DESIGNED" as const, note: "Specified and reserved in the architecture. Deliberately not built." },
  ],
} as const;

export const NEXT_UP = {
  kicker: "Under construction",
  heading: "One room still dark.",
  body: "Analytics Command is staged into this experience but not yet built into it. It is being made to the standard set by the Intelligence, Strategy, Writers', Production and Control rooms, not generated to fill the page \u2014 a statement about this site, not about the product. Each department's real status is in the register above.",
} as const;

export const FOOTER = {
  line: "Build the company behind the channel.",
  note: "Channelwright Studios is a preview surface. The production site remains at the site root and is unchanged by this work.",
} as const;
