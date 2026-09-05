/**
 * Truthful capability registry for the Channelwright Studios site.
 *
 * `docs/PRODUCT_DOCTRINE.md` binds the product; this file binds the marketing
 * surface to the same honesty. Every status here was read off the shipped code
 * — `src/domain/production-workflows.ts`, the doctrine tests in `src/domain`,
 * and `docs/video-workflow.md` — not off an aspiration. Copy in the experience
 * must render one of these statuses rather than implying a capability exists.
 *
 * OPERATING  the workflow is registered, provider-backed and human-approvable
 * PROVEN     demonstrated deterministically in-repo, not yet a running service
 * DESIGNED   specified and reserved in the architecture, deliberately not built
 */

export type CapabilityStatus = "OPERATING" | "PROVEN" | "DESIGNED";

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  OPERATING: "Operating",
  PROVEN: "Proven in repo",
  DESIGNED: "Designed, not built",
};

export type Capability = {
  id: string;
  department: string;
  name: string;
  status: CapabilityStatus;
  /** One line a sceptical buyer could verify against the product. */
  claim: string;
  /** What this explicitly does not do. Kept visible on purpose. */
  boundary?: string;
};

export const CAPABILITIES: Capability[] = [
  {
    id: "concept-validation",
    department: "01",
    name: "Concept validation",
    status: "OPERATING",
    claim: "Depth, demand and monetisation are assessed as separate gates before a channel is worth building.",
    boundary: "It returns a judgement to approve or reject, not a guaranteed outcome.",
  },
  {
    id: "channel-research",
    department: "01",
    name: "Channel research",
    status: "OPERATING",
    claim: "YouTube evidence is retrieved, then drafted, QA'd by an independent critic, revised within bounds, and QA'd again before a human reviews it.",
    boundary: "Claims carry source IDs, contradictions and unknowns — including the unknowns.",
  },
  {
    id: "content-intelligence",
    department: "01",
    name: "Content intelligence",
    status: "OPERATING",
    claim: "Approved research becomes a ranked topic backlog a video brief must draw from.",
    boundary: "Rankings are evidence-linked recommendations, never predicted view counts.",
  },
  {
    id: "channel-strategy",
    department: "02",
    name: "Channel strategy",
    status: "OPERATING",
    claim: "Strategy is versioned and approved at an exact version; production cannot begin against a stale one.",
    boundary: "A superseded strategy stays in the record rather than being overwritten.",
  },
  {
    id: "video-brief",
    department: "03",
    name: "Video brief",
    status: "OPERATING",
    claim: "Each video states who it is for, what it promises and why it earns a slot, before anyone writes a line.",
    boundary: "An approved brief approves direction — never that the video is ready to produce.",
  },
  {
    id: "video-script",
    department: "03",
    name: "Video script",
    status: "OPERATING",
    claim: "Scripts are structured into a hook and timed sections whose claims reference researched sources, then pass machine QA and exact-version human approval.",
    boundary: "QA returns PASS or REVISE with machine-readable findings; revision is bounded, not infinite.",
  },
  {
    id: "video-packaging",
    department: "05",
    name: "Video packaging",
    status: "OPERATING",
    claim: "Title candidates carry an explicit deception risk, and thumbnail concepts describe visual intent.",
    boundary: "It proposes candidates and concepts. It does not pick a title or generate a thumbnail image.",
  },
  {
    id: "video-release",
    department: "05",
    name: "Release decision",
    status: "OPERATING",
    claim: "One approved title is selected, metadata reconciled, a publish window set as intent, and the decision bound to the strategy hypothesis it tests.",
    boundary: "It is a durable decision record. It holds no OAuth token and dispatches no upload.",
  },
  {
    id: "deterministic-render",
    department: "04",
    name: "Deterministic master render",
    status: "PROVEN",
    claim: "A validated composition renders a 1920×1080 master locally and is probed for container, codecs, loudness and checksum.",
    boundary: "Local proof only. No media-generation provider and no production render service is wired up.",
  },
  {
    id: "master-qa",
    department: "04",
    name: "Master QA gates",
    status: "PROVEN",
    claim: "A master starts blocked until technical, rights, claims, visual, subjective-audio and platform QA each report a pass.",
    boundary: "Measurement is not approval; the human gate is separate and references an exact version.",
  },
  {
    id: "publishing",
    department: "05",
    name: "Publishing and upload",
    status: "DESIGNED",
    claim: "Distribution targets are frozen per video and platform plans are versioned independently.",
    boundary: "No OAuth application, upload adapter or publish operation exists yet.",
  },
  {
    id: "measurement",
    department: "06",
    name: "Performance measurement",
    status: "DESIGNED",
    claim: "Release decisions already record the KPI and hypothesis each video tests, so results have somewhere to land.",
    boundary: "Channelwright ingests no analytics today. The loop is architected and open at this seam.",
  },
];

export const CAPABILITY_TALLY = CAPABILITIES.reduce(
  (tally, capability) => ({ ...tally, [capability.status]: tally[capability.status] + 1 }),
  { OPERATING: 0, PROVEN: 0, DESIGNED: 0 } as Record<CapabilityStatus, number>,
);

export const DEPARTMENTS = [
  { id: "intelligence", index: "01", name: "Intelligence Room", line: "Find the opportunity before you make the video." },
  { id: "strategy", index: "02", name: "Strategy Room", line: "Don't chase views. Build an audience." },
  { id: "writers", index: "03", name: "Writers' Room", line: "Editorial judgement at machine speed." },
  { id: "production", index: "04", name: "Production Floor", line: "Direction becomes a finished master." },
  { id: "control", index: "05", name: "Control Room", line: "Publishing is a business decision." },
  { id: "analytics", index: "06", name: "Analytics Command", line: "The pipeline closes into a loop." },
] as const;
