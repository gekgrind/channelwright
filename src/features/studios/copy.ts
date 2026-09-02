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
  lede: "Channelwright is the AI operating system for building and running a YouTube media business. Evidence before strategy. Strategy before production. A human decision at every gate.",
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
  artifactBefore: "Idea · unverified",
  artifactAfter: "Idea · evidence attached",
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
  heading: "Five departments still dark.",
  body: "Strategy, the Writers' Room, the Production Floor, the Control Room and Analytics Command are designed and scheduled into this experience. They are being built to the standard set by the opening, not generated to fill the page.",
} as const;

export const FOOTER = {
  line: "Build the company behind the channel.",
  note: "Channelwright Studios is a preview surface. The production site remains at the site root and is unchanged by this work.",
} as const;
