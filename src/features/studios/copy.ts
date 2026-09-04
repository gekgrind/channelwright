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
  verdict: "Opportunity verified",
} as const;

/**
 * Environmental copy: signage, thresholds and instrument labelling that belong
 * to the facility rather than to a paragraph. Kept here so the reduced-motion
 * rendering can reuse the same words as headings where it needs them.
 */
export const WORLD = {
  facility: "Channelwright Studios",
  thresholdLabel: "Operating floor \u00b7 Authorised",
  dept01: { index: "01", name: "Intelligence Room" },
  dept02: { index: "02", name: "Strategy Room" },
  dept03: { index: "03", name: "Writers' Room" },
  dept04: { index: "04", name: "Production Floor" },
  dept05: { index: "05", name: "Control Room" },
} as const;

/**
 * The artifact: the one idea the visitor follows through the whole building.
 *
 * PLACEHOLDER. The production example is a separate decision and should be
 * drawn from a real Channelwright run, so the transformation the site shows is
 * grounded in output the product actually produced.
 *
 * Later beats rewrite and add to this; the treatment never changes.
 */
export const ARTIFACT = {
  line: "I want to make videos about mechanical keyboards.",
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
  verdict: "Gate holds \u2014 only v3 clears",
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
  verdict: "Script approved at v2",
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
  verdict: "Master approved for release",
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
  verdict: "Release package locked at v1",
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

export const FOOTER = {
  line: "Build the company behind the channel.",
  note: "Channelwright Studios is a preview surface. The production site remains at the site root and is unchanged by this work.",
} as const;
