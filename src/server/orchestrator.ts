import { createHash, randomUUID } from "node:crypto";
import type { CoreWorkflowAction as WorkflowAction } from "@/domain/actions";
import type { AgentRun, BuildProject, Channel, ConceptDecision, PlatformAdaptationArtifact, VideoProject, WorkspaceSnapshot } from "@/domain/entities";
import { transitionBuild, transitionChannel, transitionVideo } from "@/domain/state-machines";
import type { WorkspaceRepository } from "./repository";
import {
  createChannelStrategy, createContentStrategy, discoverConcepts, evaluateConcept, researchConcept,
  createReelsPackage, createTikTokPackage, researchVideo, reviewPlatformPackage, reviewScript, writeScript,
} from "./agents/fixtures";
import {
  FixtureReferenceResearchProvider, reviseFixtureReferenceReport, reviewReferenceReport,
  type ReferenceResearchProvider,
} from "./agents/reference-channel";
import { createBusinessStrategy, reviseBusinessStrategy, reviewBusinessStrategy } from "./agents/business-strategy";
import { createPaidProductBuildArtifact, createPaidProductBuildSpecification, createResourceBuildArtifact, createResourceBuildSpecification, reviseBuildSpecification, reviewBuildArtifact } from "./agents/product-builder";
import { FixtureCommerceAdapter, type CommerceAdapter } from "./commerce";
import { createMonetizationPlan, reviseMonetizationPlan, reviewMonetizationPlan } from "./agents/monetization";

const timestamp = () => new Date().toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class WorkflowError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "WorkflowError"; }
}

export class ChannelwrightOrchestrator {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly referenceProvider: ReferenceResearchProvider = new FixtureReferenceResearchProvider(),
    private readonly commerceAdapter: CommerceAdapter = new FixtureCommerceAdapter(),
  ) {}

  async snapshot(ownerId: string) {
    return this.forOwner(await this.repository.load(), ownerId);
  }

  async execute(ownerId: string, idempotencyKey: string, action: WorkflowAction) {
    const workspace = await this.repository.load();
    const inheritedDistributionTargets = action.type === "CREATE_VIDEO"
      ? workspace.channels.find((channel) => channel.id === action.channelId && channel.ownerId === ownerId)?.preferences.distributionTargets
      : undefined;
    const fingerprint = hash({ ownerId, action, inheritedDistributionTargets });
    const scopedIdempotencyKey = `${ownerId}:${idempotencyKey}`;
    const prior = workspace.idempotency[scopedIdempotencyKey];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new WorkflowError("Idempotency key was already used for a different request", 409);
      return this.forOwner(workspace, ownerId);
    }

    switch (action.type) {
      case "CREATE_CHANNEL": await this.createChannel(workspace, ownerId, action); break;
      case "CONCEPT_DECISION": this.handleConceptDecision(workspace, ownerId, action); break;
      case "REVISE_CONCEPT": this.reviseConcept(workspace, ownerId, action); break;
      case "SELECT_CONCEPT": this.selectConcept(workspace, ownerId, action); break;
      case "CREATE_VIDEO": this.createVideo(workspace, ownerId, action); break;
      case "SCRIPT_DECISION": this.handleScriptDecision(workspace, ownerId, action); break;
      case "PLATFORM_ARTIFACT_DECISION": this.handlePlatformArtifactDecision(workspace, ownerId, action); break;
      case "REVISE_REFERENCE_REPORT": this.reviseReferenceReport(workspace, ownerId, action); break;
      case "REFERENCE_REPORT_DECISION": this.handleReferenceReportDecision(workspace, ownerId, action); break;
      case "RETRY_REFERENCE_RESEARCH": await this.retryReferenceResearch(workspace, ownerId, action); break;
      case "BUSINESS_STRATEGY_DECISION": this.handleBusinessStrategyDecision(workspace, ownerId, action); break;
      case "SELECT_STRATEGY_OFFER": this.selectStrategyOffer(workspace, ownerId, action); break;
      case "CREATE_PILLAR_VIDEO": this.createPillarVideo(workspace, ownerId, action); break;
      case "CREATE_RESOURCE_BUILD": this.createResourceBuild(workspace, ownerId, action); break;
      case "CREATE_PRODUCT_BUILD": this.createProductBuild(workspace, ownerId, action); break;
      case "BUILD_SPEC_DECISION": this.handleBuildSpecDecision(workspace, ownerId, action); break;
      case "BUILD_ARTIFACT_DECISION": this.handleBuildArtifactDecision(workspace, ownerId, action); break;
      case "CAPTURE_FIXTURE_SUBSCRIBER": this.captureFixtureSubscriber(workspace, ownerId, action); break;
      case "ACTIVATE_FIXTURE_PRODUCT": this.activateFixtureProduct(workspace, ownerId, action); break;
      case "CREATE_FIXTURE_CHECKOUT": this.createFixtureCheckout(workspace, ownerId, action); break;
      case "PROCESS_FIXTURE_COMMERCE_EVENT": this.processFixtureCommerceEvent(workspace, ownerId, action); break;
      case "GENERATE_MONETIZATION_PLAN": this.generateMonetizationPlan(workspace, ownerId, action); break;
      case "MONETIZATION_PLAN_DECISION": this.handleMonetizationPlanDecision(workspace, ownerId, action); break;
    }

    this.recordConversationChange(workspace, ownerId, action);

    workspace.idempotency[scopedIdempotencyKey] = { fingerprint, completedAt: timestamp() };
    await this.repository.save(workspace);
    return this.forOwner(workspace, ownerId);
  }

  private async createChannel(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_CHANNEL" }>) {
    const createdAt = timestamp();
    const channel: Channel = {
      id: randomUUID(), ownerId, state: "DRAFT", mode: action.mode, preferences: action.preferences,
      concepts: [], decisions: [], candidates: [], referenceReports: [], referenceReportDecisions: [],
      businessStrategies: [], businessStrategyDecisions: [], offerSelections: [], monetizationPlans: [], monetizationPlanDecisions: [],
      referenceRequest: action.referenceChannel, createdAt, updatedAt: createdAt,
    };
    workspace.channels.push(channel);
    this.audit(workspace, ownerId, "CHANNEL_CREATED", channel.id, { mode: action.mode, distributionTargets: action.preferences.distributionTargets });

    if (action.mode === "USER_DEFINED") {
      const concept = action.concept!;
      channel.concepts.push({ id: randomUUID(), version: 1, concept, niche: action.preferences.niche, source: "USER_DEFINED", createdAt });
      channel.state = transitionChannel(channel.state, "CONCEPT_RESEARCH_PENDING");
      this.evaluateUserConcept(workspace, channel);
    } else if (action.mode === "AGENT_DISCOVERED") {
      channel.state = transitionChannel(channel.state, "CONCEPT_DISCOVERY_PENDING");
      this.runDiscovery(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "REFERENCE_CHANNEL_RESEARCH_PENDING");
      await this.runReferenceResearch(workspace, channel);
    }
  }

  private async runReferenceResearch(workspace: WorkspaceSnapshot, channel: Channel) {
    if (!channel.referenceRequest) throw new WorkflowError("Reference-channel request is missing", 409);
    try {
      const source = await this.runAgentAsync(workspace, channel.ownerId, "REFERENCE_CHANNEL_RESOLVER", { channelId: channel.id, request: channel.referenceRequest }, this.referenceProvider, () => this.referenceProvider.resolve(channel.referenceRequest!));
      channel.referenceSource = source;
      const report = await this.runAgentAsync(workspace, channel.ownerId, "REFERENCE_CHANNEL_RESEARCH", { channelId: channel.id, source, preferences: channel.preferences }, this.referenceProvider, () => this.referenceProvider.research(source, channel.referenceRequest!, channel.preferences));
      const qa = this.runAgent(workspace, channel.ownerId, "INDEPENDENT_RESEARCH_QA", { channelId: channel.id, sourceId: source.id, reportVersion: channel.referenceReports.length + 1 }, () => reviewReferenceReport(report));
      channel.referenceReports.push({
        id: randomUUID(), ownerId: channel.ownerId, channelId: channel.id, version: channel.referenceReports.length + 1,
        status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", report, qa, createdAt: timestamp(),
      });
      channel.state = qa.verdict === "PASS" ? transitionChannel(channel.state, "REFERENCE_CHANNEL_REVIEW_REQUIRED") : channel.state;
      this.audit(workspace, channel.ownerId, "REFERENCE_REPORT_CREATED", channel.id, { reportVersion: channel.referenceReports.length, fixture: report.fixture, qaVerdict: qa.verdict, provider: source.provider });
      if (qa.verdict === "PASS") this.audit(workspace, channel.ownerId, "WORKFLOW_PAUSED", channel.id, { reason: "HUMAN_REFERENCE_REPORT_APPROVAL", reportVersion: channel.referenceReports.length });
    } catch (error) {
      channel.state = transitionChannel(channel.state, "FAILED");
      this.audit(workspace, channel.ownerId, "REFERENCE_RESEARCH_FAILED", channel.id, { errorCode: "REFERENCE_PROVIDER_FAILED", retryable: true, message: error instanceof Error ? error.message : "Unknown reference provider failure" });
    }
    channel.updatedAt = timestamp();
  }

  private async retryReferenceResearch(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "RETRY_REFERENCE_RESEARCH" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.mode !== "REFERENCE_CHANNEL" || channel.state !== "FAILED") throw new WorkflowError("Reference research is not retryable in the current state", 409);
    channel.state = transitionChannel(channel.state, "REFERENCE_CHANNEL_RESEARCH_PENDING");
    this.audit(workspace, ownerId, "REFERENCE_RESEARCH_RETRIED", channel.id, { priorReports: channel.referenceReports.length });
    await this.runReferenceResearch(workspace, channel);
  }

  private reviseReferenceReport(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "REVISE_REFERENCE_REPORT" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "REFERENCE_CHANNEL_REVIEW_REQUIRED") throw new WorkflowError("Reference report is not waiting for revision", 409);
    const current = channel.referenceReports.at(-1);
    if (!current || current.version !== action.reportVersion) throw new WorkflowError("Reference report version is not current", 409);
    const report = this.runAgent(workspace, ownerId, "REFERENCE_CHANNEL_RESEARCH", { channelId: channel.id, baseVersion: current.version, section: action.section, instructions: action.instructions }, () => reviseFixtureReferenceReport(current.report, action.section, action.instructions));
    const qa = this.runAgent(workspace, ownerId, "INDEPENDENT_RESEARCH_QA", { channelId: channel.id, reportVersion: current.version + 1 }, () => reviewReferenceReport(report));
    channel.referenceReports.push({
      id: randomUUID(), ownerId, channelId: channel.id, version: current.version + 1, parentVersion: current.version,
      changedSection: action.section, changeInstructions: action.instructions,
      status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", report, qa, createdAt: timestamp(),
    });
    channel.updatedAt = timestamp();
    this.audit(workspace, ownerId, "REFERENCE_REPORT_REVISED", channel.id, { fromVersion: current.version, toVersion: current.version + 1, section: action.section, qaVerdict: qa.verdict });
  }

  private handleReferenceReportDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "REFERENCE_REPORT_DECISION" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "REFERENCE_CHANNEL_REVIEW_REQUIRED") throw new WorkflowError("Reference report is not waiting for a decision", 409);
    const reportVersion = channel.referenceReports.at(-1);
    if (!reportVersion || reportVersion.version !== action.reportVersion) throw new WorkflowError("Reference report version is not current", 409);
    if (reportVersion.status !== "REVIEW_REQUIRED") throw new WorkflowError("Reference report has not passed QA", 409);
    const decision = { id: randomUUID(), ownerId, channelId: channel.id, reportId: reportVersion.id, reportVersion: reportVersion.version, decision: action.decision, feedback: action.feedback, createdAt: timestamp() };
    channel.referenceReportDecisions.push(decision);
    this.audit(workspace, ownerId, "REFERENCE_REPORT_DECISION_RECORDED", channel.id, { reportId: reportVersion.id, reportVersion: reportVersion.version, decision: action.decision });
    if (action.decision === "APPROVE") {
      reportVersion.status = "APPROVED";
      channel.concepts.push({ id: randomUUID(), version: channel.concepts.length + 1, concept: reportVersion.report.proposedOriginalConcept.valueProposition, niche: channel.preferences.niche, source: "REFERENCE_CHANNEL", createdAt: timestamp() });
      channel.selectedConceptVersionId = channel.concepts.at(-1)!.id;
      channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
      this.buildChannelStrategy(workspace, channel);
    } else if (action.decision === "SWITCH_TO_DISCOVERY") {
      reportVersion.status = "REJECTED";
      channel.mode = "AGENT_DISCOVERED";
      channel.state = transitionChannel(channel.state, "CONCEPT_DISCOVERY_PENDING");
      this.runDiscovery(workspace, channel);
    } else if (action.decision === "SWITCH_TO_USER_DEFINED") {
      reportVersion.status = "REJECTED";
      channel.mode = "USER_DEFINED";
      channel.concepts.push({ id: randomUUID(), version: channel.concepts.length + 1, concept: action.concept!, niche: action.niche ?? channel.preferences.niche, source: "USER_DEFINED", createdAt: timestamp() });
      channel.state = transitionChannel(channel.state, "CONCEPT_RESEARCH_PENDING");
      this.evaluateUserConcept(workspace, channel);
    } else {
      reportVersion.status = "REJECTED";
    }
    channel.updatedAt = timestamp();
  }

  private evaluateUserConcept(workspace: WorkspaceSnapshot, channel: Channel) {
    const version = channel.concepts.at(-1)!;
    version.research = this.runAgent(workspace, channel.ownerId, "CONCEPT_RESEARCH", { channelId: channel.id, concept: version.concept }, () => researchConcept(version.concept, channel.preferences));
    version.viability = this.runAgent(workspace, channel.ownerId, "CONCEPT_VIABILITY", { channelId: channel.id, concept: version.concept, research: version.research.summary }, () => evaluateConcept(version.concept));
    this.audit(workspace, channel.ownerId, "VIABILITY_EVALUATED", channel.id, { conceptVersionId: version.id, recommendation: version.viability.recommendation });

    if (version.viability.recommendation === "GO") {
      channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
      channel.selectedConceptVersionId = version.id;
      this.recordConceptDecision(channel, version.id, version.viability, "ACCEPT");
      this.buildChannelStrategy(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "CONCEPT_REVIEW_REQUIRED");
      this.audit(workspace, channel.ownerId, "WORKFLOW_PAUSED", channel.id, { reason: version.viability.recommendation });
    }
    channel.updatedAt = timestamp();
  }

  private handleConceptDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CONCEPT_DECISION" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_REVIEW_REQUIRED") throw new WorkflowError("Channel is not waiting for a concept decision", 409);
    const version = channel.concepts.at(-1)!;
    if (!version.viability) throw new WorkflowError("The concept has no viability report", 409);
    this.recordConceptDecision(channel, version.id, version.viability, action.decision, action.feedback);

    if (action.decision === "OVERRIDE_AND_CONTINUE") {
      channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
      channel.selectedConceptVersionId = version.id;
      this.audit(workspace, ownerId, "USER_OVERRIDE", channel.id, { systemRecommendation: version.viability.recommendation });
      this.buildChannelStrategy(workspace, channel);
    } else {
      channel.state = transitionChannel(channel.state, "CONCEPT_DISCOVERY_PENDING");
      this.audit(workspace, ownerId, "CONCEPT_DISCOVERY_STARTED", channel.id, { source: "negative-recommendation" });
      this.runDiscovery(workspace, channel);
    }
    channel.updatedAt = timestamp();
  }

  private reviseConcept(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "REVISE_CONCEPT" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_REVIEW_REQUIRED") throw new WorkflowError("Only a concept under review can be revised", 409);
    const prior = channel.concepts.at(-1)!;
    if (!prior.viability) throw new WorkflowError("The prior concept has no viability report", 409);
    this.recordConceptDecision(channel, prior.id, prior.viability, "REVISE", action.feedback);
    channel.state = transitionChannel(channel.state, "CONCEPT_RESEARCH_PENDING");
    channel.concepts.push({
      id: randomUUID(), version: prior.version + 1, concept: action.concept,
      niche: action.niche ?? channel.preferences.niche, source: "USER_DEFINED", createdAt: timestamp(),
    });
    this.audit(workspace, ownerId, "CONCEPT_REVISED", channel.id, { fromVersion: prior.version, toVersion: prior.version + 1 });
    this.evaluateUserConcept(workspace, channel);
  }

  private runDiscovery(workspace: WorkspaceSnapshot, channel: Channel) {
    channel.candidates = this.runAgent(workspace, channel.ownerId, "CONCEPT_DISCOVERY", { channelId: channel.id, preferences: channel.preferences }, () => discoverConcepts(channel.preferences));
    channel.state = transitionChannel(channel.state, "CONCEPT_SELECTION_REQUIRED");
    this.audit(workspace, channel.ownerId, "CONCEPT_CANDIDATES_PRESENTED", channel.id, { count: channel.candidates.length });
  }

  private selectConcept(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "SELECT_CONCEPT" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "CONCEPT_SELECTION_REQUIRED") throw new WorkflowError("Channel is not waiting for concept selection", 409);
    const candidate = channel.candidates.find((item) => item.id === action.candidateId);
    if (!candidate) throw new WorkflowError("Concept candidate not found", 404);
    const createdAt = timestamp();
    const version = {
      id: randomUUID(), version: channel.concepts.length + 1, concept: candidate.concept, niche: candidate.niche,
      source: "AGENT_DISCOVERED" as const, createdAt,
      research: this.runAgent(workspace, ownerId, "CONCEPT_RESEARCH", { channelId: channel.id, concept: candidate.concept }, () => researchConcept(candidate.concept, channel.preferences)),
      viability: candidate.viability,
    };
    channel.concepts.push(version);
    channel.selectedConceptVersionId = version.id;
    channel.state = transitionChannel(channel.state, "CONCEPT_ACCEPTED");
    this.recordConceptDecision(channel, version.id, candidate.viability, "ACCEPT");
    this.audit(workspace, ownerId, "CONCEPT_SELECTED", channel.id, { candidateId: candidate.id, conceptVersionId: version.id });
    this.buildChannelStrategy(workspace, channel);
  }

  private buildChannelStrategy(workspace: WorkspaceSnapshot, channel: Channel) {
    channel.state = transitionChannel(channel.state, "CHANNEL_STRATEGY_PENDING");
    const version = channel.concepts.find((item) => item.id === channel.selectedConceptVersionId)!;
    channel.strategy = this.runAgent(workspace, channel.ownerId, "CHANNEL_STRATEGY", { channelId: channel.id, concept: version.concept }, () => createChannelStrategy(version.concept, channel.preferences, version.viability?.risks ?? []));
    const approvedReference = channel.referenceReports.find((item) => item.status === "APPROVED")?.report;
    const businessStrategy = this.runAgent(workspace, channel.ownerId, "THREE_FUNDAMENTALS_STRATEGIST", { channelId: channel.id, concept: version.concept, sourceReferenceVersion: channel.referenceReports.find((item) => item.status === "APPROVED")?.version }, () => createBusinessStrategy(version.concept, channel.strategy!, channel.preferences, approvedReference));
    const qa = this.runAgent(workspace, channel.ownerId, "INDEPENDENT_STRATEGY_QA", { channelId: channel.id, strategyVersion: channel.businessStrategies.length + 1 }, () => reviewBusinessStrategy(businessStrategy));
    channel.businessStrategies.push({ id: randomUUID(), ownerId: channel.ownerId, channelId: channel.id, version: channel.businessStrategies.length + 1, status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", strategy: businessStrategy, qa, createdAt: timestamp() });
    channel.state = qa.verdict === "PASS" ? transitionChannel(channel.state, "BUSINESS_STRATEGY_REVIEW_REQUIRED") : channel.state;
    channel.updatedAt = timestamp();
    this.audit(workspace, channel.ownerId, "CHANNEL_STRATEGY_COMPLETED", channel.id, { conceptVersionId: version.id, businessStrategyVersion: channel.businessStrategies.length, fixture: businessStrategy.fixture, qaVerdict: qa.verdict });
    if (qa.verdict === "PASS") this.audit(workspace, channel.ownerId, "WORKFLOW_PAUSED", channel.id, { reason: "HUMAN_BUSINESS_STRATEGY_APPROVAL", businessStrategyVersion: channel.businessStrategies.length });
  }

  private handleBusinessStrategyDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "BUSINESS_STRATEGY_DECISION" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "BUSINESS_STRATEGY_REVIEW_REQUIRED") throw new WorkflowError("Business strategy is not waiting for a decision", 409);
    const current = channel.businessStrategies.at(-1);
    if (!current || current.version !== action.strategyVersion) throw new WorkflowError("Business strategy version is not current", 409);
    channel.businessStrategyDecisions.push({ id: randomUUID(), ownerId, channelId: channel.id, strategyId: current.id, strategyVersion: current.version, decision: action.decision, feedback: action.feedback, createdAt: timestamp() });
    this.audit(workspace, ownerId, "BUSINESS_STRATEGY_DECISION_RECORDED", channel.id, { strategyId: current.id, strategyVersion: current.version, decision: action.decision });
    if (action.decision === "APPROVE") {
      current.status = "APPROVED";
      channel.state = transitionChannel(channel.state, "READY_FOR_VIDEO_PRODUCTION");
    } else {
      const strategy = this.runAgent(workspace, ownerId, "THREE_FUNDAMENTALS_STRATEGIST", { channelId: channel.id, baseVersion: current.version, feedback: action.feedback }, () => reviseBusinessStrategy(current.strategy, action.feedback!));
      const qa = this.runAgent(workspace, ownerId, "INDEPENDENT_STRATEGY_QA", { channelId: channel.id, strategyVersion: current.version + 1 }, () => reviewBusinessStrategy(strategy));
      channel.businessStrategies.push({ id: randomUUID(), ownerId, channelId: channel.id, version: current.version + 1, parentVersion: current.version, status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", strategy, qa, changeInstructions: action.feedback, createdAt: timestamp() });
    }
    channel.updatedAt = timestamp();
  }

  private selectStrategyOffer(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "SELECT_STRATEGY_OFFER" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    const strategy = channel.businessStrategies.find((item) => item.version === action.strategyVersion && item.status === "APPROVED");
    if (!strategy) throw new WorkflowError("Select offers only from an approved exact strategy version", 409);
    const options = action.offerType === "FREE_RESOURCE" ? strategy.strategy.freeResourceOptions : strategy.strategy.paidProductOptions;
    if (!options.some((item) => item.id === action.candidateId)) throw new WorkflowError("Offer candidate not found in the approved strategy version", 404);
    if (channel.offerSelections.some((item) => item.strategyVersion === action.strategyVersion && item.offerType === action.offerType)) throw new WorkflowError("An offer of this type is already selected for the strategy version", 409);
    channel.offerSelections.push({ id: randomUUID(), ownerId, channelId: channel.id, strategyVersion: action.strategyVersion, offerType: action.offerType, candidateId: action.candidateId, decision: "SELECT", createdAt: timestamp() });
    this.audit(workspace, ownerId, "STRATEGY_OFFER_SELECTED", channel.id, { strategyVersion: action.strategyVersion, offerType: action.offerType, candidateId: action.candidateId });
    channel.updatedAt = timestamp();
  }

  private createResourceBuild(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_RESOURCE_BUILD" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    const strategy = channel.businessStrategies.find((item) => item.version === action.strategyVersion && item.status === "APPROVED");
    if (!strategy) throw new WorkflowError("Resource builds require an approved exact strategy version", 409);
    const selection = channel.offerSelections.find((item) => item.strategyVersion === action.strategyVersion && item.offerType === "FREE_RESOURCE");
    if (!selection) throw new WorkflowError("Select a free resource before creating a build", 409);
    if (workspace.buildProjects.some((item) => item.ownerId === ownerId && item.channelId === channel.id && item.strategyVersion === action.strategyVersion && item.projectType === "FREE_RESOURCE")) throw new WorkflowError("A free-resource build already exists for this strategy version", 409);
    const option = strategy.strategy.freeResourceOptions.find((item) => item.id === selection.candidateId)!;
    const createdAt = timestamp();
    const project: BuildProject = { id: randomUUID(), ownerId, channelId: channel.id, strategyVersion: action.strategyVersion, offerCandidateId: option.id, projectType: "FREE_RESOURCE", state: "DRAFT", specifications: [], artifacts: [], decisions: [], createdAt, updatedAt: createdAt };
    const specification = this.runAgent(workspace, ownerId, "PRODUCT_BUILDER_SPEC", { buildProjectId: project.id, optionId: option.id, strategyVersion: action.strategyVersion }, () => createResourceBuildSpecification(option));
    project.specifications.push({ id: randomUUID(), version: 1, specification, createdAt });
    project.state = transitionBuild(project.state, "SPEC_REVIEW");
    workspace.buildProjects.push(project);
    this.audit(workspace, ownerId, "RESOURCE_BUILD_SPEC_CREATED", project.id, { channelId: channel.id, strategyVersion: action.strategyVersion, offerCandidateId: option.id, fixture: specification.fixture });
  }

  private createProductBuild(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_PRODUCT_BUILD" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    const strategy = channel.businessStrategies.find((item) => item.version === action.strategyVersion && item.status === "APPROVED");
    if (!strategy) throw new WorkflowError("Product builds require an approved exact strategy version", 409);
    const selection = channel.offerSelections.find((item) => item.strategyVersion === action.strategyVersion && item.offerType === "PAID_PRODUCT");
    if (!selection) throw new WorkflowError("Select a paid product before creating a build", 409);
    if (workspace.buildProjects.some((item) => item.ownerId === ownerId && item.channelId === channel.id && item.strategyVersion === action.strategyVersion && item.projectType === "PAID_PRODUCT")) throw new WorkflowError("A paid-product build already exists for this strategy version", 409);
    const option = strategy.strategy.paidProductOptions.find((item) => item.id === selection.candidateId)!;
    const createdAt = timestamp();
    const project: BuildProject = { id: randomUUID(), ownerId, channelId: channel.id, strategyVersion: action.strategyVersion, offerCandidateId: option.id, projectType: "PAID_PRODUCT", state: "DRAFT", specifications: [], artifacts: [], decisions: [], createdAt, updatedAt: createdAt };
    const specification = this.runAgent(workspace, ownerId, "PRODUCT_BUILDER_SPEC", { buildProjectId: project.id, optionId: option.id, strategyVersion: action.strategyVersion, projectType: "PAID_PRODUCT" }, () => createPaidProductBuildSpecification(option));
    project.specifications.push({ id: randomUUID(), version: 1, specification, createdAt });
    project.state = transitionBuild(project.state, "SPEC_REVIEW");
    workspace.buildProjects.push(project);
    this.audit(workspace, ownerId, "PAID_PRODUCT_BUILD_SPEC_CREATED", project.id, { channelId: channel.id, strategyVersion: action.strategyVersion, offerCandidateId: option.id, fixture: specification.fixture });
  }

  private handleBuildSpecDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "BUILD_SPEC_DECISION" }>) {
    const project = this.ownedBuild(workspace, ownerId, action.buildProjectId);
    if (project.state !== "SPEC_REVIEW") throw new WorkflowError("Build specification is not waiting for review", 409);
    const current = project.specifications.at(-1)!;
    if (current.version !== action.specificationVersion) throw new WorkflowError("Build specification version is not current", 409);
    current.decision = action.decision; current.feedback = action.feedback;
    this.audit(workspace, ownerId, "BUILD_SPEC_DECISION_RECORDED", project.id, { specificationVersion: current.version, decision: action.decision });
    if (action.decision === "REQUEST_CHANGES") {
      const specification = this.runAgent(workspace, ownerId, "PRODUCT_BUILDER_SPEC", { buildProjectId: project.id, baseVersion: current.version, feedback: action.feedback }, () => reviseBuildSpecification(current.specification, action.feedback!));
      project.state = transitionBuild(project.state, "SPEC_REVIEW");
      project.specifications.push({ id: randomUUID(), version: current.version + 1, specification, createdAt: timestamp() });
    } else {
      project.state = transitionBuild(project.state, "BUILDING");
      this.generateBuildArtifact(workspace, project);
    }
    project.updatedAt = timestamp();
  }

  private generateBuildArtifact(workspace: WorkspaceSnapshot, project: BuildProject, feedback?: string, restoredFromVersion?: number) {
    const version = project.artifacts.length + 1;
    const specification = project.specifications.at(-1)!.specification;
    const artifact = this.runAgent(workspace, project.ownerId, "PRODUCT_BUILDER", { buildProjectId: project.id, projectType: project.projectType, specificationVersion: project.specifications.at(-1)!.version, artifactVersion: version, feedback, restoredFromVersion }, () => project.projectType === "FREE_RESOURCE" ? createResourceBuildArtifact(specification, project.id, version, feedback) : createPaidProductBuildArtifact(specification, project.id, version, feedback));
    project.state = transitionBuild(project.state, "QA");
    const qa = this.runAgent(workspace, project.ownerId, "INDEPENDENT_BUILD_QA", { buildProjectId: project.id, artifactVersion: version }, () => reviewBuildArtifact(artifact));
    if (qa.verdict === "PASS") project.state = transitionBuild(project.state, "USER_REVIEW");
    else project.state = transitionBuild(project.state, "BUILDING");
    project.artifacts.push({ id: randomUUID(), version, parentVersion: version > 1 ? version - 1 : undefined, restoredFromVersion, artifact, qa, status: qa.verdict === "PASS" ? "USER_REVIEW" : "FAILED", changeInstructions: feedback, createdAt: timestamp() });
    this.audit(workspace, project.ownerId, "BUILD_ARTIFACT_QA_COMPLETED", project.id, { artifactVersion: version, verdict: qa.verdict, fixture: artifact.fixture, restoredFromVersion });
  }

  private handleBuildArtifactDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "BUILD_ARTIFACT_DECISION" }>) {
    const project = this.ownedBuild(workspace, ownerId, action.buildProjectId);
    const target = project.artifacts.find((item) => item.version === action.artifactVersion);
    if (!target) throw new WorkflowError("Build artifact version not found", 404);
    const current = project.artifacts.at(-1)!;
    if (action.decision !== "RESTORE_AS_NEW_VERSION" && target.version !== current.version) throw new WorkflowError("Build artifact version is not current", 409);
    if (project.state !== "USER_REVIEW") throw new WorkflowError("Build artifact is not waiting for review", 409);
    project.decisions.push({ id: randomUUID(), artifactVersion: target.version, decision: action.decision, feedback: action.feedback, createdAt: timestamp() });
    this.audit(workspace, ownerId, "BUILD_ARTIFACT_DECISION_RECORDED", project.id, { artifactVersion: target.version, decision: action.decision });
    if (action.decision === "APPROVE") {
      current.status = "APPROVED";
      project.state = transitionBuild(project.state, "APPROVED");
      project.state = transitionBuild(project.state, "DEPLOYMENT_BLOCKED");
    } else {
      project.state = transitionBuild(project.state, "BUILDING");
      const feedback = action.decision === "RESTORE_AS_NEW_VERSION" ? `Restore the approved templates and content direction from artifact v${target.version} as a new immutable version. ${action.feedback ?? ""}`.trim() : action.feedback;
      this.generateBuildArtifact(workspace, project, feedback, action.decision === "RESTORE_AS_NEW_VERSION" ? target.version : undefined);
    }
    project.updatedAt = timestamp();
  }

  private captureFixtureSubscriber(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CAPTURE_FIXTURE_SUBSCRIBER" }>) {
    const project = this.ownedBuild(workspace, ownerId, action.buildProjectId);
    if (project.projectType !== "FREE_RESOURCE" || !["USER_REVIEW", "DEPLOYMENT_BLOCKED"].includes(project.state)) throw new WorkflowError("The resource funnel is not available for fixture preview", 409);
    const normalizedEmail = action.email.trim().toLowerCase();
    let subscriber = workspace.subscribers.find((item) => item.ownerId === ownerId && item.channelId === project.channelId && item.normalizedEmail === normalizedEmail);
    if (!subscriber) {
      const occurredAt = timestamp();
      subscriber = { id: randomUUID(), ownerId, channelId: project.channelId, buildProjectId: project.id, normalizedEmail, status: "ACTIVE", consentAt: occurredAt, consentSource: action.source, createdAt: occurredAt };
      workspace.subscribers.push(subscriber);
      workspace.consentEvents.push({ id: randomUUID(), ownerId, channelId: project.channelId, buildProjectId: project.id, subscriberId: subscriber.id, consented: true, source: action.source, occurredAt });
      const tokenHash = hash(`${randomUUID()}:${subscriber.id}:${project.id}`);
      workspace.deliveryEvents.push({ id: randomUUID(), ownerId, channelId: project.channelId, buildProjectId: project.id, subscriberId: subscriber.id, status: "DELIVERED_FIXTURE", provider: "fixture-no-email", tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt: occurredAt });
      this.audit(workspace, ownerId, "FIXTURE_SUBSCRIBER_CAPTURED", project.id, { subscriberId: subscriber.id, consentSource: action.source, delivery: "DELIVERED_FIXTURE", liveEmailSent: false });
    } else {
      this.audit(workspace, ownerId, "FIXTURE_SUBSCRIBER_DUPLICATE", project.id, { subscriberId: subscriber.id, uniformResponse: true });
    }
  }

  private activateFixtureProduct(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "ACTIVATE_FIXTURE_PRODUCT" }>) {
    if (this.commerceAdapter.mode !== "fixture") throw new WorkflowError("Fixture product activation is unavailable with a live commerce adapter", 409);
    const project = this.ownedBuild(workspace, ownerId, action.buildProjectId);
    if (project.projectType !== "PAID_PRODUCT" || project.state !== "DEPLOYMENT_BLOCKED") throw new WorkflowError("Approve the paid-product artifact before fixture activation", 409);
    const artifact = project.artifacts.find((item) => item.version === action.artifactVersion && item.status === "APPROVED");
    if (!artifact) throw new WorkflowError("Activate only the approved exact artifact version", 409);
    if (workspace.products.some((item) => item.ownerId === ownerId && item.buildProjectId === project.id && item.buildArtifactVersion === artifact.version)) throw new WorkflowError("A fixture product already exists for this artifact version", 409);
    const createdAt = timestamp();
    const product = { id: randomUUID(), ownerId, channelId: project.channelId, buildProjectId: project.id, buildArtifactVersion: artifact.version, name: artifact.artifact.resourcePreview.title, status: "ACTIVE" as const, fixture: true as const, createdAt };
    const price = { id: randomUUID(), ownerId, channelId: project.channelId, productId: product.id, provider: this.commerceAdapter.providerName, currency: action.currency.toUpperCase(), amountMinor: action.amountMinor, pricingHypothesis: true as const, active: true, createdAt };
    workspace.products.push(product); workspace.prices.push(price);
    this.audit(workspace, ownerId, "FIXTURE_PRODUCT_ACTIVATED", product.id, { buildProjectId: project.id, artifactVersion: artifact.version, priceId: price.id, amountMinor: price.amountMinor, currency: price.currency, pricingHypothesis: true, deploymentBlocked: true });
  }

  private createFixtureCheckout(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_FIXTURE_CHECKOUT" }>) {
    if (this.commerceAdapter.mode !== "fixture") throw new WorkflowError("Fixture checkout is unavailable with a live commerce adapter", 409);
    const product = workspace.products.find((item) => item.id === action.productId && item.ownerId === ownerId && item.status === "ACTIVE");
    const price = workspace.prices.find((item) => item.id === action.priceId && item.ownerId === ownerId && item.productId === action.productId && item.active);
    if (!product || !price) throw new WorkflowError("Active fixture product and price not found", 404);
    const checkout = this.commerceAdapter.createCheckout({ productId: product.id, priceId: price.id, customerReference: action.customerReference });
    const purchase = { id: randomUUID(), ownerId, channelId: product.channelId, productId: product.id, priceId: price.id, provider: checkout.provider, checkoutId: checkout.checkoutId, customerReference: action.customerReference, status: "PENDING" as const, createdAt: timestamp() };
    workspace.purchases.push(purchase);
    this.audit(workspace, ownerId, "FIXTURE_CHECKOUT_CREATED", purchase.id, { productId: product.id, priceId: price.id, checkoutId: checkout.checkoutId, fixture: true, entitlementGranted: false });
  }

  private processFixtureCommerceEvent(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "PROCESS_FIXTURE_COMMERCE_EVENT" }>) {
    if (this.commerceAdapter.mode !== "fixture") throw new WorkflowError("Fixture commerce events are unavailable with a live adapter", 409);
    const purchase = workspace.purchases.find((item) => item.checkoutId === action.checkoutId && item.ownerId === ownerId);
    if (!purchase) throw new WorkflowError("Fixture purchase not found", 404);
    const duplicate = workspace.commerceEvents.find((item) => item.ownerId === ownerId && item.provider === this.commerceAdapter.providerName && item.providerEventId === action.providerEventId);
    if (duplicate) return;
    const event = this.commerceAdapter.verifyEvent({ checkoutId: action.checkoutId, providerEventId: action.providerEventId, type: action.eventType });
    const occurredAt = timestamp();
    workspace.commerceEvents.push({ id: randomUUID(), ownerId, channelId: purchase.channelId, provider: event.provider, providerEventId: event.providerEventId, purchaseId: purchase.id, type: event.type, verified: true, occurredAt });
    if (event.type === "PAYMENT_CONFIRMED") {
      purchase.status = "PAID"; purchase.verifiedAt = occurredAt;
      if (!workspace.entitlements.some((item) => item.purchaseId === purchase.id)) workspace.entitlements.push({ id: randomUUID(), ownerId, channelId: purchase.channelId, productId: purchase.productId, purchaseId: purchase.id, subjectReference: purchase.customerReference, status: "ACTIVE", grantedAt: occurredAt });
      this.audit(workspace, ownerId, "FIXTURE_PAYMENT_CONFIRMED", purchase.id, { providerEventId: event.providerEventId, verified: true, entitlementGranted: true, browserRedirectTrusted: false });
    } else {
      if (purchase.status !== "PAID") throw new WorkflowError("Only a verified paid purchase can be refunded", 409);
      purchase.status = "REFUNDED"; purchase.verifiedAt = occurredAt;
      const entitlement = workspace.entitlements.find((item) => item.purchaseId === purchase.id);
      if (entitlement) { entitlement.status = "REFUNDED"; entitlement.revokedAt = occurredAt; }
      this.audit(workspace, ownerId, "FIXTURE_PAYMENT_REFUNDED", purchase.id, { providerEventId: event.providerEventId, verified: true, entitlementRevoked: Boolean(entitlement) });
    }
  }

  private generateMonetizationPlan(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "GENERATE_MONETIZATION_PLAN" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    const strategy = channel.businessStrategies.find((item) => item.version === action.strategyVersion && item.status === "APPROVED");
    if (!strategy) throw new WorkflowError("Monetization planning requires an approved exact strategy version", 409);
    if (channel.monetizationPlans.some((item) => item.strategyVersion === action.strategyVersion)) throw new WorkflowError("A monetization plan already exists for this strategy version", 409);
    const plan = this.runAgent(workspace, ownerId, "MONETIZATION_AGENT", { channelId: channel.id, strategyVersion: strategy.version }, () => createMonetizationPlan(strategy.strategy));
    const qa = this.runAgent(workspace, ownerId, "INDEPENDENT_MONETIZATION_QA", { channelId: channel.id, planVersion: 1 }, () => reviewMonetizationPlan(plan));
    channel.monetizationPlans.push({ id: randomUUID(), ownerId, channelId: channel.id, version: 1, strategyVersion: strategy.version, status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", plan, qa, createdAt: timestamp() });
    this.audit(workspace, ownerId, "MONETIZATION_PLAN_CREATED", channel.id, { strategyVersion: strategy.version, planVersion: 1, fixture: plan.fixture, qaVerdict: qa.verdict });
    channel.updatedAt = timestamp();
  }

  private handleMonetizationPlanDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "MONETIZATION_PLAN_DECISION" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    const current = channel.monetizationPlans.at(-1);
    if (!current || current.version !== action.planVersion || current.status !== "REVIEW_REQUIRED") throw new WorkflowError("Monetization plan version is not current and reviewable", 409);
    channel.monetizationPlanDecisions.push({ id: randomUUID(), ownerId, channelId: channel.id, planId: current.id, planVersion: current.version, decision: action.decision, feedback: action.feedback, createdAt: timestamp() });
    this.audit(workspace, ownerId, "MONETIZATION_PLAN_DECISION_RECORDED", channel.id, { planId: current.id, planVersion: current.version, decision: action.decision });
    if (action.decision === "APPROVE") current.status = "APPROVED";
    else {
      const plan = this.runAgent(workspace, ownerId, "MONETIZATION_AGENT", { baseVersion: current.version, feedback: action.feedback }, () => reviseMonetizationPlan(current.plan, action.feedback!));
      const qa = this.runAgent(workspace, ownerId, "INDEPENDENT_MONETIZATION_QA", { channelId: channel.id, planVersion: current.version + 1 }, () => reviewMonetizationPlan(plan));
      channel.monetizationPlans.push({ id: randomUUID(), ownerId, channelId: channel.id, version: current.version + 1, parentVersion: current.version, strategyVersion: current.strategyVersion, status: qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "QA_REQUIRED", plan, qa, changeInstructions: action.feedback, createdAt: timestamp() });
    }
    channel.updatedAt = timestamp();
  }

  private createVideo(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_VIDEO" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "READY_FOR_VIDEO_PRODUCTION" || !channel.strategy) throw new WorkflowError("Channel is not ready for video production", 409);
    this.createVideoProject(workspace, ownerId, channel, action.topic, "STANDARD");
  }

  private createPillarVideo(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "CREATE_PILLAR_VIDEO" }>) {
    const channel = this.ownedChannel(workspace, ownerId, action.channelId);
    if (channel.state !== "READY_FOR_VIDEO_PRODUCTION" || !channel.strategy) throw new WorkflowError("Channel is not ready for Pillar Video production", 409);
    const strategy = channel.businessStrategies.find((item) => item.version === action.strategyVersion && item.status === "APPROVED");
    if (!strategy) throw new WorkflowError("Pillar Video must use an approved exact strategy version", 409);
    if (workspace.videos.some((video) => video.ownerId === ownerId && video.channelId === channel.id && video.kind === "PILLAR" && video.sourceBusinessStrategyVersion === strategy.version)) throw new WorkflowError("A Pillar Video already exists for this strategy version", 409);
    this.createVideoProject(workspace, ownerId, channel, strategy.strategy.pillarVideo.title, "PILLAR", strategy.version);
  }

  private createVideoProject(workspace: WorkspaceSnapshot, ownerId: string, channel: Channel, topic: string, kind: "STANDARD" | "PILLAR", sourceBusinessStrategyVersion?: number) {
    const createdAt = timestamp();
    const video: VideoProject = {
      id: randomUUID(), ownerId, channelId: channel.id, topic, state: "DRAFT", kind, sourceBusinessStrategyVersion,
      scripts: [], approvals: [], distributionTargets: structuredClone(channel.preferences.distributionTargets),
      platformArtifacts: [], platformApprovals: [], createdAt, updatedAt: createdAt,
    };
    workspace.videos.push(video);
    this.audit(workspace, ownerId, "VIDEO_WORKFLOW_STARTED", video.id, { channelId: channel.id, kind, sourceBusinessStrategyVersion, distributionTargets: video.distributionTargets });
    const concept = channel.concepts.find((item) => item.id === channel.selectedConceptVersionId)!.concept;
    video.state = transitionVideo(video.state, "STRATEGY_PENDING");
    video.strategy = this.runAgent(workspace, ownerId, "CONTENT_STRATEGIST", { videoId: video.id, topic: video.topic }, () => createContentStrategy(video.topic, concept, channel.preferences));
    video.state = transitionVideo(video.state, "RESEARCH_PENDING");
    video.research = this.runAgent(workspace, ownerId, "VIDEO_RESEARCH", { videoId: video.id, topic: video.topic }, () => researchVideo(video.topic));
    video.state = transitionVideo(video.state, "SCRIPT_PENDING");
    video.scripts.push(this.runAgent(workspace, ownerId, "SCRIPTWRITER", { videoId: video.id, topic: video.topic, version: 1 }, () => writeScript(video.topic)));
    video.state = transitionVideo(video.state, "SCRIPT_QA_PENDING");
    video.qa = this.runAgent(workspace, ownerId, "SCRIPT_QA", { videoId: video.id, version: 1 }, reviewScript);
    video.state = transitionVideo(video.state, "SCRIPT_REVIEW_REQUIRED");
    video.updatedAt = timestamp();
    this.audit(workspace, ownerId, "WORKFLOW_PAUSED", video.id, { reason: "HUMAN_SCRIPT_APPROVAL" });
  }

  private handleScriptDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "SCRIPT_DECISION" }>) {
    const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
    if (!video) throw new WorkflowError("Video project not found", 404);
    if (video.state !== "SCRIPT_REVIEW_REQUIRED") throw new WorkflowError("Video is not waiting for script review", 409);
    const current = video.scripts.at(-1)!;
    video.approvals.push({ id: randomUUID(), decision: action.decision, feedback: action.feedback, scriptVersion: current.version, createdAt: timestamp() });
    if (action.decision === "APPROVE") {
      video.state = transitionVideo(video.state, "SCRIPT_APPROVED");
      this.audit(workspace, ownerId, "SCRIPT_APPROVED", video.id, { version: current.version });
      this.createSelectedPlatformPlans(workspace, video);
    } else {
      video.state = transitionVideo(video.state, "SCRIPT_PENDING");
      const revised = this.runAgent(workspace, ownerId, "SCRIPTWRITER", { videoId: video.id, topic: video.topic, version: current.version + 1, feedback: action.feedback }, () => writeScript(video.topic, current.version + 1, action.feedback));
      video.scripts.push(revised);
      video.state = transitionVideo(video.state, "SCRIPT_QA_PENDING");
      video.qa = this.runAgent(workspace, ownerId, "SCRIPT_QA", { videoId: video.id, version: revised.version }, reviewScript);
      video.state = transitionVideo(video.state, "SCRIPT_REVIEW_REQUIRED");
      this.audit(workspace, ownerId, "SCRIPT_REVISION_COMPLETED", video.id, { version: revised.version });
    }
    video.updatedAt = timestamp();
  }

  private createSelectedPlatformPlans(workspace: WorkspaceSnapshot, video: VideoProject) {
    if (!video.research) throw new WorkflowError("Video research is required before platform planning", 409);
    const channel = this.ownedChannel(workspace, video.ownerId, video.channelId);
    const targets = [
      ...(video.distributionTargets.tiktok ? ["TIKTOK" as const] : []),
      ...(video.distributionTargets.instagramFacebookReels ? ["INSTAGRAM_FACEBOOK_REELS" as const] : []),
    ];
    for (const target of targets) this.createPlatformPlan(workspace, video, channel, target, 1);
  }

  private createPlatformPlan(
    workspace: WorkspaceSnapshot,
    video: VideoProject,
    channel: Channel,
    target: PlatformAdaptationArtifact["target"],
    version: number,
    feedback?: string,
  ) {
    const createdAt = timestamp();
    const script = video.scripts.at(-1)!;
    const artifact: PlatformAdaptationArtifact = {
      id: randomUUID(), ownerId: video.ownerId, videoId: video.id, target, version,
      sourceScriptVersion: script.version, sourceMasterVersion: null, kind: "ADAPTATION_PLAN",
      status: "GENERATING", fixture: true, createdAt, updatedAt: createdAt,
    };
    video.platformArtifacts.push(artifact);
    this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_STARTED", video.id, { target, version, sourceScriptVersion: script.version, sourceMasterVersion: null });
    try {
      const input = { videoId: video.id, topic: video.topic, script, research: video.research!, preferences: channel.preferences, version, feedback };
      artifact.package = this.runAgent(workspace, video.ownerId, target === "TIKTOK" ? "TIKTOK_OPTIMIZER" : "REELS_OPTIMIZER", input, () => target === "TIKTOK" ? createTikTokPackage(input) : createReelsPackage(input));
      artifact.status = "QA_REQUIRED";
      artifact.qa = this.runAgent(workspace, video.ownerId, "PLATFORM_PACKAGE_QA", { artifactId: artifact.id, target, version }, () => reviewPlatformPackage(artifact.package!, video.research!));
      artifact.status = artifact.qa.verdict === "PASS" ? "REVIEW_REQUIRED" : "FAILED";
      artifact.updatedAt = timestamp();
      this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_QA_COMPLETED", video.id, { target, version, verdict: artifact.qa.verdict, status: artifact.status });
    } catch (error) {
      artifact.status = "FAILED";
      artifact.failure = error instanceof Error ? error.message : "Unknown platform adaptation failure";
      artifact.updatedAt = timestamp();
      this.audit(workspace, video.ownerId, "PLATFORM_ADAPTATION_FAILED", video.id, { target, version, error: artifact.failure });
    }
  }

  private handlePlatformArtifactDecision(workspace: WorkspaceSnapshot, ownerId: string, action: Extract<WorkflowAction, { type: "PLATFORM_ARTIFACT_DECISION" }>) {
    const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
    if (!video) throw new WorkflowError("Video project not found", 404);
    const artifact = video.platformArtifacts.filter((item) => item.target === action.target).at(-1);
    if (!artifact || artifact.version !== action.artifactVersion) throw new WorkflowError("Platform artifact version is not current", 409);
    if (artifact.status !== "REVIEW_REQUIRED") throw new WorkflowError("Platform artifact is not waiting for review", 409);
    video.platformApprovals.push({
      id: randomUUID(), ownerId, videoId: video.id, artifactId: artifact.id, target: artifact.target,
      artifactVersion: artifact.version, sourceScriptVersion: artifact.sourceScriptVersion,
      decision: action.decision, feedback: action.feedback, createdAt: timestamp(),
    });
    this.audit(workspace, ownerId, "PLATFORM_ARTIFACT_DECISION_RECORDED", video.id, { target: artifact.target, artifactId: artifact.id, artifactVersion: artifact.version, sourceScriptVersion: artifact.sourceScriptVersion, decision: action.decision });
    if (action.decision === "APPROVE") {
      artifact.status = "APPROVED";
      artifact.updatedAt = timestamp();
    } else {
      const channel = this.ownedChannel(workspace, ownerId, video.channelId);
      this.createPlatformPlan(workspace, video, channel, artifact.target, artifact.version + 1, action.feedback);
    }
    video.updatedAt = timestamp();
  }

  private recordConceptDecision(channel: Channel, conceptVersionId: string, viability: NonNullable<Channel["concepts"][number]["viability"]>, decision: ConceptDecision["decision"], feedback?: string) {
    channel.decisions.push({
      id: randomUUID(), conceptVersionId, viabilityReportVersion: viability.modelVersion,
      systemRecommendation: viability.recommendation, decision, feedback, createdAt: timestamp(),
    });
  }

  private runAgent<T>(workspace: WorkspaceSnapshot, ownerId: string, agent: string, input: unknown, operation: () => T): T {
    const startedAt = timestamp();
    const entityId = this.agentEntityId(input);
    const run: AgentRun = { id: randomUUID(), ownerId, agent, entityId, status: "STARTED", inputHash: hash(input), startedAt, costUsd: 0, fixture: true, provider: "deterministic-fixture", model: "fixture-contract-v1", outputVersion: 1, usage: { calls: 1 }, sourceProvenance: [], errorCode: null, retryOf: null };
    workspace.agentRuns.push(run);
    try {
      const output = operation();
      Object.assign(run, { status: "COMPLETED" as const, completedAt: timestamp(), ...this.agentOutputMetadata(output, input) });
      return output;
    } catch (error) {
      Object.assign(run, { status: "FAILED" as const, completedAt: timestamp(), errorCode: "FIXTURE_AGENT_FAILED", error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  }

  private async runAgentAsync<T>(workspace: WorkspaceSnapshot, ownerId: string, agent: string, input: unknown, provider: ReferenceResearchProvider, operation: () => Promise<T>): Promise<T> {
    const startedAt = timestamp();
    const entityId = this.agentEntityId(input);
    const priorFailure = workspace.agentRuns.findLast((item) => item.ownerId === ownerId && item.entityId === entityId && item.agent === agent && item.status === "FAILED");
    const run: AgentRun = { id: randomUUID(), ownerId, agent, entityId, status: "STARTED", inputHash: hash(input), startedAt, costUsd: 0, fixture: provider.mode === "fixture", provider: provider.providerName, model: provider.mode === "fixture" ? "fixture-contract-v1" : "provider-declared", outputVersion: 1, usage: { calls: 1 }, sourceProvenance: [], errorCode: null, retryOf: priorFailure?.id ?? null };
    workspace.agentRuns.push(run);
    try {
      const output = await operation();
      Object.assign(run, { status: "COMPLETED" as const, completedAt: timestamp(), ...this.agentOutputMetadata(output, input) });
      return output;
    } catch (error) {
      Object.assign(run, { status: "FAILED" as const, completedAt: timestamp(), errorCode: "REFERENCE_PROVIDER_FAILED", error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  }

  private agentEntityId(input: unknown) {
    if (!input || typeof input !== "object") return "workspace";
    const value = input as Record<string, unknown>;
    return String(value.channelId ?? value.videoId ?? value.buildProjectId ?? value.projectId ?? value.artifactId ?? value.sourceId ?? "workspace");
  }

  private agentOutputMetadata(output: unknown, input: unknown) {
    const value = output && typeof output === "object" ? output as Record<string, unknown> : {};
    const request = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const rawSources = Array.isArray(value.dataSources) ? value.dataSources : Array.isArray(value.sourceProvenance) ? value.sourceProvenance : [];
    const sourceProvenance = rawSources.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Record<string, unknown>;
      if (typeof source.url !== "string" || typeof source.accessedAt !== "string") return [];
      return [{ sourceId: String(source.sourceId ?? source.title ?? "source"), url: source.url, accessedAt: source.accessedAt }];
    });
    const version = value.version ?? request.version ?? request.planVersion ?? request.strategyVersion ?? request.specificationVersion ?? request.reportVersion ?? 1;
    return { outputVersion: typeof version === "number" ? version : 1, sourceProvenance };
  }

  private audit(workspace: WorkspaceSnapshot, ownerId: string, type: string, entityId: string, detail: Record<string, unknown>) {
    workspace.auditEvents.push({ id: randomUUID(), ownerId, type, entityId, at: timestamp(), detail });
  }

  private recordConversationChange(workspace: WorkspaceSnapshot, ownerId: string, action: WorkflowAction) {
    if (!("source" in action) || action.source !== "CONVERSATION") return;
    let channelId: string;
    let targetType: "REFERENCE_REPORT" | "BUSINESS_STRATEGY" | "MONETIZATION_PLAN" | "BUILD_SPECIFICATION" | "BUILD_ARTIFACT" | "SCRIPT";
    let targetId: string;
    let createdVersion: number;
    let instructions: string;

    if (action.type === "REVISE_REFERENCE_REPORT") {
      const channel = this.ownedChannel(workspace, ownerId, action.channelId); const result = channel.referenceReports.at(-1)!;
      channelId = channel.id; targetType = "REFERENCE_REPORT"; targetId = result.id; createdVersion = result.version; instructions = action.instructions;
    } else if (action.type === "BUSINESS_STRATEGY_DECISION") {
      const channel = this.ownedChannel(workspace, ownerId, action.channelId); const result = channel.businessStrategies.at(-1)!;
      channelId = channel.id; targetType = "BUSINESS_STRATEGY"; targetId = result.id; createdVersion = result.version; instructions = action.feedback!;
    } else if (action.type === "MONETIZATION_PLAN_DECISION") {
      const channel = this.ownedChannel(workspace, ownerId, action.channelId); const result = channel.monetizationPlans.at(-1)!;
      channelId = channel.id; targetType = "MONETIZATION_PLAN"; targetId = result.id; createdVersion = result.version; instructions = action.feedback!;
    } else if (action.type === "BUILD_SPEC_DECISION") {
      const project = this.ownedBuild(workspace, ownerId, action.buildProjectId); const result = project.specifications.at(-1)!;
      channelId = project.channelId; targetType = "BUILD_SPECIFICATION"; targetId = result.id; createdVersion = result.version; instructions = action.feedback!;
    } else if (action.type === "BUILD_ARTIFACT_DECISION") {
      const project = this.ownedBuild(workspace, ownerId, action.buildProjectId); const result = project.artifacts.at(-1)!;
      channelId = project.channelId; targetType = "BUILD_ARTIFACT"; targetId = result.id; createdVersion = result.version; instructions = action.feedback!;
    } else if (action.type === "SCRIPT_DECISION") {
      const video = workspace.videos.find((item) => item.id === action.videoId && item.ownerId === ownerId);
      if (!video) throw new WorkflowError("Video not found", 404);
      const result = video.scripts.at(-1)!; channelId = video.channelId; targetType = "SCRIPT"; targetId = video.id; createdVersion = result.version; instructions = action.feedback!;
    } else return;

    const createdAt = timestamp(); const messageId = randomUUID();
    workspace.conversationMessages.push({ id: messageId, ownerId, channelId, role: "USER", content: instructions, targetType, targetId, createdAt });
    workspace.changeRequests.push({ id: randomUUID(), ownerId, channelId, messageId, targetType, targetId, createdVersion, status: "APPLIED_AS_NEW_VERSION", instructions, createdAt });
    this.audit(workspace, ownerId, "CONVERSATIONAL_CHANGE_APPLIED", channelId, { targetType, targetId, createdVersion });
  }

  private ownedChannel(workspace: WorkspaceSnapshot, ownerId: string, id: string) {
    const channel = workspace.channels.find((item) => item.id === id && item.ownerId === ownerId);
    if (!channel) throw new WorkflowError("Channel not found", 404);
    return channel;
  }

  private ownedBuild(workspace: WorkspaceSnapshot, ownerId: string, id: string) {
    const project = workspace.buildProjects.find((item) => item.id === id && item.ownerId === ownerId);
    if (!project) throw new WorkflowError("Build project not found", 404);
    return project;
  }

  private forOwner(workspace: WorkspaceSnapshot, ownerId: string) {
    const channelIds = new Set(workspace.channels.filter((item) => item.ownerId === ownerId).map((item) => item.id));
    const videoIds = new Set(workspace.videos.filter((item) => item.ownerId === ownerId).map((item) => item.id));
    const buildIds = new Set(workspace.buildProjects.filter((item) => item.ownerId === ownerId).map((item) => item.id));
    const commerceIds = new Set([...workspace.products, ...workspace.purchases].filter((item) => item.ownerId === ownerId).map((item) => item.id));
    return {
      channels: workspace.channels.filter((item) => item.ownerId === ownerId),
      videos: workspace.videos.filter((item) => item.ownerId === ownerId),
      buildProjects: workspace.buildProjects.filter((item) => item.ownerId === ownerId),
      subscribers: workspace.subscribers.filter((item) => item.ownerId === ownerId),
      consentEvents: workspace.consentEvents.filter((item) => item.ownerId === ownerId),
      deliveryEvents: workspace.deliveryEvents.filter((item) => item.ownerId === ownerId),
      products: workspace.products.filter((item) => item.ownerId === ownerId),
      prices: workspace.prices.filter((item) => item.ownerId === ownerId),
      purchases: workspace.purchases.filter((item) => item.ownerId === ownerId),
      entitlements: workspace.entitlements.filter((item) => item.ownerId === ownerId),
      commerceEvents: workspace.commerceEvents.filter((item) => item.ownerId === ownerId),
      conversationMessages: workspace.conversationMessages.filter((item) => item.ownerId === ownerId),
      changeRequests: workspace.changeRequests.filter((item) => item.ownerId === ownerId),
      agentRuns: workspace.agentRuns.filter((item) => item.ownerId === ownerId),
      auditEvents: workspace.auditEvents.filter((item) => item.ownerId === ownerId && (channelIds.has(item.entityId) || videoIds.has(item.entityId) || buildIds.has(item.entityId) || commerceIds.has(item.entityId))),
    };
  }
}
