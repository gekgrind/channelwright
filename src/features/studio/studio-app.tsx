"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Check, ChevronRight, CircleDot, Clock3, FileCheck2, FlaskConical,
  GitBranch, LayoutDashboard, LoaderCircle, LogOut, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Video,
} from "lucide-react";
import type { WorkflowAction } from "@/domain/actions";
import type { Channel, VideoProject } from "@/domain/entities";

type ApiSnapshot = { channels: Channel[]; videos: VideoProject[]; agentRuns: Array<{ id: string; agent: string; status: string; costUsd: number }>; auditEvents: Array<{ id: string; type: string; at: string }> };

const channelStages = ["CONCEPT", "EVIDENCE", "DECISION", "STRATEGY", "READY"];
const scoreLabels: Record<string, string> = {
  audienceDemand: "Audience demand", competition: "Competition position", monetization: "Monetization",
  contentDepth: "Content depth", productionFeasibility: "Production feasibility",
  differentiationPotential: "Differentiation", trendStability: "Trend stability",
};

const key = () => crypto.randomUUID();

export default function StudioApp({ user }: { user: { email: string; mode: "mock" | "supabase" } }) {
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/workflows", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load workspace");
        if (active) setSnapshot(data);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load workspace"); });
    return () => { active = false; };
  }, []);

  const act = async (action: WorkflowAction, success: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key() }, body: JSON.stringify(action) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The workflow did not advance");
      setSnapshot(data); setNotice(success); setShowNew(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workflow did not advance"); }
    finally { setBusy(false); }
  };

  const activeChannel = snapshot?.channels.at(-1);
  const activeVideo = activeChannel ? snapshot?.videos.filter((video) => video.channelId === activeChannel.id).at(-1) : undefined;

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <Link className="wordmark" href="/"><span>CW</span> CHANNELWRIGHT</Link>
        <nav aria-label="Studio"><a className="active" href="#workspace"><LayoutDashboard size={17} /> Workspace</a><a href="#channels"><GitBranch size={17} /> Channels <b>{snapshot?.channels.length ?? 0}</b></a><a href="#videos"><Video size={17} /> Videos <b>{snapshot?.videos.length ?? 0}</b></a><a href="#runs"><CircleDot size={17} /> Agent runs <b>{snapshot?.agentRuns.length ?? 0}</b></a></nav>
        <div className="sidebar-bottom"><div className="mode-chip"><FlaskConical size={14} /> {user.mode === "mock" ? "FIXTURE MODE" : "SUPABASE AUTH"}</div><div className="user-row"><span>{user.email.slice(0, 1).toUpperCase()}</span><div><strong>{user.email}</strong><small>Studio operator</small></div></div><form action="/api/auth/logout" method="post"><button className="sidebar-logout"><LogOut size={15} /> Sign out</button></form></div>
      </aside>

      <main id="main" className="studio-main">
        <header className="studio-header"><div><p className="eyebrow">Production control</p><h1>Channel workspace</h1></div><button className="button" onClick={() => setShowNew(true)}><Plus size={16} /> New channel</button></header>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}<button onClick={() => setError(null)}>×</button></div>}
        {notice && <div className="success-banner" role="status"><Check size={17} /> {notice}<button onClick={() => setNotice(null)}>×</button></div>}
        {busy && <div className="working-bar" role="status"><LoaderCircle className="spin" size={15} /> Validating output and advancing workflow…</div>}

        {!snapshot ? <LoadingState /> : showNew || !activeChannel ? <NewChannelForm busy={busy} onSubmit={act} /> : (
          <div id="workspace" className="workspace-grid">
            <section className="workspace-primary">
              <ChannelOverview channel={activeChannel} />
              {activeChannel.state === "CONCEPT_REVIEW_REQUIRED" && <ViabilityReview channel={activeChannel} busy={busy} act={act} />}
              {activeChannel.state === "CONCEPT_SELECTION_REQUIRED" && <ConceptSelection channel={activeChannel} busy={busy} act={act} />}
              {activeChannel.state === "READY_FOR_VIDEO_PRODUCTION" && <ReadyWorkspace channel={activeChannel} video={activeVideo} busy={busy} act={act} />}
            </section>
            <ActivityRail snapshot={snapshot} channel={activeChannel} />
          </div>
        )}
      </main>
    </div>
  );
}

function LoadingState() { return <div className="loading-state"><LoaderCircle className="spin" /><p>Opening the production ledger…</p></div>; }

function NewChannelForm({ busy, onSubmit }: { busy: boolean; onSubmit: (action: WorkflowAction, success: string) => Promise<void> }) {
  const [mode, setMode] = useState<"USER_DEFINED" | "AGENT_DISCOVERED">("USER_DEFINED");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void onSubmit({
      type: "CREATE_CHANNEL", mode,
      concept: mode === "USER_DEFINED" ? String(form.get("concept")) : undefined,
      preferences: {
        name: String(form.get("name")), niche: String(form.get("niche")), targetAudience: String(form.get("targetAudience")),
        videoStyle: String(form.get("videoStyle")), preferredVoice: String(form.get("preferredVoice")),
        targetDurationMinutes: Number(form.get("duration")), postingFrequency: String(form.get("frequency")),
        monetizationGoal: String(form.get("monetization")), language: "English", productionComplexity: "BALANCED",
        distributionTargets: {
          youtube: true,
          tiktok: form.has("tiktok"),
          instagramFacebookReels: form.has("instagramFacebookReels"),
        },
      },
    }, mode === "USER_DEFINED" ? "Concept evaluated and workflow advanced." : "Three evaluated concept directions are ready.");
  };
  return <section className="form-panel reveal"><div className="panel-kicker"><span>01</span><div><p className="eyebrow">Channel onboarding</p><h2>Set the editorial brief</h2></div></div><p className="panel-lede">Start with your own thesis or ask Channelwright to surface distinct directions. Your mode controls the workflow; the studio never substitutes your idea silently.</p>
    <form onSubmit={submit} className="channel-form">
      <fieldset><legend>How should this channel begin?</legend><div className="mode-cards"><button type="button" className={mode === "USER_DEFINED" ? "selected" : ""} onClick={() => setMode("USER_DEFINED")}><span><GitBranch size={20} /></span><strong>I have a concept</strong><small>Research and evaluate my exact idea.</small><i>{mode === "USER_DEFINED" && <Check size={13} />}</i></button><button type="button" className={mode === "AGENT_DISCOVERED" ? "selected" : ""} onClick={() => setMode("AGENT_DISCOVERED")}><span><Sparkles size={20} /></span><strong>Discover opportunities</strong><small>Generate and score several distinct directions.</small><i>{mode === "AGENT_DISCOVERED" && <Check size={13} />}</i></button></div></fieldset>
      <div className="field-grid"><label>Channel name<input name="name" required minLength={2} defaultValue="Systems, Explained" /></label><label>Niche<input name="niche" required minLength={2} defaultValue="Business and technology" /></label></div>
      {mode === "USER_DEFINED" && <label>Channel concept<textarea name="concept" required minLength={10} rows={3} defaultValue="Visual breakdowns of the hidden systems behind everyday businesses" /><small>Try “Daily AI News” for STOP or “Failed Startup Autopsies” for CAUTION in fixture mode.</small></label>}
      <div className="field-grid"><label>Target audience<input name="targetAudience" defaultValue="Curious independent founders" /></label><label>Video style<input name="videoStyle" defaultValue="Editorial visual documentary" /></label><label>Preferred voice<input name="preferredVoice" defaultValue="Measured and incisive" /></label><label>Target length<select name="duration" defaultValue="10"><option value="6">6 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="25">25 minutes</option></select></label><label>Posting frequency<select name="frequency" defaultValue="Weekly"><option>Twice weekly</option><option>Weekly</option><option>Every two weeks</option></select></label><label>Monetization goal<input name="monetization" defaultValue="Sponsorships and aligned affiliates" /></label></div>
      <DistributionTargetControls />
      <button className="button button-accent button-wide" disabled={busy} type="submit">{mode === "USER_DEFINED" ? "Research my concept" : "Find channel concepts"}<ArrowRight size={17} /></button>
    </form></section>;
}

export function DistributionTargetControls() {
  return <fieldset className="distribution-fieldset"><legend>Platform optimization</legend><p>Every video starts with the canonical YouTube production. Selected vertical adaptations begin only after the approved source is available.</p><div className="distribution-options">
    <label className="distribution-option locked"><input type="checkbox" checked disabled aria-describedby="youtube-description" /><span><strong>YouTube <small>REQUIRED</small></strong><em id="youtube-description">Canonical long-form video and publishing package.</em></span><b aria-hidden="true">LOCKED</b></label>
    <label className="distribution-option"><input type="checkbox" name="tiktok" /><span><strong>TikTok</strong><em>Generate a rapid, standalone vertical adaptation plan after the YouTube source is approved.</em></span></label>
    <label className="distribution-option"><input type="checkbox" name="instagramFacebookReels" /><span><strong>Instagram/Facebook Reels</strong><em>Generate one Reels-compatible media plan with destination-aware Instagram and Facebook copy.</em></span></label>
  </div></fieldset>;
}

function ChannelOverview({ channel }: { channel: Channel }) {
  const current = channel.concepts.at(-1); const stage = channel.state === "READY_FOR_VIDEO_PRODUCTION" ? 5 : channel.state === "CONCEPT_SELECTION_REQUIRED" ? 2 : channel.state === "CONCEPT_REVIEW_REQUIRED" ? 3 : 1;
  return <section className="overview-card"><div className="overview-top"><div><p className="eyebrow">Active channel / {channel.mode.replace("_", " ")}</p><h2>{channel.preferences.name}</h2><p>{current?.concept ?? "Concept discovery in progress"}</p><TargetSummary targets={channel.preferences.distributionTargets} /></div><span className={`state-badge state-${channel.state.toLowerCase()}`}>{channel.state.replaceAll("_", " ")}</span></div><div className="stage-rail">{channelStages.map((item, index) => <div className={index < stage ? "done" : index === stage ? "current" : ""} key={item}><i>{index < stage ? <Check size={11} /> : index + 1}</i><span>{item}</span></div>)}</div></section>;
}

function TargetSummary({ targets }: { targets: Channel["preferences"]["distributionTargets"] }) {
  return <div className="target-summary" aria-label="Distribution targets"><span><Check size={11} /> YouTube</span>{targets.tiktok && <span><Check size={11} /> TikTok</span>}{targets.instagramFacebookReels && <span><Check size={11} /> Instagram/Facebook Reels</span>}</div>;
}

function ViabilityReview({ channel, busy, act }: { channel: Channel; busy: boolean; act: (a: WorkflowAction, s: string) => Promise<void> }) {
  const version = channel.concepts.at(-1)!; const report = version.viability!; const [revising, setRevising] = useState(false);
  const revise = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ type: "REVISE_CONCEPT", channelId: channel.id, concept: String(form.get("concept")), niche: String(form.get("niche")), feedback: "Revised after viability review" }, "A new concept version was created and evaluated."); };
  return <section className="review-panel"><header><div><p className="eyebrow">Channel concept review / Version {version.version}</p><h2>Research suggests a <em>{report.recommendation.replace("_", " ")}</em> decision.</h2></div><div className={`recommendation recommendation-${report.recommendation.toLowerCase()}`}><span>{report.recommendation === "GO" ? <Check /> : <AlertTriangle />}</span><strong>{report.overallScore}</strong><small>/100<br />OVERALL</small></div></header>
    <p className="advisory">{report.summary}</p><div className="gate-grid">{Object.entries(report.gates).map(([name, gate]) => <article key={name}><div><span>{name.replace(/([A-Z])/g, " $1")}</span><b>{gate.status}</b></div><strong>{gate.score}</strong><p>{gate.evidence[0]}</p></article>)}</div>
    <div className="review-columns"><div><h3>Score breakdown</h3>{Object.entries(report.scores).map(([name, value]) => <div className="score-row" key={name}><span>{scoreLabels[name]}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}</strong></div>)}</div><div className="finding-box"><h3>What needs attention</h3>{report.risks.map((risk) => <p key={risk}><AlertTriangle size={14} /> {risk}</p>)}<h3>Repair direction</h3>{report.recommendedChanges.map((change) => <p key={change}><ChevronRight size={14} /> {change}</p>)}</div></div>
    {revising ? <form className="revision-form" onSubmit={revise}><h3>Create concept version {version.version + 1}</h3><label>Revised concept<textarea name="concept" required minLength={10} defaultValue={report.revisedConceptExamples[0] ?? version.concept} /></label><label>Niche<input name="niche" defaultValue={version.niche} /></label><div className="button-row"><button className="button button-accent" disabled={busy}>Evaluate revision <RefreshCcw size={15} /></button><button className="button button-quiet" type="button" onClick={() => setRevising(false)}>Cancel</button></div></form> : <div className="decision-bar"><div><p className="eyebrow">Human decision required</p><span>The system recommendation remains unchanged in history.</span></div><div className="button-row"><button className="button" disabled={busy} onClick={() => void act({ type: "CONCEPT_DECISION", channelId: channel.id, decision: "OVERRIDE_AND_CONTINUE" }, "Override recorded separately; channel strategy created.")}>Continue anyway</button><button className="button" disabled={busy} onClick={() => setRevising(true)}>Revise concept</button><button className="button button-accent" disabled={busy} onClick={() => void act({ type: "CONCEPT_DECISION", channelId: channel.id, decision: "REQUEST_ALTERNATIVES" }, "Alternative concepts are ready for selection.")}>Find better concepts <Sparkles size={15} /></button></div></div>}
  </section>;
}

function ConceptSelection({ channel, busy, act }: { channel: Channel; busy: boolean; act: (a: WorkflowAction, s: string) => Promise<void> }) {
  return <section className="selection-panel"><div className="panel-kicker"><span>02</span><div><p className="eyebrow">Opportunity shortlist</p><h2>Choose the thesis worth building</h2></div></div><p className="panel-lede">These are distinct fixture-backed directions, ranked by the same five viability gates. Selection remains human.</p><div className="candidate-grid">{channel.candidates.map((candidate, index) => <article key={candidate.id}><div className="candidate-number">0{index + 1}</div><span className={`mini-rec mini-${candidate.viability.recommendation.toLowerCase()}`}>{candidate.viability.recommendation}</span><h3>{candidate.concept}</h3><p>{candidate.promise}</p><div className="candidate-score"><strong>{candidate.viability.overallScore}</strong><span>/100<br />VIABILITY</span></div><div className="candidate-gates">{Object.entries(candidate.viability.gates).map(([name, gate]) => <span key={name}>{name.replace(/([A-Z])/g, " $1")} <b>{gate.status}</b></span>)}</div><button className="button button-wide" disabled={busy} onClick={() => void act({ type: "SELECT_CONCEPT", channelId: channel.id, candidateId: candidate.id }, "Concept selected and channel strategy persisted.")}>Select this concept <ArrowRight size={15} /></button></article>)}</div></section>;
}

function ReadyWorkspace({ channel, video, busy, act }: { channel: Channel; video?: VideoProject; busy: boolean; act: (a: WorkflowAction, s: string) => Promise<void> }) {
  if (video) return <VideoReview video={video} busy={busy} act={act} />;
  const selectedConcept = channel.concepts.find((item) => item.id === channel.selectedConceptVersionId) ?? channel.concepts.at(-1);
  const viability = selectedConcept?.viability;
  const create = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ type: "CREATE_VIDEO", channelId: channel.id, topic: String(form.get("topic")) }, "Video strategy, research, script, and QA completed; human review is required."); };
  return <><section className="strategy-panel"><div><p className="eyebrow">Persisted channel strategy</p><h2>{channel.strategy?.channelPromise}</h2><p>{channel.strategy?.positioning}</p></div><div className="strategy-grid"><article><h3>Content pillars</h3>{channel.strategy?.contentPillars.map((item) => <span key={item}>{item}</span>)}</article><article><h3>Recurring series</h3>{channel.strategy?.recurringSeries.map((item) => <span key={item}>{item}</span>)}</article><article><h3>Monetization</h3>{channel.strategy?.monetizationApproaches.map((item) => <span key={item}>{item}</span>)}</article></div>{viability && <section className="accepted-evidence"><header><div><p className="eyebrow">Accepted concept evidence / Version {selectedConcept?.version}</p><h3>{viability.recommendation.replaceAll("_", " ")} recommendation retained</h3></div><strong>{viability.overallScore}<small>/100</small></strong></header><p>{selectedConcept?.research?.summary ?? viability.summary}</p><div>{Object.entries(viability.gates).map(([name, gate]) => <span key={name}>{name.replace(/([A-Z])/g, " $1")}<b>{gate.status} · {gate.score}</b></span>)}</div></section>}</section><section className="video-launch"><div><p className="eyebrow">Next vertical slice</p><h2>Develop the first video</h2><p>The deterministic runner will create strategy, source-linked fixture research, a versioned script, and independent QA before pausing.</p><div className="launch-targets"><small>INHERITED TARGETS</small><TargetSummary targets={channel.preferences.distributionTargets} /></div></div><form onSubmit={create}><label>Video topic<input name="topic" required minLength={5} defaultValue="Why loyalty programs change the way customers make decisions" /></label><button className="button button-accent" disabled={busy}>Run to script review <ArrowRight size={16} /></button></form></section></>;
}

function VideoReview({ video, busy, act }: { video: VideoProject; busy: boolean; act: (a: WorkflowAction, s: string) => Promise<void> }) {
  const script = video.scripts.at(-1)!; const [feedback, setFeedback] = useState("");
  return <section className="script-panel"><header><div><p className="eyebrow">Video project / Script v{script.version}</p><h2>{script.title}</h2><p>{video.topic}</p><TargetSummary targets={video.distributionTargets} /></div><span className={`state-badge state-${video.state.toLowerCase()}`}>{video.state.replaceAll("_", " ")}</span></header><div className="qa-strip"><FileCheck2 size={20} /><div><strong>Independent script QA: {video.qa?.verdict}</strong><span>{video.qa?.summary}</span></div>{video.qa && <b>{Math.round(Object.values(video.qa.scores).reduce((a, b) => a + b, 0) / 5)}/100</b>}</div><article className="script-document"><div className="script-hook"><span>HOOK</span><p>{script.hook}</p></div>{script.sections.map((section, index) => <section key={section.heading}><div><span>0{index + 1}</span><small>{section.estimatedSeconds}s</small></div><article><h3>{section.heading}</h3><em>{section.purpose}</em><p>{section.narration}</p>{section.claimRefs.length > 0 && <small>CLAIMS: {section.claimRefs.join(", ")}</small>}</article></section>)}</article>{video.state === "SCRIPT_APPROVED" ? <><div className="approved-panel"><ShieldCheck /><div><h3>Canonical script approved</h3><p>The durable approval references script version {script.version}. No master video or publishing package exists in this slice.</p></div></div><DistributionPackage video={video} busy={busy} act={act} /></> : <div className="script-decision"><div><p className="eyebrow">Human approval gate</p><h3>Does this version earn production?</h3></div><textarea aria-label="Revision feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Required only when requesting changes…" /><div className="button-row"><button className="button" disabled={busy || !feedback.trim()} onClick={() => void act({ type: "SCRIPT_DECISION", videoId: video.id, decision: "REQUEST_CHANGES", feedback }, "Feedback persisted; a new script version was created and reviewed.")}>Request changes <RefreshCcw size={15} /></button><button className="button button-accent" disabled={busy} onClick={() => void act({ type: "SCRIPT_DECISION", videoId: video.id, decision: "APPROVE" }, "Script approval persisted; selected fixture adaptation plans were generated.")}>Approve script <Check size={15} /></button></div></div>}</section>;
}

function DistributionPackage({ video, busy, act }: { video: VideoProject; busy: boolean; act: (a: WorkflowAction, s: string) => Promise<void> }) {
  const latest = ["TIKTOK", "INSTAGRAM_FACEBOOK_REELS"].map((target) => video.platformArtifacts.filter((item) => item.target === target).at(-1)).filter(Boolean) as VideoProject["platformArtifacts"];
  return <section className="distribution-package"><header><div><p className="eyebrow">Distribution package</p><h2>Vertical adaptation plans</h2></div><span>FIXTURE / NO MEDIA</span></header><article className="youtube-package"><div><Video size={18} /><strong>YouTube</strong></div><b>CANONICAL SOURCE</b><p>Script v{video.scripts.at(-1)?.version} is approved. Master rendering and the YouTube publishing package are not implemented.</p></article>{latest.map((artifact) => {
    const item = artifact.package; const revisionFeedback = `Revise ${artifact.target === "TIKTOK" ? "TikTok" : "Reels"} plan v${artifact.version}`;
    return <article className="platform-package" key={artifact.id}><header><div><strong>{artifact.target === "TIKTOK" ? "TikTok" : "Instagram/Facebook Reels"}</strong><span>{artifact.kind.replaceAll("_", " ")} · v{artifact.version}</span></div><b className={`package-status package-${artifact.status.toLowerCase()}`}>{artifact.status.replaceAll("_", " ")}</b></header><dl><div><dt>Source</dt><dd>Script v{artifact.sourceScriptVersion} · Master {artifact.sourceMasterVersion ?? "not available"}</dd></div><div><dt>Output</dt><dd>{item ? `${item.aspectRatio} plan · ${item.targetDurationSeconds}s · ${item.fixture ? "fixture" : "live"}` : "Generation failed"}</dd></div><div><dt>QA</dt><dd>{artifact.qa?.verdict ?? "Not completed"} · {artifact.qa?.summary ?? artifact.failure}</dd></div></dl>{item && <div className="package-copy"><h3>{item.hook}</h3><p>{item.condensedNarration.join(" ")}</p><small>CLAIMS: {item.claimReferences.join(", ")}</small><div>{item.publicationBlockers.map((blocker) => <span key={blocker}><AlertTriangle size={12} /> {blocker}</span>)}</div></div>}{artifact.status === "REVIEW_REQUIRED" && <div className="package-actions"><button className="button" disabled={busy} onClick={() => void act({ type: "PLATFORM_ARTIFACT_DECISION", videoId: video.id, target: artifact.target, artifactVersion: artifact.version, decision: "REQUEST_CHANGES", feedback: revisionFeedback }, "Feedback recorded; a new platform plan version was generated and reviewed.")}>Request changes <RefreshCcw size={14} /></button><button className="button button-accent" disabled={busy} onClick={() => void act({ type: "PLATFORM_ARTIFACT_DECISION", videoId: video.id, target: artifact.target, artifactVersion: artifact.version, decision: "APPROVE" }, "Exact platform plan version approved; media production remains blocked.")}>Approve plan <Check size={14} /></button></div>}</article>;
  })}{latest.length === 0 && <p className="youtube-only-note">No optional platform was selected for this video snapshot.</p>}</section>;
}

function ActivityRail({ snapshot, channel }: { snapshot: ApiSnapshot; channel: Channel }) {
  const events = useMemo(() => snapshot.auditEvents.slice(-8).reverse(), [snapshot.auditEvents]);
  return <aside className="activity-rail"><section><div className="rail-title"><p className="eyebrow">System ledger</p><span>{snapshot.agentRuns.length} RUNS</span></div><div className="metric-pair"><article><strong>${snapshot.agentRuns.reduce((sum, item) => sum + item.costUsd, 0).toFixed(2)}</strong><span>FIXTURE COST</span></article><article><strong>{channel.concepts.length}</strong><span>CONCEPT VERSIONS</span></article></div></section><section><div className="rail-title"><p className="eyebrow">Recent events</p><Clock3 size={14} /></div><div className="event-list">{events.map((event) => <div key={event.id}><i /><p>{event.type.replaceAll("_", " ")}<span>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></p></div>)}</div></section><section className="boundary-note"><Search size={18} /><h3>Fixture boundary</h3><p>No live competitor, trend, or demand claims are made. Current provider research is required before publishing or spending.</p></section></aside>;
}
