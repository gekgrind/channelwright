import {
  channelVideoExperimentResultSchema,
  videoExperimentQAResultSchema,
  type ApprovedVideoDecisionArtifact,
  type ChannelVideoExperimentResult,
  type ExperimentInvalidationCondition,
  type ExperimentSemanticIntent,
  type VideoExperimentConstraints,
  type VideoExperimentQAResult,
} from "@/domain/production-workflows";
import { canonicalEquals } from "./canonical-json";
import {
  harmfulTreatmentByFeatures,
  invalidationDomainContradiction,
  normalizeSemanticText,
  retentionPurposePresent,
  segmentSemClauses,
} from "./video-experiment-semantics";
import {
  deriveExperimentReady,
  deriveVideoExperimentConstraints,
  EXPERIMENT_TYPE_CONTROL_KIND,
  EXPERIMENT_TYPE_DISPOSITION,
  EXPERIMENT_TYPE_MEASUREMENT_ONLY,
  EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE,
} from "./video-experiment-constraints";

export type Finding = { severity: "error" | "warning" | "info"; code: string; message: string; evidenceIds: string[] };

export type ExperimentValidationContext = {
  result: ChannelVideoExperimentResult;
  artifact: ApprovedVideoDecisionArtifact;
  expectedConstraints: VideoExperimentConstraints;
  maxPayloadBytes: number;
};

export type ExperimentRule = { code: string; severity: Finding["severity"]; check: (ctx: ExperimentValidationContext) => string[] };

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
const PROMISE_RISK_ORDER = { NONE: 0, POSSIBLE: 1, LIKELY: 2 } as const;
const EVIDENCE_STRENGTH_CEILING = { STRONG: "high", MODERATE: "medium", WEAK: "low", NONE: "low" } as const;

// `prove` is only a forbidden causal-certainty assertion when it claims a
// mechanism was DEFINITIVELY PROVEN to cause something -- not when it is
// outcome-conditioned / copular ("if the reworked opening proves stronger",
// "the variant proves better", "tests stronger"), which is ordinary hypothetical
// language about what to do given a result. So `prove` requires an explicit
// causal complement (`prove that ...`, `prove(n) cause`, `prove causation`) or a
// certainty adverb; it is never matched bare.
const CAUSAL_CERTAINTY = /\b(?:causes?|caused|resulted in|led to|is the reason|responsible for|directly driv(?:e|es|en|ing)|made viewers|definitively explains|(?:definitively|conclusively|beyond doubt|for certain)\s+prov(?:e|es|ed|en|ing)\b|prov(?:e|es|ed|en|ing)\s+(?:that\b|causal\w*|causation|it\s+caused|(?:the\s+)?\w+(?:\s+\w+)?\s+caused)|prov(?:es|ed|en)\s+(?:the\s+)?(?:root\s+)?(?:cause|reason|driver)\b)/i;

// --- Fabricated-quantity detection ----------------------------------------
// The design contract is qualitative: any asserted magnitude, duration, sample
// size, or measurement is fabricated. But a bare number used as a LABEL
// ("variant 2", "arm 3", "episode 7", "phase 1") or as a structural COUNT that
// modifies an ordinary structural noun ("3-part hook", "2-part opening",
// "5-section outline") is not a fabricated measurement, so the detector
// distinguishes "a number next to a measurement noun / magnitude phrase" from
// "a number after a label noun" and "a number before a structural noun".
const CARDINAL = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion";
const QUANTITY_NOUN = "%|percent|per ?cent|percentage points?|points?|pp|x|hours?|hrs?|days?|weeks?|months?|years?|minutes?|mins?|seconds?|secs?|viewers?|views?|impressions?|sessions?|subscribers?|clicks?|comments?|likes?|shares?|samples?|participants?|responses?|data ?points?|videos?|episodes?|uploads?|dollars?|usd";
const DIGIT_RUN = /(?<![\p{L}\p{N}_:.-])\d[\d,]*(?:\.\d+)?/gu;
const YEAR = /^20\d\d$/;
const LABEL_BEFORE = /\b(?:variant|arm|cell|group|cohort|option|version|bucket|condition|phase|step|stage|episode|part|section|chapter|act|scene|beat|round|wave|batch|segment|treatment|control|slot|tier|level|panel|module|figure|table|appendix)s?\s*[#-]?\s*$/i;
// A measurement noun after the digit is a fabricated quantity. `%` / `percent`
// glued or spaced to the digit ("2%", "3 percent") must count as a measurement
// even though "%\b" has no trailing word boundary when a space follows -- so the
// noun is followed by a real word boundary OR by a non-alphanumeric character.
// Measurement syntax OUTRANKS the bare-label exemption below.
const QUANTITY_AFTER = new RegExp("^\\s*[- ]?(?:" + QUANTITY_NOUN + ")(?:\\b|(?![\\p{L}\\p{N}]))", "iu");
// A digit immediately before an ordinary structural noun is a count of narrative
// parts, not a measurement, threshold, sample size, or experiment parameter.
// Deliberately excludes ambiguous allocation nouns (segment / group / arm) and
// every measurement noun (those still fall through QUANTITY_AFTER and flag).
const STRUCTURAL_NOUN_AFTER = /^\s*[- ]?(?:parts?|steps?|sections?|chapters?|acts?|scenes?|beats?|phases?|stages?|episodes?|versions?|variants?|rounds?|tiers?|panels?|slides?|modules?)\b/i;
const SPELLED_QUANTITY = new RegExp("\\b(?:" + CARDINAL + ")(?:[- ](?:" + CARDINAL + "))?\\s+(?:" + QUANTITY_NOUN + ")\\b", "i");
const MAGNITUDE_CONTEXT = new RegExp(
  "\\b(?:at least|at most|no (?:fewer|less|more) than|up to|over|under|around|roughly|approximately|about|nearly|circa|minimum of|maximum of|target(?:ing)? (?:of )?|a target of|baseline (?:of|is|was|sits at|of about)|currently (?:at|around|about)|sits at|stands at|hovering around|on the order of|in the range of)\\s+(?:\\$?\\d|(?:" + CARDINAL + ")\\b)",
  "i",
);
const SAMPLE_SIZE = new RegExp(
  "\\b(?:n\\s*=\\s*\\d|(?:sample|cohort|holdout|group|arm|cell|audience|panel) (?:size )?of\\s+(?:\\d|(?:" + CARDINAL + ")\\b)|(?:\\d[\\d,]*|(?:" + CARDINAL + "))\\s+(?:per|each) (?:arm|cell|group|variant|condition|day|week)|sample size|effect size|(?:need|require|collect|gather|accumulate)\\s+(?:at least |about |roughly )?(?:\\d|(?:" + CARDINAL + ")\\b)\\s*(?:more )?(?:views|impressions|viewers|sessions|subscribers|clicks|comments|responses|samples|participants|data ?points))",
  "i",
);
const FABRICATED_STAT = /\b(?:statistical(?:ly)? significan\w*|p[-\s]?values?|confidence intervals?|significance (?:level|threshold|test)|power analysis|statistically powered|power(?:ed)? (?:to detect|for)|alpha of|effect sizes? of|minimum detectable effect|\bmde\b|chi[-\s]?squared?|t[-\s]?tests?|z[-\s]?tests?|bayes(?:ian)? factor|ninety[- ]?(?:five|nine) percent|95 ?%|99 ?%)/i;
const FABRICATED_FORECAST = /\b(?:\d+(?:\.\d+)?\s*x\s*(?:lift|increase|improvement|return)|expects? (?:a |an |some |roughly |around |about |significant |large |modest |small |substantial |meaningful |noticeable )*(?:lift|uplift|roi|return|gain|increase|improvement|bump|jump|boost|rise)|anticipat\w+ (?:a |an |some )?(?:lift|uplift|increase|improvement|gain|bump)|expected (?:lift|roi|return|gain|increase|improvement) of|projected (?:roi|revenue|lift|views|growth)|\d+(?:\.\d+)?\s*%\s*(?:lift|increase|improvement|uplift|gain)|(?:lift|uplift|bump|gain|increase|improvement) of (?:\d|about|roughly|around|approximately)|(?:double|triple|halve|quadruple) (?:the |our )?(?:ctr|click[- ]?through|retention|views|watch ?time|subscribers|engagement))/i;

// --- Status-quo / contradiction detection -------------------------------
// An INVESTIGATE / PRIORITIZE_CHANGE decision is testing a change or an open
// question. An experiment whose stated PURPOSE is to confirm or defend the
// current approach is rewriting the decision. (An interpretation-plan OUTCOME of
// "preserve" is fine and is not scanned here.)
// A PURPOSE / treatment-intent statement that concludes in advance that the
// approved Decision should not be acted on or tested is a semantic rewrite of the
// Decision. This captures the "leave it alone" families -- remain/stay unchanged,
// keep/retain the current thing, do not change, no change needed, further
// investigation unnecessary, status quo should remain -- not only the exact
// phrasings the round-1 detector listed.
const STATUS_QUO_INTENT = /\b(?:to (?:confirm|prove|show|demonstrate|validate|establish|verify|reassure (?:us|ourselves)) (?:that )?(?:the )?(?:current|existing|status[- ]?quo|present)\b|(?:should|must|will|to|shall)\s+(?:instead\s+)?(?:remain|stay|be kept|be left|be retained|be preserved|be maintained)\s+(?:unchanged|as[- ]?is|in place|the same|untouched|as it is)|(?:remains?|stays?|staying|remaining)\s+(?:unchanged|as[- ]?is|the same|untouched)|(?:preserve|preserving|keep|keeping|retain|retaining|maintain|maintaining)\s+(?:the\s+)?(?:current|existing|present)\s+\w+|leave\s+(?:the\s+|our\s+)?(?:current|existing|present)?\s*\w+\s+(?:as[- ]?is|unchanged|in place|alone|untouched|the same)|(?:the )?(?:current|existing|present) (?:approach|opening|hook|thumbnail|title|format|structure|packaging|design|version) is (?:fine|correct|best|optimal|working|effective|good enough|already (?:good|working))|(?:do|does|should)\s+not\s+(?:change|modify|alter|touch|test|revise)\b|no\s+(?:further\s+)?change\s+(?:is\s+)?(?:needed|warranted|required|necessary|justified)|(?:no\s+(?:further|additional)\s+(?:investigation|testing|study|experimentation|measurement)\s+(?:is\s+)?(?:necessary|needed|warranted|required|justified)|further\s+(?:investigation|testing|study|experimentation|measurement)\s+(?:is\s+)?(?:unnecessary|unwarranted|unneeded|not (?:needed|warranted|required|justified)))|no\s+need\s+(?:to|for)\s+(?:further\s+|additional\s+|any\s+)?(?:test|testing|investigat\w*|study\w*|experiment\w*|measur\w*)|(?:test|investigat\w*|study\w*|experiment\w*)\s+(?:it\s+|this\s+|the\s+\w+\s+)?(?:any\s+)?further\s+(?:is\s+)?(?:unnecessary|unwarranted|not\s+(?:needed|warranted|worthwhile))|no\s+(?:more|further|additional|extra|other)\s+(?:test(?:s|ing)?|investigat\w+|study|studies|studying|experiment\w*|measur\w+|analys\w+|research|iteration\w*|probing|exploration)\b(?:[^.;:!?]{0,40}?\b(?:needed|required|necessary|warranted|justified|called for|worthwhile|of value)\b)?|no\s+(?:reason|point|need|value|benefit)\s+(?:in\s+|to\s+)?(?:further\s+|additional\s+|any\s+|keep\s+)?(?:test\w*|investigat\w*|study\w*|experiment\w*|measur\w*|explor\w*)|(?:needs?|requires?|warrants?|calls?\s+for)\s+no\s+(?:further\s+|additional\s+|more\s+)?(?:experiment\w*|test\w*|testing|investigat\w*|study|studies|measur\w*|analysis|iteration\w*)|(?:current|existing|present|status[- ]?quo)\s+(?:\w+\s+){0,2}?(?:should|must|will|shall|is going to|is|are|has to|ought to|had better|gets? to)\s+(?:just |simply )?(?:stay|stays|staying|remain|remains|remaining|persist|persists|stand|stands|be left alone|be kept|be preserved|not change|carry on)\b|(?:current|existing|present|status[- ]?quo)\s+(?:\w+\s+){0,2}?(?:stay|stays|staying|remain|remains|remaining|persist|persists|carr(?:y|ies))\s+(?:for good|for ever|forever|put|the same|in place|on|as[- ]?is|unchanged|permanently)\b|(?:current|existing|present)\s+(?:opening|hook|thumbnail|title|version|format|approach|design|framing|cut|packaging|structure|one)\s+(?:just |simply |still )?(?:stay|stays|staying|remain|remains|remaining|persist|persists|is staying|is n['’]?t changing|does n['’]?t change|holds)\b|\b(?:stay|stays|staying)\s+put\b|\bhere to stay\b|\bthe opening is staying\b|status quo\s+(?:is (?:fine|correct|best|preferable|optimal)|should\s+(?:remain|stand|persist|be (?:kept|retained|preserved))))/i;
// A status-quo clause is a legitimate OUTCOME only when the SAME clause ties the
// preservation to a measured result -- a null / negative / inconclusive result,
// the treatment underperforming, a guardrail breach, or an actual control
// condition that preserves the current asset. A bare "if" / "unless" / "control"
// / "result" token elsewhere in the field no longer exempts unrelated status-quo
// intent (the round-3 OUTCOME_FRAME over-exemption): the exemption pattern now
// requires the outcome semantics themselves, and it is applied clause by clause
// (sentence / semicolon units; commas kept intact so "if X, preserve Y" stays
// one clause).
const OUTCOME_COND = "(?:if|should|when|whenever|were)";
const OUTCOME_JUSTIFIED_PRESERVE = new RegExp([
  OUTCOME_COND + "\\b[^.;!?]*\\b(?:treatment|variant|arm|change|rework(?:ed|ing)?|new\\s+\\w+|reworked\\s+\\w+|challenger|candidate|experimental\\s+\\w+)\\b[^.;!?]*\\b(?:under[- ]?perform\\w*|fails?\\b|failing\\b|does\\s+not\\s+(?:beat|improve|outperform|move|help|win)|(?:do|does|did)\\s+not\\s+beat|loses?\\b|losing\\b|is\\s+worse\\b|regress\\w*|shows?\\s+no\\b|no\\s+(?:better|improvement|lift|gain|signal|effect)|worse\\s+on)",
  "\\b(?:a\\s+)?null(?:[- ]result)?\\b",
  "\\b(?:negative|inconclusive|flat|non[- ]significant|unfavou?rable|no[- ]effect|adverse)\\s+(?:result|read|reading|outcome|finding|signal|effect)\\b",
  "\\bflat\\s+or\\s+negative\\s+result\\b",
  OUTCOME_COND + "\\b[^.;!?]*\\b(?:guardrail|safety\\s+metric|satisfaction|retention|viewer\\s+value|trust|promise\\s+integrity)\\b[^.;!?]*\\b(?:degrad\\w*|breach\\w*|is\\s+breached|drops?\\b|falls?\\b|declines?\\b|worsens?\\b|regress\\w*|is\\s+harmed|takes\\s+a\\s+hit)",
  "\\bcontrol\\s+(?:condition|arm|group|cell)\\s+(?:that\\s+|which\\s+|will\\s+|shall\\s+|would\\s+|to\\s+)?(?:preserv|keep|keeps|retain|retains|hold|holds|maintain|maintains|leav|us(?:e|es)|is\\b|serves)\\w*",
  "\\bwhen\\s+the\\s+treatment\\b[^.;!?]*\\b(?:under[- ]?perform\\w*|fails?\\b|loses?\\b|does\\s+not\\b|shows?\\s+no\\b)",
  OUTCOME_COND + "\\s+the\\s+(?:data|evidence|result|read|treatment|change|numbers?|reworked\\s+\\w+)\\b[^.;!?]*\\b(?:not\\b|fail|under[- ]?perform|show\\s+no|do(?:es)?\\s+not\\s+beat|are\\s+(?:flat|weak|negative))",
].join("|"), "i");

// --- Decision-purpose contradiction: the experiment must let the OUTCOME move
// the decision. Two families:
//   (a) plain status-quo purpose (STATUS_QUO_INTENT) -- contradictory UNLESS the
//       clause legitimately ties preservation to a measured outcome
//       (OUTCOME_JUSTIFIED_PRESERVE);
//   (b) unconditional immutability -- "keep the current/existing/control version
//       REGARDLESS of the result / whatever the outcome / even if it outperforms
//       / permanently" -- which is ALWAYS contradictory, even next to a valid
//       conditional, because a real experiment's result can change the decision.
// The mere presence of "result" / "control" / "outcome" / "experiment" never
// exempts (b).
const PRESERVE_CURRENT_VERB = /\b(?:preserv\w+|keep\w*|retain\w*|maintain\w*|(?:should|must|will|shall|is\s+going\s+to|are\s+going\s+to|intend\w*\s+to|plan\w*\s+to|mean\w*\s+to)\s+(?:just\s+)?(?:stay|stays|remain|remains|persist|stand|continue|be\s+kept)\b|(?:stay|stays|staying|remain|remains|remaining)\s+(?:for\s+good|for\s+ever|forever|put|in\s+place|the\s+same|as[- ]?is|unchanged|permanently)|stay\w*\s+put|stays?\s+the\s+same|remain\w*\s+(?:unchanged|as[- ]?is|in\s+place|the\s+same|untouched)|here\s+to\s+stay|left\s+(?:as[- ]?is|alone|untouched|in\s+place|the\s+same)|leave\s+(?:it|the\s+\w+|them|things)\s+(?:alone|as[- ]?is|unchanged|untouched|be)|(?:will|shall|is\s+going\s+to|are\s+going\s+to|wo\s?n['’]?t|will\s+not|is\s+not\s+going\s+to|is\s+n['’]?t\s+going\s+to)\s+(?:not\s+)?(?:be\s+)?(?:touched|changed|altered|modified|revised|adjusted|reworked|replaced|swapped|moved?|moving|budge[sd]?|budging|shift(?:ed|s|ing)?|change)\b|(?:lock\w*\s+in|locked\s+down|set\s+in\s+stone|nailed\s+down|fixed\s+in\s+place|non-?negotiable|off\s+the\s+table|not\s+up\s+for\s+(?:debate|discussion|change)|a\s+foregone\s+conclusion|already\s+(?:final|decided|settled)))/i;
const CURRENT_ASSET_REF = /\b(?:(?:current|existing|present|status[- ]?quo)\s+(?:\w+\s+){0,2}?(?:opening|hook|thumbnail|title|format|approach|design|framing|packaging|structure|cut|edit|version|one|way|setup|configuration|treatment|variant|content|video)|the\s+control\b|control\s+(?:version|arm|condition|group|cell|opening|hook|cut)?|what\s+we\s+(?:have|already\s+have|currently\s+use)|things?\s+as\s+they\s+are|the\s+status[- ]?quo|it\s+as[- ]?is|the\s+way\s+(?:it|things)\s+(?:is|are))\b/i;
const UNCONDITIONAL_MARKER = /\b(?:regardless(?:\s+of\s+(?:the\s+)?(?:result|results|outcome|data|read|reading|finding|findings|evidence|numbers?))?|whatever\s+(?:the\s+)?(?:result|results|outcome|data|read|reading|finding|findings|numbers?|metrics?|happens?)|whatever\s+(?:we|you|the\s+team)\s+(?:see|sees|find|finds|learn|learns|observe|observes|get|gets|discover|discovers|turn\s+up|turns\s+up)|nothing\s+(?:this|the)\s+(?:experiment|test|run|trial|comparison)\s+(?:turns\s+up|shows|reveals|finds|produces)\s+(?:will|would|can|could)|however\s+(?:the\s+)?(?:result|results|outcome|data|metrics?|numbers?|read|experiment|it|things?)\s+(?:move|moves|moved|land|lands|fall|falls|come\s+out|comes\s+out|turn\s+out|turns\s+out|shake\s+out|shakes\s+out|go|goes|play\s+out)|no\s+matter\s+(?:the\s+(?:result|outcome|data|metrics?)|what(?:\s+(?:the\s+)?(?:result|data|evidence|numbers?)\s+says?)?|how\s+(?:the\s+)?(?:numbers?|metrics?|data|results?)\s+(?:land|move|fall|come\s+out))|whether\s+or\s+not\b|whether\s+(?:the\s+)?(?:it|treatment|challenger|variant|candidate|they|results?|data|test)\s+(?:wins?|loses?|outperform\w*|underperform\w*|succeeds?|fails?|arrive|arrives|come|comes|helps?|says?)|win\s+or\s+lose|wins?\s+or\s+loses?|either\s+way|come\s+what\s+may|even\s+if\s+(?:it|the\s+treatment|the\s+challenger|the\s+variant|the\s+candidate|they|results?)\s+(?:outperform\w*|out-?perform\w*|wins?|beats?|succeeds?|improves?|helps?|is\s+better)|permanent(?:ly)?|for\s+good\b|forever\b|for\s+all\s+time|in\s+perpetuity|non-?negotiable|locked\s+in\s+for\s+good|no\s+more\s+(?:testing|experiment\w*|investigat\w*)\s+(?:is\s+)?(?:needed|required|necessary|warranted)|(?:the\s+)?(?:result|results|outcome|data|evidence|read|finding)\s+(?:cannot|can'?t|won'?t|will\s+not|shan'?t|is\s+not\s+going\s+to)\s+(?:change|alter|affect|move|sway|shift|overturn|influence)\s+(?:the\s+|this\s+|our\s+|any\b)?(?:decision|call|plan|choice|outcome))\b/i;
// Explicit refusal to act on the decision.
const NO_INTENT_TO_CHANGE = /\b(?:no\s+(?:reason|intention|intent|plan|plans|desire|willingness|appetite|need|wish|basis|grounds|case|point)\s+(?:whatsoever\s+)?(?:in\s+|to\s+|for\s+|of\s+)?(?:ever\s+)?|not\s+(?:prepared|willing|going|planning|about|inclined|of\s+a\s+mind)\s+to\s+|(?:wo\s?n['’]?t|will\s+not|refuse[sd]?\s+to|declin(?:e|es|ed)\s+to|have\s+no\s+plans\s+to)\s+)(?:chang\w+|alter\w*|modif\w+|revis\w+|touch\w*|adjust\w*|rework\w*|replac\w+|updat\w+|swap\w*|switch\w*|change\s+course|mov(?:e|ing)\s+(?:on|away)\s+from)\b/i;
const SKIP_EXPERIMENT = /\b(?:skip|skipping|forgo|forgoing|forego|foregoing|cancel\w*|call\s+off|calling\s+off|called\s+off|drop\w*|abandon\w*|ignore|ignoring|bypass\w*|do\s+without|no\s+need\s+for|dispense\s+with|scrap\w*|shelve\w*|waive)\s+(?:the\s+|this\s+|any\s+|our\s+)?(?:experiment|test|trial|a[/-]?b\s+test|comparison|study|measurement)\b/i;
const KEEP_WHAT_WE_HAVE = /\bkeep\s+(?:what\s+we\s+(?:have|already\s+have)|things?\s+(?:as\s+(?:they\s+are|is)|the\s+same)|the\s+(?:current|existing|present)|it\s+(?:as[- ]?is|the\s+same)|the\s+status[- ]?quo)\b/i;
// The decision/asset is declared fixed -- immutability phrasing that is
// contradictory whenever it attaches to the current/control version.
const IMMUTABLE_PHRASE = /\b(?:set\s+in\s+stone|carved\s+in\s+stone|written\s+in\s+stone|locked\s+(?:in|down)|nailed\s+down|non-?negotiable|off\s+the\s+table|not\s+up\s+for\s+(?:debate|discussion|change|grabs)|a\s+foregone\s+conclusion|already\s+(?:final|finali[sz]ed|decided|settled|made)|final\s+and\s+(?:will\s+not|wo\s?n['’]?t)\s+change|here\s+to\s+stay|staying\s+for\s+good|for\s+good\s+regardless)\b/i;
// The experiment's result is declared powerless to move the decision.
const RESULT_CANNOT_MOVE = /\b(?:experiment|test|trial|comparison|result|results|outcome|data|read|finding|numbers?)\s+(?:cannot|can\s?not|can'?t|wo\s?n['’]?t|will\s+not|shall\s+not|is\s+not\s+going\s+to|are\s+not\s+going\s+to|has\s+no\s+power\s+to|is\s+powerless\s+to)\s+(?:change|alter|overturn|affect|move|sway|shift|influence|reverse|undo|reopen)\b/i;
const PURPOSE_ASSET_NOUN = /\b(?:opening|hook|thumbnail|title|format|approach|design|framing|packaging|structure|cut|edit|version|hook)\b/i;

// --- Decision-purpose relation model ------------------------------------
// The invariant is a RELATION, not a phrase set: an experiment may preserve the
// current asset ONLY as a consequence of a measured experiment OUTCOME. Two
// contradiction families, expressed structurally:
//   (b) immutability -- the outcome is declared powerless to move the decision
//       (regardless of the result / even if the challenger wins / predetermined /
//       ceremonial / documentation-only / "for keeps"). Field-wide and always
//       contradictory; a valid conditional clause elsewhere does not rescue it.
//   (a) plain status-quo intent that is NOT tied, in its own clause, to a
//       measured outcome (treatment underperforms / null / inconclusive /
//       guardrail breach / "unless it improves" / preservation explicitly
//       pending another run).
// Legitimate outcome-conditioned preservation ("keep the current opening unless
// the treatment shows a clear improvement", "if the result is inconclusive, keep
// it pending a second run") satisfies (a)'s exemption and carries no (b) signal,
// so it passes.

// Extension to OUTCOME_JUSTIFIED_PRESERVE: `unless` + challenger-success ("keep X
// unless the treatment improves"), the reversed word order ("the result is
// inconclusive" as well as "an inconclusive result"), and preservation that is
// explicitly provisional ("pending a second run / more data").
const OUTCOME_JUSTIFIED_PRESERVE_EXT = new RegExp([
  "\\bunless\\b[^.;!?]*\\b(?:improv\\w*|better|stronger|superior|beat\\w*|out-?perform\\w*|win\\w*|succeed\\w*|clear(?:\\s+and)?\\s+(?:sustained\\s+)?(?:improvement|gain|win|lift|advantage)|shows?\\s+(?:a\\s+)?(?:clear|sustained|meaningful|significant|real)\\b|lift\\w*|gain\\w*|move\\w*\\s+the\\s+(?:metric|needle))",
  "\\b(?:result\\w*|read(?:out|ing)?|outcome\\w*|finding\\w*|data|evidence|signal\\w*|number\\w*|comparison|effect)\\b\\s+(?:is|are|was|were|turns?\\s+out|comes?\\s+(?:back|out)|looks?|reads?|remains?|proves?\\s+(?:to\\s+be\\s+)?)\\s+(?:\\w+\\s+){0,3}?(?:inconclusive|null|negative|flat|adverse|unfavou?rable|non-?significant|weak|unclear|mixed|ambiguous|murky|opaque|cloudy|hazy|muddy|noisy|hard\\s+to\\s+read|hard-to-read|a\\s+wash|not\\s+(?:clear|significant|conclusive|meaningful))",
  "\\b(?:inconclusive|adverse|null|flat|negative|ambiguous|non-?significant|unfavou?rable|murky|opaque|hard[- ]to[- ]read|hard\\s+to\\s+read)\\b[^.;!?]{0,25}?\\b(?:read(?:out|ing)?|outcome\\w*|result\\w*|finding\\w*|signal\\w*|effect|comparison)\\b",
  "\\bpending\\s+(?:a\\s+|the\\s+|another\\s+|further\\s+|more\\s+)?(?:second|another|further|additional|repeat|follow[- ]?up|new|fresh)\\s+(?:run|test|read(?:out)?|window|experiment|comparison|data|measurement|pass|rerun|re-?run)",
  "\\b(?:until|pending|awaiting)\\s+(?:a\\s+|the\\s+|another\\s+)?(?:re-?run|rerun|repeat(?:\\s+run)?|second\\s+run|follow[- ]?up|another\\s+read|another\\s+window|more\\s+data)\\b",
  "\\bpending\\s+more\\s+data\\b",
].join("|"), "i");

// (b) immutability markers not tied to the current/asset-preserve phrasings.
const IMMUTABLE_CHALLENGER_WINS = /\b(?:challenger|treatment|variant|candidate|rework(?:ed|ing)?|new\s+(?:version|opening|hook|cut|framing|thumbnail)|alternate\s+\w+)\b[^.;!?]{0,55}?\b(?:can|could|may|might)\s+(?:win|beat\s+\w+|come\s+out\s+ahead|prove\s+\w+|be\s+(?:stronger|better))\b[^.;!?]{0,55}?\b(?:but|still|yet|cannot|can\s+not|will\s+not|wo\s+not|nonetheless|nevertheless|even\s+so|regardless)\b[^.;!?]{0,35}?\b(?:will\s+not|wo\s+not|cannot|can\s+not|is\s+not\s+going\s+to|still)\s*(?:be\s+)?(?:ship\w*|adopt\w*|use\w*|go\s+live|replace\w*|change\s+anything|win\s+out|matter)?\b/i;
const CHALLENGER_WINS_NO_SHIP = /\b(?:can|could|may|might)\s+(?:win|beat\s+\w+|come\s+out\s+ahead|prove\s+\w+|be\s+(?:stronger|better|the\s+winner))\b[^.;!?]{0,70}?\b(?:but|yet|still|however|nonetheless|regardless)\b[^.;!?]{0,45}?\b(?:will\s+not|wo\s+not|cannot|can\s+not|is\s+not\s+going\s+to|shall\s+not)\s+(?:be\s+)?(?:ship\w*|adopt\w*|be\s+used|go\s+live|replace\w*|win\s+out|change\s+(?:anything|the\s+\w+))\b/i;
const CEREMONIAL_RUN = /\b(?:ceremonial|box[- ]?ticking|box\s+ticking|rubber[- ]?stamp\w*|going\s+through\s+the\s+motions|a\s+(?:mere\s+)?formality|for\s+show\b|window[- ]dressing|dog[- ]and[- ]pony|for\s+the\s+record\s+only|purely\s+(?:performative|symbolic|cosmetic|for\s+optics)|(?:a\s+)?(?:dry\s+run|practice\s+run|dress\s+rehearsal|dummy\s+run|warm-?up\s+run)|(?:just|merely|only|purely)\s+(?:for\s+)?practice|\bas\s+(?:a\s+)?(?:practice|rehearsal|warm-?up|dry\s+run|trial\s+run|dress\s+rehearsal)\b|\btreat\w*\s+(?:this|it|the\s+run)\s+as\s+(?:a\s+)?(?:practice|rehearsal|dry\s+run|formality|box[- ]?ticking))\b/i;
const DOCUMENTATION_ONLY_RUN = /\b(?:merely|only|just|simply|purely|nothing\s+more\s+than)\s+(?:to\s+)?(?:document\w*|record\w*|catalogu?\w*|log\w*|note\w*|show\w*|measur\w*|illustrat\w*|chronicl\w*|describ\w*|report\w*|observ\w*|capture\w*)\b[^.;!?]{0,55}?\b(?:performance|challenger\w*|result\w*|difference\w*|number\w*|outcome\w*|it|the\s+comparison|the\s+two)\b|\b(?:the\s+)?(?:test|run|experiment|comparison|trial|exercise)\s+(?:merely|only|just|simply|purely)\s+(?:document\w*|record\w*|measur\w*|show\w*|log\w*|note\w*|illustrat\w*|observ\w*|capture\w*)\b|\b(?:this|the)\s+(?:comparison|run|test|experiment|exercise|trial)\s+is\s+(?:purely\s+|merely\s+|just\s+|only\s+|strictly\s+)?(?:informational|for\s+information|documentary|for\s+the\s+record|a\s+formality|diagnostic\s+only|observational\s+only)\b/i;
const PREDETERMINED_DECISION = /\b(?:outcome\w*|decision\w*|call|choice\w*|answer\w*|result\w*|conclusion\w*|winner|verdict)\b[^.;!?]{0,40}?\b(?:was|is|has\s+been|had\s+been|were)\s+(?:already\s+)?(?:settled|decided|determined|made|fixed|chosen|sealed|locked(?:\s+(?:in|down))?|predetermined|a\s+foregone\s+conclusion)\b|\b(?:settled|decided|determined|chosen|fixed|sealed|locked(?:\s+(?:in|down))?)\b[^.;!?]{0,30}?\b(?:before|ahead\s+of|in\s+advance|prior\s+to|up\s+front|from\s+the\s+(?:start|outset))\b[^.;!?]{0,25}?\b(?:data|result\w*|run|test|experiment|evidence|number\w*|comparison|anything)\b|\bdecid\w*\s+in\s+advance\b|\bpre-?determin\w*\b|\bmade\s+up\s+(?:our|my|their)\s+mind\w*\s+(?:before|already|in\s+advance)\b/i;
const RESULT_NO_WEIGHT = /\b(?:finding\w*|result\w*|outcome\w*|data|comparison|number\w*|read(?:out)?|winner|whichever\s+\w+\s+wins?|which\s+\w+\s+wins?)\b[^.;!?]{0,45}?\b(?:carr(?:y|ies|ied)|have|has|hold\w*|bear\w*|count\w*|weigh\w*)\s+(?:no|little|zero)\s+(?:weight|bearing|sway|influence|force|say|impact|part)\b|\b(?:finding\w*|result\w*|outcome\w*|comparison|winner|which(?:ever)?\s+\w+\s+wins?)\b[^.;!?]{0,40}?\b(?:changes?\s+nothing|makes?\s+no\s+difference|does\s+not\s+matter|doesn['’]?t\s+matter|is\s+irrelevant|has\s+no\s+bearing|is\s+moot|is\s+decoupled\s+from|will\s+not\s+affect\s+(?:what|the\s+decision))\b|\b(?:outcome\w*|result\w*|finding\w*|read(?:out)?|comparison|winner)\b[^.;!?]{0,25}?\bbear\w*\s+on\s+nothing\b|\b(?:has|have)\s+no\s+bearing\s+on\b[^.;!?]{0,40}?\b(?:which|what|whether)\b[^.;!?]{0,25}?\b(?:cut|opening|hook|version|framing|thumbnail|title)\b|\bno\s+(?:weight|bearing|say|influence|impact|effect|role|part|input)\b[^.;!?]{0,30}?\b(?:over|on|in|about|regarding|as\s+to|toward\w*|when\s+it\s+comes\s+to)\b[^.;!?]{0,35}?\b(?:which|what|whether|the)\b[^.;!?]{0,25}?\b(?:ship\w*|adopt\w*|framing|version|opening|hook|cut|decision|choice|change|win\w*|go(?:es)?\s+live)\b/i;
const EXTRA_UNCONDITIONAL = /\bregardless\s+of\s+(?:what|how)\s+(?:the\s+)?(?:run|test|experiment|comparison|data|it|this|number\w*)\s+(?:show\w*|reveal\w*|find\w*|say\w*|turn\w*\s+up|produce\w*|come\w*\s+up\s+with|land\w*|fall\w*|shake\w*\s+out|play\w*\s+out)\b|\bno\s+matter\s+(?:what|how)\s+(?:the\s+)?(?:run|test|experiment|comparison|data|number\w*|result\w*|it)\b|\bshould\s+the\s+(?:challenger|fresh\s+\w+|new\s+\w+|alternate\s+\w+|reworked?\s+\w+)\b[^.;!?]{0,40}?\b(?:turn\s+out\s+|come\s+out\s+|prove\s+|edge\s+)?(?:strong\w*|better|superior|ahead|the\s+winner|on\s+top)\b|\beven\s+(?:if|when|where|though|should)\s+(?:it|the\s+\w+|they|challenger|alternate\s+\w+|fresh\s+\w+|new\s+\w+|which\w*\s+\w+)\b[^.;!?]{0,30}?\b(?:win\w*|beat\w*|out-?perform\w*|stronger|better|ahead|superior|succeed\w*|edge\s+(?:ahead|out|past)|come\w*\s+out\s+ahead)\b|\ball\s+the\s+same\b/i;
const EXTRA_IMMUTABLE_PHRASE = /\bfor\s+keeps\b|\bin\s+place\s+for\s+keeps\b|\b(?:stay\w*|remain\w*|kept|keep\w*)\s+in\s+service\b|\bin\s+service\s+(?:afterward|either\s+way|regardless)\b|\b(?:is|are)\s+not\s+going\s+anywhere\b|\bgoing\s+nowhere\b|\bnot\s+for\s+moving\b/i;
// Challenger success is conceded / hypothesised and the consequence is still to
// keep the current asset ("even if it wins, keep current") -- not the legitimate
// "if it wins, adopt it".
const CHALLENGER_SUCCESS = /\b(?:challenger|treatment|variant|candidate|rework(?:ed|ing)?|new\s+(?:version|opening|hook|cut|framing|thumbnail)|alternate\s+(?:hook|opening|version|thumbnail|cut)|experimental\s+\w+|which\s?ever\s+(?:hook|version|opening|option|arm|cut|one)|it|they)\b[^.;!?]{0,55}?\b(?:turn(?:s|ed)?\s+out\s+)?(?:prov(?:e|es|ed|en)\s+)?(?:come(?:s)?\s+out\s+)?(?:strong\w*|better|superior|ahead|winning|the\s+winner|out-?perform\w*|beat\w*|wins?\b|won\b|succeed\w*|improv\w*\s+(?:on|over|things)|is\s+better|does\s+better|come\w*\s+out\s+(?:ahead|on\s+top))\b/i;
// The current asset persists via ANY persistence predicate ("rides", "stands",
// "isn't going anywhere", "carries on", "remains in service") -- broader than
// PRESERVE_CURRENT_VERB, used only alongside an immutability / irrelevance
// marker so an ordinary "the opening stays put once we pick a winner" is not
// swept in on its own.
const ASSET_PERSISTS = /\b(?:ride\w*|stand\w*|persist\w*|carr(?:y|ies|ying)\s+on|stick\w*\s+around|is\s+not\s+going\s+anywhere|are\s+not\s+going\s+anywhere|here\s+to\s+stay|hold\w*\s+(?:firm|steady|fast)|live\w*\s+on|stay\w*\s+in\s+(?:place|service|use|the\s+lineup)|remain\w*\s+in\s+(?:place|service|use)|continu\w*\s+in\s+(?:place|service|use)|keep\w*\s+(?:its\s+)?(?:slot|spot|place)|in\s+the\s+lineup\s+(?:regardless|either\s+way|afterward))\b/i;
const ADOPT_CHALLENGER = /\b(?:adopt\w*|ship\w*|switch\w*\s+to|roll\w*\s+out|go\s+with|move\s+to|take\s+up)\s+(?:it\b|the\s+challenger|the\s+treatment|the\s+new\s+\w+|the\s+rework\w*|the\s+variant|the\s+candidate)\b/i;
// Passive / participial preservation the active PRESERVE_CURRENT_VERB misses
// ("is kept", "was retained", "is left as is", "are not moving/changing it").
const PRESERVE_PARTICIPLE = /\b(?:is|are|was|were|be|been|being|stay\w*|remain\w*|gets?|got)\s+(?:\w+ly\s+|then\s+|nonetheless\s+|still\s+|simply\s+)?(?:kept|retained|preserved|maintained|held(?:\s+in\s+place)?|frozen|locked(?:\s+(?:in|down))?|left\s+(?:alone|as\s+is|untouched|in\s+place|the\s+same))\b|\b(?:are|were|is|was)\s+not\s+(?:going\s+to\s+be\s+)?(?:touch\w*|chang\w*|alter\w*|modif\w*|revis\w*|adjust\w*|rework\w*|replac\w*|swap\w*|mov\w*|budg\w*|shift\w*|dropp\w*)\b/i;

const assetRef = (clause: string): boolean =>
  CURRENT_ASSET_REF.test(clause) || PURPOSE_ASSET_NOUN.test(clause) || /\b(?:incumbent|the\s+existing\s+\w+)\b/i.test(clause);

const clauseOutcomeConditioned = (clause: string): boolean =>
  OUTCOME_JUSTIFIED_PRESERVE.test(clause) || OUTCOME_JUSTIFIED_PRESERVE_EXT.test(clause);

/** (b) A decision-immutability signal -- always contradictory, wherever it sits. */
function clauseAssertsImmutability(clause: string): boolean {
  const asset = assetRef(clause);
  const unconditional = UNCONDITIONAL_MARKER.test(clause) || EXTRA_UNCONDITIONAL.test(clause);
  const preserve = asset && (PRESERVE_CURRENT_VERB.test(clause) || ASSET_PERSISTS.test(clause) || PRESERVE_PARTICIPLE.test(clause));
  if (preserve && unconditional) return true;
  if (STATUS_QUO_INTENT.test(clause) && unconditional) return true;
  // asset + an unconditional marker + a bare persistence verb ("however the read
  // shakes out, the opening we run today stays") -- safe because the
  // unconditional marker is itself decisive.
  if (asset && unconditional && /\b(?:stay\w*|remain\w*|stand\w*|hold\w*|keep\w*|kept|ride\w*|carr(?:y|ies|ying)\s+on)\b/i.test(clause)) return true;
  if (asset && (IMMUTABLE_PHRASE.test(clause) || EXTRA_IMMUTABLE_PHRASE.test(clause))) return true;
  if (RESULT_CANNOT_MOVE.test(clause) || RESULT_NO_WEIGHT.test(clause)) return true;
  if (NO_INTENT_TO_CHANGE.test(clause)) return true;
  if (CEREMONIAL_RUN.test(clause) || DOCUMENTATION_ONLY_RUN.test(clause) || PREDETERMINED_DECISION.test(clause)) return true;
  if (IMMUTABLE_CHALLENGER_WINS.test(clause)) return true;
  return false;
}

/** (b) cross-clause: challenger success conceded, consequence still keeps current. */
function fieldConcedesSuccessButKeeps(clauses: string[]): boolean {
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i];
    if (!CHALLENGER_SUCCESS.test(c)) continue;
    // "keep X unless it improves" / "if it wins, adopt it" -- legitimate.
    if (/\b(?:unless|only\s+if|provided|as\s+long\s+as)\b/i.test(c)) continue;
    if (clauseOutcomeConditioned(c)) continue;
    if (ADOPT_CHALLENGER.test(c)) continue;
    const sib = [c, clauses[i + 1] ?? "", clauses[i - 1] ?? ""].join(" ");
    const keepsCurrent =
      ((PRESERVE_CURRENT_VERB.test(sib) || ASSET_PERSISTS.test(sib) || PRESERVE_PARTICIPLE.test(sib)) && assetRef(sib)) ||
      STATUS_QUO_INTENT.test(sib) ||
      KEEP_WHAT_WE_HAVE.test(sib);
    if (!keepsCurrent || ADOPT_CHALLENGER.test(sib)) continue;
    return true;
  }
  return false;
}

/** (a) plain status-quo intent (any of the "leave it alone" families). */
function clauseIsPlainStatusQuo(clause: string): boolean {
  if (NO_INTENT_TO_CHANGE.test(clause)) return true;
  if (SKIP_EXPERIMENT.test(clause) && (PRESERVE_CURRENT_VERB.test(clause) || KEEP_WHAT_WE_HAVE.test(clause))) return true;
  if (KEEP_WHAT_WE_HAVE.test(clause)) return true;
  return STATUS_QUO_INTENT.test(clause);
}

function purposeFieldContradicts(text: string): boolean {
  const clauses = segmentSemClauses(text).map((c) => c.norm);
  // Whole-field idioms whose two halves the clause splitter separates
  // ("the challenger can win, but it still will not ship"; "the winner here
  // changes nothing about what ships"). Use the normalised full text so the
  // contrastive coordinator the splitter consumes is still visible.
  const whole = normalizeSemanticText(text);
  if (CHALLENGER_WINS_NO_SHIP.test(whole) || IMMUTABLE_CHALLENGER_WINS.test(whole) || RESULT_NO_WEIGHT.test(whole)) return true;
  if (clauses.some(clauseAssertsImmutability)) return true;
  if (fieldConcedesSuccessButKeeps(clauses)) return true;
  return clauses.some((clause) => clauseIsPlainStatusQuo(clause) && !clauseOutcomeConditioned(clause));
}
const GUARDRAIL_OVERRIDE = /\b(?:ignore|override|overrule|disregard|bypass|wave away|set aside|push past)\s+(?:the |any |a )?(?:guardrail|degradation|breach|threshold|red[- ]?line|stopping condition|harm signal)/i;
const CONTINUE_NEAR_GUARDRAIL = /(?:\b(?:continue|proceed|keep going|carry on|press on|forge ahead|push (?:on|ahead)|do not (?:stop|halt|pause|revert|roll ?back)|don'?t (?:stop|halt|pause|revert))\b[^.]{0,90}?\b(?:guardrail|degrad|breach|threshold|red[- ]?line|harm signal|regression)\b)|(?:\b(?:guardrail|degrad(?:es|ing|ation)?|breach|threshold breach|red[- ]?line|harm signal)\b[^.]{0,90}?\b(?:continue|proceed|keep going|carry on|press on|forge ahead|still (?:ship|run|adopt|continue)|do not (?:stop|halt|require stopping)|regardless|anyway|nonetheless|is (?:acceptable|tolerable|fine|ok))\b)/i;
const ROLLBACK_NOT_REVERTING = /\b(?:continue|keep|maintain|leave|retain|preserve|hold|stay with|do not (?:revert|roll ?back|undo|restore|remove|withdraw|change back))\b[^.]{0,60}?\b(?:the |our )?(?:treatment|change|new |reworked |updated |modified )?(?:opening|thumbnail|hook|title|version|variant|format|approach|design|framing|treatment|change)/i;
// An invalidation criterion must name an event/state that can actually occur in
// the experiment. This rejects criteria that are impossible by construction. It
// is deliberately scoped (in the rule below) to the invalidationConditions field
// only, so an ordinary analytical "X cannot happen because Y is held constant"
// elsewhere in the design is untouched, and a legitimate failure condition that
// merely involves an inability ("invalidate if the metric cannot be measured
// reliably", "if the treatment cannot be delivered consistently") is not caught:
// the ban is on "the criterion itself can never occur", not on the word "cannot".
// The ban is on an invalidation CONDITION that is impossible by construction --
// "the criterion itself can never occur / trigger / activate" -- NOT on the word
// "cannot". A legitimate failure condition that merely involves an inability
// ("invalidate if the metric cannot be measured", "if data cannot be collected",
// "if the treatment cannot be delivered", "if tracking cannot be trusted") must
// still pass, so the occurrence verbs below deliberately exclude measurement /
// delivery / collection / trust verbs.
const IMPOSSIBLE_ADVERB = "(?:ever\\s+|possibly\\s+|conceivably\\s+|realistically\\s+|actually\\s+|in\\s+practice\\s+)?";
const IMPOSSIBLE_OCCUR = "(?:happen|occur|arise|materiali[sz]e|trigger|triggered|fire|activate|come\\s+about|take\\s+place|be\\s+" + IMPOSSIBLE_ADVERB + "(?:met|satisfied|reached|triggered|realized|realised|true|fulfilled|activated))";
const INCOHERENT_INVALIDATION = new RegExp(
  "\\b(?:" +
  "(?:can|could|will|would|shall|does|did)\\s*(?:not|never)\\s+" + IMPOSSIBLE_ADVERB + IMPOSSIBLE_OCCUR +
  "|never\\s+" + IMPOSSIBLE_ADVERB + "(?:happens?|occurs?|arises?|triggers?|fires?|activates?|possible|going\\s+to\\s+(?:happen|occur|trigger)|be\\s+(?:met|satisfied|reached|triggered))" +
  "|cannot\\s+" + IMPOSSIBLE_ADVERB + IMPOSSIBLE_OCCUR +
  "|is\\s+(?:logically\\s+|physically\\s+|simply\\s+|flatly\\s+|literally\\s+|just\\s+)?impossible" +
  "|(?:inconceivable|unthinkable|unimaginable|unfathomable|beyond\\s+belief|absurd|ludicrous|preposterous|hard|impossible)\\s+(?:to\\s+(?:think|imagine|believe|conceive|suppose)\\s+)?that\\s+(?:anything|any\\s+\\w+|it|this|the\\s+\\w+|such\\s+a\\s+\\w+)\\b[^.;:!?]{0,40}?\\b(?:could|would|can|might|will)\\b" +
  "|impossible\\s+(?:for\\s+[^.;:!?]{0,50}?\\s+)?to\\s+(?:be\\s+)?(?:satisfy|satisfied|trigger|triggered|meet|met|reach|reached|occur|happen|achieve|attain|arise|fire|activate|activated)" +
  "|incapable\\s+of\\s+(?:ever\\s+)?(?:occurring|happening|arising|triggering|activating|firing|being\\s+(?:met|triggered|reached|satisfied))" +
  "|(?:zero|no|0\\s*%?|nil|non-?existent)\\s+(?:\\w+\\s+){0,2}?(?:chance|possibility|probability|likelihood|odds|prospect)\\s+of\\s+(?:ever\\s+)?(?:activation|activating|triggering|occurring|occurrence|happening|firing|being\\s+(?:met|triggered|reached|satisfied))" +
  "|no\\s+(?:\\w+\\s+){0,3}?(?:scenario|world|universe|situation|circumstance|condition|case|reality|way|path|route|means|mechanism|avenue|combination|chain|sequence)s?\\b[^.;:!?]{0,40}?\\b(?:for\\b|in\\s+which|by\\s+which|through\\s+which|where\\b|whereby\\b|under\\s+which|that\\s+would|that\\s+could|could\\s+(?:ever|this|the|it|that)|would\\s+(?:ever|this|the|it|that)|exists?\\b|arises?\\b|obtains?\\b|this\\s+\\w+\\s+(?:ever\\s+)?(?:activates?|triggers?|fires?))" +
  "|under\\s+no\\s+(?:\\w+\\s+){0,3}?(?:circumstances?|conditions?|scenario|situation)\\b" +
  "|nothing\\s+(?:that\\s+(?:could|would|can|might)\\s+(?:ever\\s+)?(?:happen|occur|arise|be\\s+done)\\s+)?(?:could|would|can|will|might)\\b[^.;:!?]{0,40}?\\b(?:activate|trigger|fire|set\\s+.{0,10}?off|cause|make\\s+.{0,15}?(?:fire|trigger)|meet|satisfy|happen|occur)\\b" +
  "|nothing\\s+(?:could|would|can|will)\\b" +
  "|not\\s+applicable\\b" +
  // "guaranteed / certain / bound to remain dormant / inactive", "inactive forever"
  "|(?:guaranteed|certain|sure|bound|assured|destined|doomed|100%\\s+(?:going\\s+)?)\\s+(?:to\\s+|of\\s+)?(?:(?:remain|remaining|stay|stays|staying|be|being)\\s+[^.;:!?]{0,45}?(?:dormant|inactive|inert|unused|un(?:triggered|fired|activated)|silent|idle|asleep|passive|off|latent|quiet)|never\\s+(?:to\\s+)?(?:fire|trigger|triggered|activate|activated|go\\s+off|happen|occur|be\\s+(?:met|triggered|reached|activated|satisfied|fulfilled|true)))\\b" +
  "|(?:remain|remains|stay|stays|be|sit|sits)\\s+(?:forever\\s+|permanently\\s+|always\\s+|indefinitely\\s+|perpetually\\s+)(?:dormant|inactive|inert|silent|idle|latent|un(?:triggered|fired|activated))\\b" +
  "|(?:dormant|inactive|inert|silent|idle|latent|un(?:triggered|fired|activated))\\s+(?:forever|permanently|for\\s+all\\s+time|for\\s+good|indefinitely|in\\s+perpetuity|always)\\b" +
  "|(?:forever|permanently|always|perpetually|eternally)\\s+(?:dormant|inactive|inert|silent|idle|latent|un(?:triggered|fired|activated))\\b" +
  // "beyond the realm of possibility", "outside all possibility"
  "|(?:beyond|outside|past)\\s+(?:the\\s+realm\\s+of\\s+|the\\s+bounds\\s+of\\s+|any\\s+|all\\s+|what\\s+is\\s+|the\\s+limits\\s+of\\s+)?(?:possibilit(?:y|ies)|what\\s+is\\s+possible|the\\s+possible)\\b" +
  "|not\\s+(?:simply\\s+|even\\s+|really\\s+|remotely\\s+|at\\s+all\\s+|entirely\\s+|quite\\s+)?(?:within|inside|in|a\\s+)\\s*(?:the\\s+(?:realm|bounds|range|limits|scope)\\s+of\\s+)?(?:the\\s+)?(?:realm\\s+of\\s+)?(?:possibilit(?:y|ies)|what\\s+is\\s+possible)\\b" +
  "|(?:lies|is|remains|falls|sits)\\s+(?:well\\s+|simply\\s+|firmly\\s+)?(?:beyond|outside)\\s+(?:the\\s+)?(?:realm|bounds|limits|range)?\\s*of\\s+(?:the\\s+)?(?:possibilit(?:y|ies)|what\\s+is\\s+possible)\\b" +
  // "no chain / sequence / combination of events can set off / trigger this"
  "|no\\s+(?:\\w+\\s+){0,2}?(?:chain|sequence|series|string|combination|set|course|run)\\s+of\\s+(?:events|factors|circumstances|conditions|actions|steps|inputs?)\\b[^.;:!?]{0,45}?\\b(?:can|could|will|would|is\\s+able\\s+to|might|would\\s+ever)\\b" +
  "|no\\s+(?:\\w+\\s+){0,2}?(?:event|circumstance|condition|factor|action|input|scenario|situation|combination|sequence|series|chain)\\b[^.;:!?]{0,35}?\\b(?:can|could|will|would|is\\s+able\\s+to)\\s+(?:ever\\s+)?(?:set\\s+(?:it\\s+|this\\s+)?off|trigger|activate|fire|cause|produce|lead\\s+to|bring\\s+about|result\\s+in|make\\s+.{0,20}?(?:fire|trigger))\\b" +
  "|(?:never|not)\\s+(?:capable|able)\\s+of\\s+(?:being\\s+|ever\\s+)?(?:triggered|activated|met|fired|reached|set\\s+off)\\b" +
  "|there\\s+(?:is|are|exists?|will\\s+be|could\\s+be)\\s+no\\s+(?:\\w+\\s+){0,3}?(?:condition|scenario|circumstance|situation|way|world|universe|case|reality)\\b" +
  "|by\\s+definition\\s+(?:it\\s+|this\\s+|that\\s+|the\\s+\\w+\\s+)?(?:always|cannot|can\\s+not|never|is\\s+impossible|does\\s+not|will\\s+not|won'?t|couldn'?t)" +
  ")",
  "i",
);

// --- Viewer Value metric-family model ----------------------------------
// Every primary metric can be gamed against viewer value. This encodes the four
// Viewer Value doctrine failure modes: CTR via misleading hooks, retention /
// watch time via padding, comments / likes via outrage bait, and conversion at
// the expense of trust.
type MetricFamily = "ACQUISITION" | "RETENTION" | "ENGAGEMENT" | "LOYALTY" | "OTHER";
const METRIC_FAMILY: Record<string, MetricFamily> = {
  IMPRESSIONS: "ACQUISITION", IMPRESSION_CLICK_THROUGH_RATE: "ACQUISITION", VIEWS: "ACQUISITION",
  UNIQUE_VIEWERS: "ACQUISITION", SUBSCRIBERS_GAINED: "ACQUISITION", SEARCH_IMPRESSION_SHARE: "ACQUISITION",
  AVERAGE_VIEW_DURATION: "RETENTION", AVERAGE_PERCENTAGE_VIEWED: "RETENTION", WATCH_TIME_HOURS: "RETENTION",
  LIKES_RATE: "ENGAGEMENT", COMMENTS_RATE: "ENGAGEMENT", SHARES: "ENGAGEMENT",
  RETURNING_VIEWERS_RATE: "LOYALTY", SURVEY_SATISFACTION: "LOYALTY",
  OTHER: "OTHER",
};
const FAMILY_GAMING_TERMS: Record<MetricFamily, RegExp> = {
  ACQUISITION: /\b(?:mislead|deceptiv|clickbait|bait[- ]?y|over[- ]?promis|overstat|oversell|sensational|exaggerat|false (?:expectation|promise)|not deliver|does ?n'?t deliver|thumbnail[- ]?body mismatch|hook[- ]?payoff|curiosity gap)/i,
  RETENTION: /\b(?:pad|padding|filler|stretch|drag(?:ging)?|artificially (?:long|extend|inflate)|unnecessar|withhold|bury|tease (?:endlessly|forever)|gets? good later|stall|time[- ]?wast|slow[- ]?walk|belabou?r)/i,
  ENGAGEMENT: /\b(?:outrage|rage[- ]?bait|engagement bait|\bbait\b|provoke|provocation|inflammator|controvers|pile[- ]?on|manufactur\w* (?:anger|drama|conflict)|divisive|hot take|ragebait)/i,
  LOYALTY: /\b(?:mislead|deceptiv|over[- ]?promis|erode trust|trust|satisf|churn|disappoint|value|selection bias|cherry[- ]?pick)/i,
  OTHER: /\b(?:mislead|deceptiv|erode trust|trust|satisf|value)/i,
};
const LOYALTY_METRICS = new Set(["SURVEY_SATISFACTION", "RETURNING_VIEWERS_RATE"]);
const VIEWER_BENEFIT_METRICS = new Set(["SURVEY_SATISFACTION", "RETURNING_VIEWERS_RATE", "AVERAGE_PERCENTAGE_VIEWED", "AVERAGE_VIEW_DURATION", "WATCH_TIME_HOURS"]);

// Experiment legitimately DESCRIBES an asset change as its treatment ("the new
// thumbnail leads with the outcome"), so -- unlike Decision -- it does not ban an
// asset-mutation verb family. It bans only publishing-pipeline execution and
// provider/account actions, which always belong to a later stage.
// "publish window" / "publish timing" is a legitimate experimental dimension
// (PUBLISH_WINDOW is a unitOfAssignment value), so bare "publish" is not banned:
// only an imperative publish / upload / go-live / schedule-the-publish action is.
const EXPERIMENT_EXECUTION_LEAKED = new RegExp(
  "\\b(?:(?:re-?)?publish(?:es|ing|ed)?\\s+(?:it\\b|this\\b|the (?:video|cut|edit|change|treatment|thumbnail|title|winner))|unpublish|re-?upload|upload the (?:video|file|cut)|go live\\b|push (?:it |this )?live|roll ?out (?:this|the winner|it)\\b|ship it\\b|schedule the (?:publish|upload|go-live|release)|send (?:a |the )?notification|notify (?:subscribers|the audience)|spend (?:on )?ads?\\b|run (?:an? )?ad(?: campaign)?\\b|buy ads\\b|boost this (?:video|post)|promote this video|change (?:the )?(?:youtube|channel|account) settings|connect (?:the )?(?:oauth|api|account|integration)|grant (?:oauth|api|access))",
  "i",
);
const PORTFOLIO_LEAKED = /\b(?:portfolio|across (?:all|the|multiple|our|several|many) (?:channels|videos|experiments)\b|allocate (?:budget|resources|effort|capacity) across|prioriti[sz]e (?:experiments?|videos?) across|experiment (?:roadmap|backlog|calendar|pipeline|slate)|content calendar|slate of experiments|sequence of experiments|which experiments? (?:to run|come) next)/i;
const INTELLIGENCE_LEAKED = /\b(?:channel strategy|strategic pivot|rewrite the strategy|revise the channel(?: strategy| positioning)?|channel[- ]wide (?:learning|pattern|insight|takeaway)|meta[- ]analysis of (?:all|every)|across the (?:entire )?channel history|update (?:the )?positioning)/i;
const DECISION_OVERRIDE = /\b(?:the (?:decision|call) (?:should|ought to|must|needs to) (?:instead |actually |really |now )?be\b|revise the decision|the decision was wrong|change the decision to|reject the decision|override the decision|we should (?:actually |instead )?(?:preserve|defer|escalate|gather evidence|do nothing) instead|the approved decision is (?:incorrect|mistaken|premature|wrong))/i;
const STOPPING_TRIGGER = /\b(?:guardrail|viewer value|satisfaction|retention|watch ?time|percentage viewed|harm|degrad|misleading|deceptive|trust|promise|complaint|dislike|drop-?off|abandon)/i;
const PROMISE_HARM_TERM = /\b(?:promise|mislead|deceptiv|trust|satisfaction|retention|watch ?time|percentage viewed|complaint|dislike)/i;
const NO_CHANGE_TREATMENT = /^\s*(nothing|none|n\/?a|no change|measurement only|observe only|no manipulation)\b/i;

// --- Viewer Value: treatment-mechanism safety (Layer 1) ---------------------
// A bounded, deterministic semantic-intent classifier, independent of guardrail
// adequacy (Layer 2, below): a treatment whose MECHANISM is deliberate viewer
// harm is rejected even when a perfectly worded guardrail names the same risk
// ("harmful treatment + perfect guardrail => REJECT").
//
// It works clause by clause rather than off a fixed phrase catalogue:
//   1. the intent text is normalised (en/em dashes -> spaces so a parenthetical
//      "do not - under any circumstances - pad" is not severed) and split into
//      clauses on sentence punctuation, semicolons/colons and a few coordinating
//      conjunctions -- NOT on "so"/"to", which introduce the harmful PURPOSE;
//   2. each clause is tested for a harmful MECHANISM in two tiers --
//        Tier A: the action alone is a Viewer Value harm (outrage / rage bait,
//                manufactured controversy or scandal, deliberate polarisation,
//                fake urgency / scarcity / expiry, bait-and-switch);
//        Tier B: a prolonging or promise-withholding action that is harmful ONLY
//                when the SAME clause also states a watch-time / keep-watching
//                PURPOSE ("pad the video" needs "to inflate watch time");
//   3. clause-scoped negation parity: negation cues before the action are
//      counted; an odd count flips an otherwise-harmful clause to safe ("do not
//      pad ..."), an even count leaves it harmful ("do not avoid padding ..." --
//      a double negative that still instructs padding). "not only" is emphatic
//      and never counts.
// A clause that survives all three steps is an affirmed harmful mechanism, and
// safe interventions ("remove low-value filler", "tighten the opening so the
// promised value appears sooner", "improve pacing without delaying the payoff")
// never reach step 3 because they carry no harmful action.
const HT_CLAUSE_BOUNDARY = /[.!?;:]+|,\s*(?:and|but|yet|then|plus|also)\b|\s+(?:but|yet|whereas|however)\s+/i;
// Constructions that read as negations token-by-token but AFFIRM the action, so
// they are neutralised before parity counting: "not only X" (emphatic), and
// "wrong / a mistake / remiss not to X" (two operators -> affirm X).
const HT_NEGATION_FALSE = /\bnot only\b|\b(?:wrong|a\s+mistake|mistaken|bad|foolish|unwise|remiss|negligent|careless|silly)\s+not\s+to\b/gi;
// A negation cue flips harmful intent to safe. "refrain from" / "fail to" /
// "neglect to" / "skip" are themselves negations, so "do not fail to X" / "not
// refrain from X" / "never skip X" is a DOUBLE negative (parity even) that still
// affirms X. "wrong to X" / "a mistake to X" is a single negation (X is bad).
const HT_NEGATION_CUE = /\b(?:without|avoids?|avoiding|avoided|not|never|no longer|no|rather than|instead of|does\s?n['’]?t|do\s?n['’]?t|is\s?n['’]?t|are\s?n['’]?t|wo\s?n['’]?t|would\s?n['’]?t|ca\s?n['’]?t|cannot|must\s?not|should\s?not|so as not to|prevent(?:s|ing)?|refus(?:e|es|ing)\s+to|refrain(?:s|ing|ed)?\s+from|fail(?:s|ing|ed)?\s+to|neglect(?:s|ing|ed)?\s+to|omit(?:s|ting|ted)?\s+to|hesitat\w+\s+to|shy\s+away\s+from|skip(?:s|ping|ped)?|forgo(?:es|ing)?|forego(?:es|ing)?|leave\s+out|leaves\s+out|stop(?:s|ping)?\s+short\s+of|(?:wrong|a\s+mistake|mistaken|bad|foolish|unwise|remiss|counterproductive)\s+to|discourage(?:s|d|ing)?)\b/gi;
// A negation only governs the predicate it is adjacent to: when computing parity
// for an action, the look-back is cut at the last comma or contrastive
// coordinator before it, so "Never use rage bait, pad the video ..." leaves the
// second clause's "pad" unnegated.
const HT_NEG_SCOPE_CUT = /,|\b(?:but|yet|however|nonetheless|nevertheless|though|although|whereas)\b/gi;

// Tier A -- the action alone is a Viewer Value harm.
const HT_CONFLICT_NOUN = "controvers\\w+|scandal|drama|outrage|conflict|feud|rivalr(?:y|ies)|backlash|uproar|furore?|firestorm|spat|quarrel|row|beef|dust[- ]?up|kerfuffle|flame\\s+war|shouting\\s+match|pile[- ]?on|war\\s+of\\s+words|hit\\s?piece";
const HT_TIER_A = new RegExp([
  "\\b(?:outrage|rage|engagement|comment|anger|reaction|hate)[ -]?bait(?:ing|s|ed)?\\b",
  "\\bragebait\\b",
  // manufactured / needless / exaggerated conflict, by any of a broad verb family,
  // with up to a couple of adjectives before the conflict noun ("a needless feud").
  "\\b(?:manufactur|fabricat|invent|gin\\s?up|ginn\\w+|drum\\s?up|whip\\s?up|stir\\s?up|stir|stage|concoct|cook\\s?up|create|creates|creating|start|starts|starting|spark|sparks|sparking|generat(?:e|es|ing)|engineer(?:s|ing)?|orchestrat(?:e|es|ing)|foster(?:s|ing)?|brew(?:s|ing)?|sow(?:s|ing)?|kick\\s+off|set\\s+up|provoke|provokes|provoking|incite|incites|inciting|foment(?:s|ing)?|hype\\s+up|drum\\s+up)(?:e|es|ed|ing)?\\s+(?:a\\s+|an\\s+|the\\s+|some\\s+)?(?:[-\\w]+\\s+){0,3}?(?:" + HT_CONFLICT_NOUN + ")\\b",
  // exaggerate a small matter INTO / AS explosive drama
  "\\b(?:overstate|overstates|overstating|exaggerat(?:e|es|ing)|blow(?:s|ing|n)?\\s+up|blew\\s+up|inflat(?:e|es|ing)|hyp(?:e|es|ing)(?:\\s+up)?|play(?:s|ing)?\\s+up|dramati[sz]e\\w*|sensationali[sz]e\\w*|overhyp\\w+|spin(?:s|ning)?|turn(?:s|ing)?)\\s+(?:a\\s+|an\\s+|the\\s+|some\\s+)?(?:[-\\w]+\\s+){0,3}?(?:dispute|disagreement|difference|spat|quarrel|issue|matter|point|debate|argument|remark|comment|story|nitpick|niggle|quibble|gripe|complaint|detail|thing|slight)\\b[^.;:!?]{0,50}?\\b(?:as|into|out\\s+of\\s+(?:all\\s+)?proportion\\s+(?:as|into))\\s+(?:a\\s+|an\\s+)?(?:[-\\w]+\\s+){0,3}?(?:drama|scandal|controvers\\w+|outrage|crisis|war|feud|firestorm|catastrophe|disaster|betrayal|bombshell|explosion|meltdown)\\b",
  // "blow <a minor thing> out of (all) proportion"
  "\\b(?:blow|blows|blowing|blew|blown)\\s+(?:a\\s+|an\\s+|the\\s+|some\\s+|this\\s+)?(?:[-\\w]+\\s+){0,4}?(?:dispute|disagreement|difference|spat|quarrel|issue|matter|point|nitpick|niggle|quibble|gripe|complaint|remark|comment|thing|detail|wording)\\b[^.;:!?]{0,30}?\\bout\\s+of\\s+(?:all\\s+)?proportion\\b",
  "\\b(?:frame|frames|framed|cast|casts|casting|paint|paints|painting|portray\\w*|depict\\w*|dress(?:es|ed)?\\s+up|brand|brands|branded|branding|label|labels|labelled|labeled|spin|spins|spinning|present\\w*)\\b[^.;:!?]{0,60}?\\bas\\s+(?:a\\s+|an\\s+)?(?:[-\\w]+\\s+){0,3}?(?:scandal|controversy|betrayal|outrage|crisis|disaster|drama|war|firestorm|bombshell|catastrophe|travesty|meltdown)\\b",
  // get viewers to fight / argue / attack each other
  "\\b(?:make|makes|making|get|gets|getting|have|has|having|drive|drives|driving|goad|goads|goading|egg|eggs|egging|set|sets|setting|put|puts|putting)\\s+(?:the\\s+)?(?:viewers?|people|users?|the\\s+audience|readers?|commenters?|the\\s+comments?\\s+section|comment\\s+section|two\\s+\\w+|them|everyone)\\s+(?:to\\s+)?(?:fight|fighting|argue|arguing|bicker\\w*|attack\\s+(?:each\\s+other|one\\s+another)|pile\\s+on|rage|go\\s+at\\s+(?:each\\s+other|it)|turn\\s+on\\s+each\\s+other|clash|at\\s+(?:each\\s+other|one\\s+another'?s\\s+throats))\\b",
  // pit people against each other / keep the comment war going
  "\\bpit\\s+(?:[-\\w]+\\s+){0,4}?(?:commenters?|viewers?|fans?|people|guests?|experts?|two\\s+\\w+|sides?|camps?|factions?)\\s+against\\s+(?:each\\s+other|one\\s+another|(?:one\\s+)?another)\\b",
  "\\b(?:keep|keeps|keeping|fuel|fuels|fueling|fuelling|stoke|stokes|stoking|sustain|sustains|sustaining|prolong|prolongs|prolonging|feed|feeds|feeding|inflame|inflames)\\s+(?:a\\s+|the\\s+)?(?:comment[- ]?section|comment|flame|comments)\\s+(?:war|brawl|fight|slugfest|scrap|dust-?up|meltdown|feud)\\s*(?:going|alive|burning|raging)?\\b",
  "\\b(?:comment[- ]?section|comment|flame)\\s+(?:war|brawl|slugfest)\\b",
  "\\b(?:deliberately|intentionally|purposely|artificially|needlessly|cynically|knowingly)\\s+polari[sz]e\\w*\\b",
  "\\bpolari[sz]e\\w*\\s+(?:the\\s+)?(?:audience|viewers?|comment\\s+section|room)\\b[^.;:!?]{0,40}?\\b(?:deliberately|on\\s+purpose|to\\s+(?:provoke|drive|boost|increase|farm|spike|maximi[sz]e))\\b",
  "\\b(?:provoke|provoking|incit(?:e|es|ing)|inflam(?:e|es|ing)|foment(?:s|ing)?|stoke(?:s|d)?|farm(?:s|ing)?|drum\\s+up|stir\\s+up|whip\\s+up)\\s+(?:reader|viewer|audience|user|hostile|angry)?\\s*(?:anger|outrage|indignation|rage|hostility|resentment|hate|fury|hostile\\s+comments|angry\\s+comments)\\b",
  "\\b(?:fake|faked|faking|fakes|false|phony|phoney|bogus|invented|manufactured|fabricated|artificial|pretend(?:ed)?|sham|contrived|imaginary|bake\\s+in\\s+(?:a\\s+)?fake)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:urgency|scarcity|deadline|countdown(?:\\s+(?:timer|clock))?|timer|expiry|expiration|shortage|social\\s+proof|limited\\s+supply|limited[- ]time|sold[- ]out\\s+label)\\b",
  "\\bpretend(?:s|ing)?\\b[^.;:!?]{0,60}?\\b(?:expires?|expiring|runs?\\s+out|running\\s+out|ends?\\s+(?:tonight|today|soon|at\\s+midnight)|sells?\\s+out|selling\\s+out|about\\s+to\\s+(?:end|close|sell\\s+out|run\\s+out))\\b",
  "\\binvent(?:s|ing)?\\s+(?:a\\s+|an\\s+|some\\s+)?(?:limited\\s+supply|scarcity|shortage|false\\s+deadline|fake\\s+deadline|artificial\\s+deadline|waitlist|waiting\\s+list)\\b",
  "\\bbait[ -]and[ -]switch\\b",
  "\\btrust[ -]damaging\\b",
  "\\bmisleading\\s+(?:urgency|scarcity|hook|thumbnail|framing|claim|deadline|promise)\\b",
  "\\bdeceptive\\s+(?:framing|urgency|scarcity|hook|thumbnail|tactic|claim|conversion|deadline)\\b",
  "\\binflammatory\\s+(?:framing|hook|title|thumbnail|angle|claim|language)\\b",
].join("|"), "i");
// Deceptive scarcity / urgency asserted while the SAME clause admits the claim is
// untrue (supply unlimited, access remains available, no real deadline). Two
// parts, order-independent -- a genuine deadline description without the
// contradiction is left alone.
const HT_SPELLED_SMALL = "few|handful|couple|\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a\\s+dozen";
const HT_SCARCITY_CLAIM = new RegExp("\\b(?:almost\\s+gone|nearly\\s+(?:gone|sold\\s+out|out|exhausted|depleted)|running\\s+(?:low|out)|about\\s+to\\s+(?:run\\s+out|sell\\s+out|close|end|expire|disappear)|only\\s+(?:a\\s+)?(?:" + HT_SPELLED_SMALL + ")\\s+(?:of\\s+)?(?:[-\\w]+\\s+){0,2}?(?:left|remain\\w*|spots?|seats?|copies|slots?|units?|places?|kits?|licen[cs]es?)\\s*(?:are\\s+)?(?:left|remain\\w*)?|(?:just|merely)\\s+(?:" + HT_SPELLED_SMALL + ")\\s+(?:of\\s+)?(?:left|remain\\w*|spots?|seats?|copies|slots?|places?|kits?)|(?:fewer|less)\\s+than\\s+(?:" + HT_SPELLED_SMALL + ")\\s+(?:[-\\w]+\\s+){0,2}?(?:left|remain\\w*|available|in\\s+stock|kits?|units?|copies|spots?|seats?|slots?|licen[cs]es?)|(?:under|no\\s+more\\s+than|barely)\\s+(?:" + HT_SPELLED_SMALL + ")\\s+(?:[-\\w]+\\s+){0,2}?(?:left|remain\\w*|kits?|units?|copies|spots?|seats?)|limited\\s+(?:spots?|seats?|copies|stock|supply|quantit\\w+|availability|slots?|units?|number|places?|licen[cs]es?)|last\\s+chance|final\\s+chance|selling\\s+(?:out|fast)|sells?\\s+out\\s+(?:at|by|before|tonight|today|tomorrow|soon|at\\s+\\w+)|(?:seats?|spots?|slots?|copies|tickets?|places?)\\s+(?:sell|sells|are\\s+selling)\\s+out\\b|stock\\s+(?:is\\s+)?(?:low|almost\\s+gone|nearly\\s+gone|running\\s+out)|supplies?\\s+(?:are\\s+)?(?:low|limited|dwindling|running\\s+out|nearly\\s+(?:exhausted|gone|out|depleted)|almost\\s+(?:exhausted|gone|out))|(?:access|the\\s+(?:offer|deal|price|discount|bonus|course|link|video|content|workshop|webinar|class|session|cohort|programme?|sale|store|shop|window|batch|intake)|it|enrol?ment|registration|the\\s+door|the\\s+cart|sign-?ups?)\\s+(?:vanish\\w*|disappear\\w*|goes?\\s+away|going\\s+away|expires?|expiring|ends?|ending|closes?|closing|shuts?|shutting|shut\\s+down|goes?\\s+dark|drop\\w*)\\b[^.;:!?]{0,25}?\\b(?:today|tomorrow|tonight|soon|at\\s+midnight|at\\s+noon|this\\s+week|at\\s+\\d{1,2}\\s*(?:[ap]\\.?m\\.?|:\\d\\d|o'?clock)|by\\s+\\d{1,2}\\s*[ap]\\.?m\\.?|in\\s+\\w+\\s+(?:hours?|days?|minutes?)))\\b", "i");
const HT_ADMIT_ADV = "(?:effectively\\s+|essentially\\s+|basically\\s+|actually\\s+|really\\s+|virtually\\s+|practically\\s+|in\\s+fact\\s+|truly\\s+)?";
const HT_AVAILABILITY_TRUTH = new RegExp("\\b(?:even\\s+though|although|though|but|while\\s+it|while\\s+(?:in\\s+fact|really)|when\\s+(?:in\\s+fact|really|actually|it|we|you|the\\s+team)|despite|in\\s+(?:fact|reality|truth)|actually|really|when\\s+it\\s+(?:will|does|is|stays?|remains?)|when\\s+(?:we|you|the\\s+team)\\s+(?:can|could))\\b[^.;:!?]{0,95}?\\b(?:remains?\\s+" + HT_ADMIT_ADV + "available|stay\\w*\\s+" + HT_ADMIT_ADV + "available|stay\\w*\\s+(?:up|live|online|posted|active|open)(?:\\s+(?:indefinitely|for\\s+good|permanently|all\\s+year|year-?round|for\\s+the\\s+foreseeable(?:\\s+future)?))?|still\\s+(?:be\\s+)?(?:available|around|for\\s+sale|on\\s+sale|open|accessible|there|up|live)|will\\s+(?:still\\s+|in\\s+fact\\s+)?(?:remain|stay|be)\\s+(?:there|available|around|accessible|for\\s+sale|open|up|live)|(?:supply|stock|quantit\\w+|availability|inventory|seating|seats|capacity|room|space|spaces|places?)\\s+(?:is|are|remains?|stays?)\\s+" + HT_ADMIT_ADV + "(?:unlimited|ample|plentiful|not\\s+limited|fine|healthy|endless|abundant|uncapped)|plenty\\s+(?:left|available|in\\s+stock|to\\s+go\\s+around|remain\\w*|of\\s+(?:room|space|seats|copies))|(?:effectively|essentially|basically|virtually|practically)\\s+unlimited|unlimited\\s+(?:supply|stock|availability|copies|seats|spots?|seating)|no\\s+(?:real\\s+|actual\\s+|hard\\s+)?(?:deadline|limit|shortage|scarcity|cap|cut[- ]?off|end\\s+date)|not\\s+(?:actually\\s+|really\\s+)?(?:going\\s+away|limited|scarce|running\\s+out|ending|disappearing|expiring)|is\\s+not\\s+(?:ending|going\\s+away|limited|expiring)|never\\s+(?:closes?|ends?|expires?|sells?\\s+out|runs?\\s+out|goes?\\s+away)|(?:can|could)\\s+(?:print|make|produce|offer|add|supply|generate|create|issue|mint|spin\\s+up|ship|deliver|fulfil?l?|send|churn\\s+out)\\s+(?:unlimited|as\\s+many|endless|any\\s+number\\s+of|as\\s+many\\s+as\\s+(?:ordered|needed|wanted|requested|asked\\s+for)|them\\s+on\\s+demand|(?:more\\s+)?(?:keys|copies|seats|licen[cs]es|slots|kits|units)\\s+on\\s+demand)|(?:keys|copies|seats|licen[cs]es|slots|kits|units)\\s+on\\s+demand|(?:sign-?ups?|enrol?ment|registration|intake|the\\s+(?:workshop|webinar|class|cohort|course|programme?|sale|store|door|cart))\\s+(?:actually\\s+)?(?:run|runs|stay|stays|remain|remains|is|are)\\s+(?:open\\s+)?(?:year-?round|all\\s+year|continuous(?:ly)?|on\\s+a\\s+rolling\\s+basis|always|perpetually|open|ongoing))\\b", "i");
const HT_AVAILABILITY_TRUTH_LOOSE = /\b(?:supply|stock|inventory|availability|seating|seats|capacity)\s+(?:is|are|remains?)\s+(?:effectively\s+|essentially\s+|basically\s+|virtually\s+|practically\s+)?(?:unlimited|ample|plentiful|not\s+limited|endless|abundant|uncapped)\b|\b(?:effectively|essentially|basically|virtually|practically)\s+unlimited\b|\bunlimited\s+(?:supply|stock|inventory|availability|seating)\b|\bwill\s+(?:still\s+)?(?:remain|stay|be)\s+(?:there|available|around|accessible|up|live)\b|\bstay\w*\s+(?:up|live|online|posted)\s+(?:indefinitely|for\s+good|permanently|for\s+the\s+foreseeable)\b|\bremains?\s+(?:fully\s+)?available\b|\b(?:has|have)\s+no\s+(?:real\s+|actual\s+)?(?:deadline|end\s+date)\b/i;

// Tier B -- a prolonging OR a promise-withholding action; harmful only with a
// keep-watching / watch-time PURPOSE in the same clause.
const HT_FILLER_NOUN = "recap\\w*|summ\\w+|restatement\\w*|restating|reiteration\\w*|repetition\\w*|material|content|segments?|sections?|footage|clips?|filler|padding|tangents?|side[- ]points?|digressions?|waffle";
const HT_PROLONG_ACTION = new RegExp([
  "\\bpad(?:s|ded|ding)?\\s+(?:out\\s+)?(?:the\\s+|this\\s+|it\\b|each\\s+|every\\s+)",
  "\\bpad(?:s|ded|ding)?\\b(?=[^.;:!?]*\\b(?:video|runtime|run\\s?time|episode|content|cut|segment|section|middle|intro|opening|explanation)\\b)",
  "\\b(?:bloat|bloats|bloated|bloating|pad\\s+out|fatten|fattens|fattening)\\s+(?:out\\s+)?(?:the\\s+|this\\s+|its\\s+)?(?:video|intro|introduction|opening|runtime|run\\s?time|middle|section|episode|content|cut)\\b",
  "\\bstuff(?:s|ed|ing)?\\b[^.;:!?]{0,40}?\\bwith\\s+(?:repetitive\\s+|filler\\s+|recap\\s+|extra\\s+|padding\\s+|low[ -]value\\s+|throwaway\\s+|unnecessary\\s+|redundant\\s+|duplicate\\s+|more\\s+)",
  "\\b(?:add|adds|adding|insert|inserts|inserting|drop\\s+in|throw\\s+in|tack\\s+on|append|pack|packs|packing|pile\\s+in|fill|fills|filling|load|loads|loading|cram|crams|cramming|slip\\s+in|work\\s+in|put\\s+in)\\s+(?:(?:the|a|an|another|some|extra|one)\\s+(?:\\w+\\s+){0,3}|it\\s+|them\\s+|up\\s+)?(?:up\\s+)?(?:with\\s+)?(?:more\\s+|another\\s+|extra\\s+)?(?:repetitive\\s+|filler\\s+|padding\\s+|low[ -]value\\s+|no[ -]value\\s+|throwaway\\s+|time[ -]wasting\\s+|unnecessary\\s+|extraneous\\s+|redundant\\s+|duplicate\\s+|repeated\\s+|needless\\s+|pointless\\s+)(?:" + HT_FILLER_NOUN + ")",
  "\\badd(?:s|ing)?\\s+(?:more\\s+)?(?:repetitive\\s+)?recaps?\\b",
  // adding a duplicate pass over the same material
  "\\b(?:add|adds|adding|insert|inserts|inserting|include|includes|including|slip\\s+in|throw\\s+in|do|does|doing)\\s+(?:a\\s+|an\\s+|another\\s+)?(?:second|another|extra|repeat|duplicate|additional|further)\\s+(?:[-\\w]+\\s+){0,2}?(?:walkthrough|walk-through|run-?through|pass|recap|summary|overview|explanation|rundown|round|go-?over)\\b",
  "\\b(?:go\\s+(?:back\\s+)?over|cover|run\\s+through|walk\\s+through|revisit|repeat)\\s+(?:the\\s+same\\s+(?:[-\\w]+\\s+){0,2}?(?:steps?|points?|material|content|ground|thing|section|explanation)\\s+(?:again|twice|once\\s+more)|(?:the\\s+)?(?:[-\\w]+\\s+){0,2}?(?:steps?|points?|material|content|ground|section|explanation)\\s+(?:twice|a\\s+second\\s+time|over\\s+again|two\\s+more\\s+times|repeatedly))\\b",
  // repeating / restating / recapping the same content
  "\\b(?:repeat|repeats|repeating|re-?state|re-?states|re-?stating|reiterat(?:e|es|ing)|echo|echoes|echoing|duplicat(?:e|es|ing)|recap|recaps|recapping|recapped|say(?:ing)?\\s+(?:the\\s+same\\s+thing|it)\\s+again|go(?:es|ing)?\\s+over\\s+(?:it|the\\s+same\\b)[^.;:!?]{0,20}?again)\\s+(?:the\\s+|each\\s+|every\\s+|all\\s+)?(?:same\\s+)?(?:\\w+\\s+){0,2}?(?:summary|summaries|point|points|section|sections|segment|segments|content|material|recap|recaps|explanation|information|idea|ideas|lesson|thing|argument|steps?)\\b",
  "\\b(?:repeat|repeats|repeating|recap|recaps|recapping|re-?state|re-?states|re-?stating|reiterat(?:e|es|ing)|go\\s+over|loop\\s+back|loops?\\s+back|looping\\s+back|circl(?:e|es|ing)\\s+back|revisit(?:s|ing)?|return(?:s|ing)?\\s+to|rehash(?:es|ing)?)\\b[^.;:!?]{0,45}?\\b(?:twice|again|repeatedly|multiple\\s+times|over\\s+and\\s+over|again\\s+and\\s+again|a\\s+second\\s+time|two\\s+or\\s+more\\s+times|time\\s+and\\s+again|after\\s+(?:every|each)\\s+(?:section|segment|chapter|point|part|scene|beat))\\b",
  // let the host ramble / meander through side points
  "\\b(?:let|lets|letting|allow|allows|allowing|have|has|having)\\s+(?:the\\s+)?(?:host|presenter|narrator|speaker|guest|voiceover)\\s+(?:ramble|rambles|rambling|meander|meanders|meandering|go\\s+off|goes\\s+off|wander|wanders|wandering|digress\\w*|drone\\s+on|waffle|waffles|waffling|ad[- ]lib|meander)\\b",
  "\\brambl\\w+\\s+(?:on\\s+)?(?:through|on|about|over|around)\\s+(?:the\\s+)?(?:side[- ]points?|tangents?|irrelevan\\w+|unrelated\\s+\\w+|minor\\s+\\w+|digressions?)\\b",
  "\\b(?:go(?:es|ing)?|going|wander(?:s|ing)?)\\s+off\\s+on\\s+(?:a\\s+|multiple\\s+|endless\\s+)?tangents?\\b",
  "\\b(?:stretch|stretches|stretching|stretched|lengthen|lengthens|lengthening|lengthened|drag|drags|dragging|balloon|balloons|ballooning|prolong|prolongs|prolonging|expand|expands|expanding|inflate|inflates|inflating|elongate|elongates|elongating)\\s+(?:out\\s+)?(?:the\\s+|this\\s+|its\\s+|each\\s+|every\\s+)?(?:video|runtime|run\\s?time|episode|length|cut|content|footage|duration|middle|section|segment|explanation|intro)\\b",
  "\\bextend(?:s|ing|ed)?\\s+(?:out\\s+)?(?:the\\s+|this\\s+|its\\s+|each\\s+|every\\s+)?(?:video|runtime|run\\s?time|episode|length|cut|content|footage|segment|section|middle|explanation|intro)\\b",
  // draw / drag / spin the explanation out
  "\\b(?:draw|draws|drawing|drag|drags|dragging|spin|spins|spinning|string|strings|stringing|stretch|stretches|stretching)\\s+(?:the\\s+|this\\s+|it\\s+|out\\s+)?(?:\\w+\\s+){0,4}?\\bout\\b",
  // make X longer / run longer / verbose / rambling
  "\\bmake(?:s|ing)?\\b[^.;:!?]{0,40}?\\b(?:deliberately\\s+|needlessly\\s+|artificially\\s+|unnecessarily\\s+|overly\\s+|intentionally\\s+)?(?:verbose|long[ -]winded|wordy|repetitive|drawn[ -]out|meandering|rambl\\w+|padded|bloated)\\b",
  "\\bmake(?:s|ing)?\\s+(?:the\\s+|each\\s+|every\\s+)?(?:\\w+\\s+){0,2}?(?:episode|video|explanation|explanations|segment|segments|intro|section|sections|answer|answers|cut)\\s+(?:run\\s+)?longer\\b",
  "\\bmake(?:s|ing)?\\b[^.;:!?]{0,30}?\\b(?:run|runs|running|be)\\s+longer\\b",
  "\\b(?:run|runs|running)\\s+longer\\b(?=[^.;:!?]*\\b(?:watch\\s?time|retention|minutes?|viewing|stay|longer|audience)\\b)",
  "\\b(?:slow[ -]walk(?:s|ing)?|belabou?r(?:s|ing)?|dwell\\s+needlessly|labour\\s+the\\s+point|stall(?:s|ing)?\\s+(?:the\\s+)?(?:viewer|video|payoff|reveal))",
].join("|"), "i");
const HT_VALUE_NOUN = "answer|payoff|pay[ -]off|reveal|result|information|conclusion|outcome|value|point|takeaway|take[ -]away|lede|lead|resolution|explanation|lesson|guidance|advice|tip|tips|insight|insights|instruction|instructions|solution|recommendation|recommendations|help|fix|fixes|remedy|correction|verdict|the\\s+useful\\s+(?:bit|part|stuff)|main\\s+point|key\\s+takeaway";
const HT_VALUE_ADJ = "(?:promised\\s+|expected\\s+|core\\s+|actual\\s+|useful\\s+|key\\s+|real\\s+|main\\s+|practical\\s+|important\\s+|central\\s+|substantive\\s+|meaningful\\s+)*";
const HT_WITHHOLD_ACTION = new RegExp([
  "\\b(?:withhold|withholds|withholding|hold\\s+back|holds\\s+back|holding\\s+back|hold\\s+off\\s+on)\\s+(?:the\\s+|a\\s+|an\\s+|our\\s+|any\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")",
  // "hold / keep the <value> back / in reserve / under wraps / for later"
  "\\b(?:hold|holds|holding|keep|keeps|keeping|put|puts|putting|leave|leaves|leaving|stash|stashes|stashing|park|parks|parking)\\s+(?:the\\s+|a\\s+|an\\s+|our\\s+|its\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")\\s+(?:back|in\\s+reserve|in\\s+(?:the|your|our|its)\\s+back\\s+pocket|on\\s+hold|under\\s+wraps|out\\s+of\\s+sight|to\\s+(?:one|the)\\s+side|aside|for\\s+later|for\\s+the\\s+(?:end|close|finish|last|final)|till\\s+the\\s+end|until\\s+the\\s+(?:end|last|final|close|closing))\\b",
  "\\b(?:delay|delays|delayed|delaying|postpone|postpones|postponed|postponing|defer|defers|deferring|deferred|push\\s+back|pushes\\s+back|pushing\\s+back|save|saves|saving|reserve|reserves|reserving|hold\\s+off)\\s+(?:the\\s+|a\\s+|an\\s+|our\\s+|its\\s+|delivery\\s+of\\s+|reveal\\s+of\\s+|any\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")",
  "\\b(?:bury|buries|burying|hide|hides|hiding|conceal|conceals|concealing|tuck\\s+away|tucks\\s+away|tuck|tucks|tucking)\\s+(?:the\\s+|a\\s+|our\\s+|its\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")\\b",
  "\\b(?:push|pushes|pushing|move|moves|moving|shift|shifts|shifting|hold|holds|holding|leave|leaves|leaving|slot|slots|slotting)\\s+(?:the\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")\\s+(?:to|until|till|near|toward|towards|into)\\s+(?:the\\s+)?(?:end|finish|close|last|final|closing|very\\s+end|last\\s+(?:minute|section|segment|third))",
  "\\b(?:keep|keeps|keeping|make|makes|making|force|forces|forcing|leave|leaves|leaving)\\s+(?:the\\s+)?viewers?\\s+(?:guessing|waiting|hanging|in\\s+suspense|on\\s+the\\s+hook)\\b",
  "\\b(?:sit|sits|sitting)\\s+(?:tight\\s+)?on\\s+(?:the\\s+|a\\s+|our\\s+)?" + HT_VALUE_ADJ + "(?:" + HT_VALUE_NOUN + ")\\b",
  "\\btease\\s+(?:the\\s+)?(?:answer|payoff|reveal)\\b",
].join("|"), "i");
const HT_KEEP_WATCHING_PURPOSE = new RegExp([
  "\\b(?:increase|increases|increasing|boost|boosts|boosting|inflate|inflates|inflating|raise|raises|raising|drive\\s+up|drives\\s+up|driving\\s+up|grow|grows|growing|maximi[sz]e|maximi[sz]es|maximi[sz]ing|lift|lifts|lifting|pump\\s+up|improve|improves|improving|help|helps|extend|extends|extending|pad|pads|padding|add\\s+to|bump\\s+up|push\\s+up|build|builds|building|rack\\s+up|racks\\s+up|racking\\s+up|drive|drives|driving|juice)\\b[^.;:!?]{0,45}?\\b(?:watch\\s?time|watch\\s+hours|minutes?\\s+(?:watched|viewed|of\\s+viewing)|viewing\\s+(?:minutes|time)|minutes?\\s+of\\s+watch|view\\s+duration|average\\s+view\\s+duration|time\\s+(?:on|in)\\s+(?:the\\s+)?(?:video|page)|session\\s+(?:length|duration)|retention|time\\s+watched|dwell\\s+time)\\b",
  "\\b(?:watch\\s?time|minutes?\\s+(?:watched|viewed)|viewing\\s+minutes|view\\s+duration|retention|time\\s+watched|runtime|run\\s?time|episode\\s+length|the\\s+length)\\b[^.;:!?]{0,30}?\\b(?:rises?|rising|climbs?|climbing|goes?\\s+up|going\\s+up|increases?|increasing|grows?|growing|improves?|improving|jumps?|balloons?|expands?|benefits?|gains?)\\b",
  "\\b(?:stop|stops|stopping|reduce|reduces|reducing|cut|cuts|cutting|curb|curbs|curbing|minimi[sz]e\\w*|prevent|prevents|preventing)\\s+(?:the\\s+)?(?:early\\s+)?(?:drop[- ]?off|drop[- ]?outs?|bounce\\s+rate|early\\s+exits?|early\\s+abandonment|viewers?\\s+leaving)\\b",
  "\\b(?:so|to\\s+(?:get|have|make))\\s+(?:that\\s+)?(?:people|viewers?|they|the\\s+audience)\\s+(?:watch|watches|finish|finishes|see|sees|stay\\s+for)\\s+(?:the\\s+)?(?:whole|entire|full|all\\s+of\\s+(?:the|it))\\s+(?:thing|video|clip|episode)\\b",
  "\\bso\\s+(?:that\\s+)?(?:the\\s+)?(?:video|clip|episode|it|runtime)\\s+is\\s+longer\\b",
  "\\b(?:audience|viewers?|people|users?|they|the\\s+viewer|nobody|no\\s+one)\\b[^.;:!?]{0,45}?\\b(?:spend[s]?\\s+(?:longer|more\\s+time)|stay[s]?\\s+(?:longer|watching|on\\s+the\\s+video|put)|watch(?:es|ing)?\\s+(?:longer|more|for\\s+longer)|keep[s]?\\s+watching|remain[s]?\\s+(?:longer|watching|on\\s+the\\s+(?:video|page))|linger[s]?\\b|stick\\s+(?:around|with\\s+it)|hang\\s+(?:on|around)|don['’]?t\\s+(?:leave|bail)|do\\s+not\\s+leave|leaves?\\s+early|leaving\\s+early|finish(?:es)?\\s+(?:the\\s+video|it|watching)|watch\\s+(?:it\\s+)?to\\s+the\\s+end)\\b",
  "\\b(?:the\\s+)?(?:clip|video|episode|piece|it|runtime|segment)\\s+(?:lasts?|runs?|goes?\\s+on)\\s+(?:longer|for\\s+longer)\\b",
  "\\bhold\\s+(?:on\\s+to\\s+|onto\\s+)?(?:the\\s+(?:viewers?|audience|people|them)['’]?s?\\s+)?attention\\b",
  "\\b(?:hold|holds|holding)\\s+(?:on\\s+to\\s+|onto\\s+)?(?:the\\s+)?(?:viewers?|audience|people|them)\\b",
  "\\bfor\\s+(?:retention|watch\\s?time|watch\\s+hours|viewing\\s+minutes|minutes?\\s+(?:watched|viewed)|dwell\\s+time|more\\s+watch\\s?time)\\b",
  "\\bkeep(?:s|ing)?\\s+(?:the\\s+)?(?:viewers?|people|users?|them|the\\s+audience|everyone)\\s+(?:watching|on\\s+the\\s+(?:video|page)|around|engaged(?:\\s+longer)?|hooked|glued|from\\s+leaving|in\\s+their\\s+seats?|there|put)\\b",
  "\\b(?:stop|stops|stopping|prevent|prevents|preventing|keep|keeps|keeping)\\s+(?:the\\s+)?(?:viewers?|people|users?|them|the\\s+audience|anyone|folks)\\s+(?:from\\s+)?(?:leaving|dropping\\s+off|clicking\\s+(?:away|off)|bouncing|bailing|exiting|tuning\\s+out|abandoning|leaving\\s+early)\\b",
  "\\bso\\s+(?:that\\s+)?(?:people|viewers?|they|the\\s+audience|users?)\\s+(?:stay|stays|keep\\s+watching|keeps\\s+watching|keep\\s+going|don['’]?t\\s+(?:leave|bail|bounce|drop\\s+off|click\\s+away)|do\\s+not\\s+(?:leave|bail)|remain|watch\\s+longer|hang\\s+(?:on|around))\\b",
  "\\bso\\s+(?:that\\s+)?(?:nobody|no\\s+one|noone|not\\s+a\\s+single\\s+(?:viewer|person))\\s+(?:leaves?|bails?|drops?\\s+off|clicks?\\s+away|bounces?|tunes?\\s+out)\\b",
  "\\b(?:nobody|no\\s+one|noone)\\s+(?:leaves?|bails?|drops?\\s+off|clicks?\\s+away|bounces?|tunes?\\s+out)\\s+(?:early|before|until|halfway|part\\s?way)\\b",
  "\\b(?:so|to)\\s+(?:that\\s+)?(?:people|viewers?|they)\\s+(?:rush|scramble|hurry)\\s+to\\s+(?:subscribe|sign\\s+up|buy|convert|act)\\b",
  "\\b(?:compel|compels|compelling|force|forces|forcing|guarantee|guarantees|ensure|ensures)\\s+(?:continued|further|longer|more|extended)\\s+(?:viewing|watching|watch\\s?time)\\b",
  "\\bcontinued\\s+viewing\\b",
  "\\bprolong(?:s|ing)?\\s+(?:the\\s+)?(?:session|view|watch|visit|engagement)\\b",
].join("|"), "i");

// Compositional concept detection -- a generalisation layer over the rigid
// verb+object patterns above. A prolonging CONCEPT (lengthen / add-redundancy /
// ramble / slow) anywhere in the clause, or a withholding SIGNAL + a value noun
// + (an end-position phrase OR a keep-watching purpose), is a harmful Tier-B
// mechanism. It is deliberately looser than HT_PROLONG_ACTION / HT_WITHHOLD_ACTION
// because the purpose gate (watch-time / keep-watching) already carries the
// harm; a lengthen concept with no such purpose is an ordinary edit and passes.
const HT_LENGTHEN_CONCEPT = /\b(?:lengthen\w*|elongat\w+|prolong\w*|drag\s+\w+(?:\s+\w+)?\s+out|draw\s+\w+(?:\s+\w+)?\s+out|spin\s+\w+(?:\s+\w+)?\s+out|string\s+\w+(?:\s+\w+)?\s+(?:out|along)|stretch\w*\s+(?:it|this|the|out)|pad(?:s|ded|ding)?\s+(?:it|this|the|out)|bloat\w*|balloon\w*|fatten\w*|make[s]?\s+\w+(?:\s+\w+){0,2}?\s+(?:run\s+)?longer|run[s]?\s+longer|last[s]?\s+longer|go(?:es)?\s+on\s+(?:for\s+)?longer|inflate[s]?\s+(?:the\s+)?(?:runtime|run\s?time|length|duration|video|episode))\b/i;
const HT_REDUNDANCY_CONCEPT = /\b(?:repeat\w*|re-?state\w*|reiterat\w+|recap\w*|echo\w*|duplicat\w+|rehash\w*|loop\s+back|circl\w+\s+back|go(?:es|ing)?\s+(?:back\s+)?over\b[^.;:!?]{0,25}?\bagain|say\w*\s+(?:it|the\s+same\s+thing)\s+again)\b|\b(?:another|a\s+second|an?\s+extra|a\s+duplicate|a\s+repeat|an?\s+additional|one\s+more)\s+(?:[-\w]+\s+){0,2}?(?:walkthrough|walk-through|run-?through|pass|recap|summary|overview|rundown|go-?over|explanation|lap)\b|\b(?:redundant|repetitive|duplicate|needless|pointless|filler|padding|throwaway|low[- ]value|no[- ]value|time[- ]wasting|unnecessary|extraneous)\s+(?:[-\w]+\s+){0,2}?(?:material|content|segments?|sections?|recap\w*|summ\w+|restatement\w*|footage|clips?|filler|padding|tangents?|asides?|repetition\w*)\b/i;
const HT_RAMBLE_CONCEPT = /\b(?:rambl\w+|meander\w*|waffl\w+|digress\w*|drone\s+on)\b|\bgo(?:es|ing)?\s+(?:off\s+)?on\s+(?:a\s+|multiple\s+|lengthy\s+|long\s+|endless\s+|extended\s+)?tangents?\b|\b(?:lengthy|long|endless|extended|needless)\s+(?:tangents?|asides?|digressions?)\b|\bwander\w*\s+off\b|\bpad\s+with\s+tangents\b/i;
const HT_SLOW_CONCEPT = /\b(?:slow[- ]walk\w*|belabou?r\w*|labou?r\s+the\s+point|drag\s+(?:one'?s|your|their)\s+feet|dwell\s+(?:needlessly|too\s+long|at\s+length))\b|\bstall\w*\s+(?:the\s+)?(?:viewer|video|reveal|payoff|answer)\b/i;
const HT_WITHHOLD_SIGNAL = /\b(?:withhold\w*|hold(?:s|ing)?\s+(?:back|off|on\s+to)\b|hangs?\s+(?:on\s+)?to\b|hanging\s+(?:on\s+)?to\b|clings?\s+to\b|clinging\s+to\b|clutch\w*|hold(?:s|ing)?\s+[^.;:!?]{0,25}?\bback\b|keep(?:s|ing)?\s+[^.;:!?]{0,25}?\b(?:back\b|in\s+reserve|under\s+wraps|out\s+of\s+sight|in\s+(?:the|your|our)\s+back\s+pocket|to\s+(?:one|the)\s+side)|sit(?:s|ting)?\s+(?:tight\s+)?on\b|reserv\w+|sav(?:e|es|ing)|delay\w*|postpon\w+|defer\w*|push(?:es|ing)?\s+back|bury|buries|burying|hid(?:e|es|ing)|conceal\w*|stash\w*|park(?:s|ed|ing)?|tuck\w*\s+away|time\s+(?:the\s+)?(?:reveal|answer|payoff|verdict|conclusion)\s+(?:for|to)|wait(?:s|ing)?\s+to\s+(?:reveal|share|give|deliver)|not\s+(?:reveal|share|give|deliver)\s+[^.;:!?]{0,25}?until)\b/i;
const HT_VALUE_NOUN_RE = new RegExp("\\b(?:" + HT_VALUE_NOUN + "|actionable\\s+(?:step|item|takeaway|advice)|practical\\s+(?:step|advice|guidance)|concrete\\s+(?:step|recommendation|advice)|the\\s+(?:real|actual|useful|concrete)\\s+(?:answer|point|info|information|part|recommendation|guidance))\\b", "i");
const HT_END_POSITION = /\b(?:until|till|to|for|near|toward|towards|at)\s+(?:the\s+)?(?:very\s+)?(?:end|finish|close|closing|wrap-?up|conclusion|coda)\b|\b(?:last|final|closing|very\s+last|dying|home)\s+(?:minute|minutes|section|segment|third|seconds?|moments?|stretch|part|chapter|breath)\b|\bat\s+the\s+(?:very\s+)?(?:end|wrap-?up)\b|\bright\s+at\s+the\s+end\b|\bin\s+the\s+(?:final|closing|home)\s+(?:stretch|minutes?)\b/i;

const htClauses = (text: string): string[] =>
  text.replace(/[‒–—―−]/g, " ").split(HT_CLAUSE_BOUNDARY).map((clause) => clause.trim()).filter((clause) => clause.length > 0);

const HT_TIER_A_G = new RegExp(HT_TIER_A.source, "gi");
const HT_PROLONG_ACTION_G = new RegExp(HT_PROLONG_ACTION.source, "gi");
const HT_WITHHOLD_ACTION_G = new RegExp(HT_WITHHOLD_ACTION.source, "gi");
const HT_PROLONG_CONCEPTS = [HT_LENGTHEN_CONCEPT, HT_REDUNDANCY_CONCEPT, HT_RAMBLE_CONCEPT, HT_SLOW_CONCEPT];

/** Every harmful-action hit in the clause, with whether it needs a keep-watching purpose. */
function htActionHits(clause: string): Array<{ index: number; needsPurpose: boolean }> {
  const hits: Array<{ index: number; needsPurpose: boolean }> = [];
  for (const [re, needsPurpose] of [[HT_TIER_A_G, false], [HT_PROLONG_ACTION_G, true], [HT_WITHHOLD_ACTION_G, true]] as const) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(clause)) !== null) {
      hits.push({ index: match.index, needsPurpose });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}

/**
 * Negation parity for one action: cues before it, but only within the predicate
 * it governs -- the look-back is cut at the last comma or contrastive
 * coordinator, so a safe prohibition in an earlier clause fragment ("Never use
 * rage bait, pad the video ...") does not sanitize this action. An even count
 * (including the "do not fail to X" / "not refrain from X" double negative)
 * leaves the action affirmed.
 */
function htActionIsAffirmed(clause: string, actionIndex: number): boolean {
  let before = clause.slice(0, actionIndex).replace(HT_NEGATION_FALSE, " ");
  HT_NEG_SCOPE_CUT.lastIndex = 0;
  let cut = 0;
  let m: RegExpExecArray | null;
  while ((m = HT_NEG_SCOPE_CUT.exec(before)) !== null) {
    cut = m.index + m[0].length;
    if (m.index === HT_NEG_SCOPE_CUT.lastIndex) HT_NEG_SCOPE_CUT.lastIndex++;
  }
  before = before.slice(cut);
  const negations = before.match(HT_NEGATION_CUE)?.length ?? 0;
  return negations % 2 === 0;
}

function htClauseAffirmsHarm(clause: string, purposePresent: boolean): boolean {
  // Deceptive scarcity / urgency contradicted by admitted availability.
  if (HT_SCARCITY_CLAIM.test(clause) && (HT_AVAILABILITY_TRUTH.test(clause) || HT_AVAILABILITY_TRUTH_LOOSE.test(clause))) return true;
  const hits = htActionHits(clause);
  if (hits.some((hit) => (!hit.needsPurpose || purposePresent) && htActionIsAffirmed(clause, hit.index))) return true;
  // Compositional Tier-B fallback: a prolonging concept + purpose, or a
  // withholding signal + a value noun + (end-position OR purpose).
  if (purposePresent) {
    for (const concept of HT_PROLONG_CONCEPTS) {
      const m = concept.exec(clause);
      concept.lastIndex = 0;
      if (m && htActionIsAffirmed(clause, m.index)) return true;
    }
  }
  const withhold = HT_WITHHOLD_SIGNAL.exec(clause);
  HT_WITHHOLD_SIGNAL.lastIndex = 0;
  if (withhold && HT_VALUE_NOUN_RE.test(clause) && (purposePresent || HT_END_POSITION.test(clause)) && htActionIsAffirmed(clause, withhold.index)) return true;
  return false;
}

// A prolonging / withholding MECHANISM plus a watch-time / keep-watching PURPOSE
// anywhere in the same intent field is harmful even when the two land in
// different clauses ("Never skip padding the middle; that is how minutes viewed
// rise."). Tier-A harms and deceptive scarcity are judged per clause.
const treatmentIntentIsHarmful = (text: string): boolean => {
  const clauses = htClauses(text);
  const purposePresent =
    clauses.some((clause) => HT_KEEP_WATCHING_PURPOSE.test(clause)) || retentionPurposePresent(text);
  if (clauses.some((clause) => htClauseAffirmsHarm(clause, purposePresent))) return true;
  // Generalisation layer (video-experiment-semantics): composed semantic
  // features -- inflection / passive / nominalisation tolerant mechanism
  // detection, field-wide keep-watching purpose, cross-clause deceptive
  // scarcity, and deterministic value-noun coreference -- with negation-parity
  // and reduction/front-position guards so legitimate tightening edits pass.
  return harmfulTreatmentByFeatures(text);
};

function freeText(result: ChannelVideoExperimentResult): string[] {
  const { experiment, alternatives, decisionDisagreements, viewerValueSafeguards } = result.content;
  return [
    experiment.title, experiment.hypothesis, experiment.targetVariable,
    experiment.decisionLinkage.hypothesisUnderTest, experiment.decisionLinkage.testsDecisionStatement,
    experiment.controlCondition.description, experiment.controlCondition.comparability,
    experiment.treatmentCondition.description, experiment.treatmentCondition.whatChanges, ...experiment.treatmentCondition.whatStaysConstant,
    ...experiment.heldConstant,
    ...experiment.knownConfounders.flatMap((item) => [item.confounder, item.mitigation]),
    experiment.primaryMetric.rationale,
    ...experiment.guardrailMetrics.flatMap((item) => [item.protects, item.degradationSignal]),
    ...experiment.viewerValueGuardrails,
    experiment.expectedDirection.justification,
    experiment.observationWindow.description, experiment.observationWindow.rationale, experiment.observationWindow.minimumBeforeReading,
    experiment.exposureRequirement.description, experiment.exposureRequirement.caveat,
    ...experiment.stoppingConditions, ...experiment.failureConditions, ...experiment.invalidationConditions.map((item) => item.statement),
    ...(experiment.rollbackPlan ? [experiment.rollbackPlan.trigger, experiment.rollbackPlan.action] : []),
    ...experiment.evidenceRequiredToInterpret,
    experiment.interpretationPlan.ifPrimaryFavorable, experiment.interpretationPlan.ifPrimaryUnfavorable, experiment.interpretationPlan.ifInconclusive,
    ...experiment.knownUnknowns,
    ...alternatives.flatMap((item) => [item.statement, item.targetVariable, item.notSelectedReason]),
    ...decisionDisagreements.flatMap((item) => [item.objection, item.basis]),
    viewerValueSafeguards.metricGamingRisk, viewerValueSafeguards.guardedMetricGaming,
  ];
}

function expectedSource(artifact: ApprovedVideoDecisionArtifact) {
  const decision = artifact.decisionResult;
  const diagnosis = artifact.reference.upstreamVideoDiagnosis;
  const performance = diagnosis.upstreamVideoPerformance;
  return {
    decisionWorkflowId: artifact.reference.decisionWorkflowId,
    decisionRunId: artifact.reference.decisionRunId,
    diagnosisWorkflowId: diagnosis.diagnosisWorkflowId,
    diagnosisRunId: diagnosis.diagnosisRunId,
    performanceWorkflowId: performance.performanceWorkflowId,
    performanceRunId: performance.performanceRunId,
    releaseWorkflowId: performance.upstreamVideoRelease.releaseWorkflowId,
    releaseRunId: performance.upstreamVideoRelease.releaseRunId,
    topicId: decision.source.topicId,
    pillarId: decision.source.pillarId,
    finalTitle: decision.source.finalTitle,
    subjectIdentity: `decision:${artifact.reference.decisionRunId}`,
  };
}

// ===========================================================================
// ROUND 6 -- structured semantic authority.
//
// The safety-critical experiment semantics are now DECLARED on closed
// vocabularies in `experiment.semanticIntent` and `experiment.invalidationConditions[].check`,
// and enforced deterministically over those enums. The Round 1-5 prose
// detectors (`harmfulTreatmentByFeatures`, `purposeFieldContradicts`,
// `invalidationDomainContradiction`, `CAUSAL_CERTAINTY`) are retained but
// DEMOTED: they now only fire as a fail-closed consistency signal when the
// structured declaration says "safe" while the prose describes the harm.
// Changing prose wording cannot change an invariant's verdict while the
// structured declaration is held constant.
// ===========================================================================

/** Structured: the treatment is a deliberate Viewer-Value-harming mechanism. */
function semanticIntentDeclaresHarmfulTreatment(intent: ExperimentSemanticIntent): boolean {
  return (
    (intent.prolongsContentForRetention && intent.addedLengthCarriesProportionalValue !== "YES") ||
    intent.withholdsPromisedValueForRetention ||
    intent.manufacturesAntagonismForEngagement ||
    (intent.usesScarcityOrUrgencyClaim && intent.scarcityBasis !== "REAL_FINITE_AND_SUPPORTED")
  );
}

/** Structured: the declaration positively asserts NONE of the harmful mechanisms. */
function semanticIntentDeclaresCleanTreatment(intent: ExperimentSemanticIntent): boolean {
  return (
    intent.prolongsContentForRetention === false &&
    intent.withholdsPromisedValueForRetention === false &&
    intent.manufacturesAntagonismForEngagement === false &&
    intent.usesScarcityOrUrgencyClaim === false
  );
}

/** Structured: the run's evidence is decoupled from what ships (outcome-independent). */
function semanticIntentDeclaresOutcomeIndependent(experiment: ChannelVideoExperimentResult["content"]["experiment"]): boolean {
  if (experiment.measurementOnly) return false; // a probe informs a future decision; it has no incumbent/challenger to ship
  const intent = experiment.semanticIntent;
  return (
    intent.evidenceCanChangeShippingDecision === false ||
    intent.preservationCondition === "ALWAYS_REGARDLESS_OF_RESULT" ||
    // a comparison whose adoption OR preservation is declared "measurement only"
    // has no evidence-bound path from result to shipping decision.
    intent.preservationCondition === "NONE_MEASUREMENT_ONLY" ||
    intent.adoptionCondition === "NONE_MEASUREMENT_ONLY"
  );
}

/** Structured: the linkage explicitly ties adoption and preservation to evidence. */
function semanticIntentDeclaresEvidenceConditionedLinkage(intent: ExperimentSemanticIntent): boolean {
  const adoptionIsEvidenceBound =
    intent.adoptionCondition === "CHALLENGER_DECISIVELY_WINS_PRIMARY_WITHOUT_GUARDRAIL_BREACH" ||
    intent.adoptionCondition === "CHALLENGER_WINS_PRIMARY" ||
    intent.adoptionCondition === "PREDEFINED_EVIDENCE_THRESHOLD_MET";
  const preservationIsEvidenceBound =
    intent.preservationCondition === "CHALLENGER_FAILS_TO_WIN" ||
    intent.preservationCondition === "INCONCLUSIVE_OR_NULL_RESULT" ||
    intent.preservationCondition === "GUARDRAIL_BREACH" ||
    intent.preservationCondition === "INSUFFICIENT_EVIDENCE_VS_THRESHOLD";
  return intent.evidenceCanChangeShippingDecision === true && adoptionIsEvidenceBound && preservationIsEvidenceBound;
}

// Domain-impossible (metric, relation, bound) triples: a criterion whose trigger
// is one of these can never fire, so it is not a real safeguard. A small closed
// table over enums -- not a theorem prover, and NOT natural-language comparison.
// `VIEWS > IMPRESSIONS_SERVED` is deliberately absent: YouTube impressions
// exclude external / notification / browse-off surfaces, so a view without a
// counted impression is possible (established by the CHANNEL_VIDEO_PERFORMANCE
// verification that removed the `views <= impressions` invariant).
const FRACTION_OF_WHOLE_METRICS = new Set([
  "AVERAGE_PERCENTAGE_VIEWED",
  "IMPRESSION_CLICK_THROUGH_RATE",
  "RETURNING_VIEWERS_RATE",
  "SEARCH_IMPRESSION_SHARE",
]);
const NON_NEGATIVE_METRICS = new Set([
  "IMPRESSIONS", "IMPRESSION_CLICK_THROUGH_RATE", "VIEWS", "UNIQUE_VIEWERS",
  "AVERAGE_VIEW_DURATION", "AVERAGE_PERCENTAGE_VIEWED", "WATCH_TIME_HOURS",
  "RETURNING_VIEWERS_RATE", "SUBSCRIBERS_GAINED", "LIKES_RATE", "COMMENTS_RATE",
  "SHARES", "SURVEY_SATISFACTION", "SEARCH_IMPRESSION_SHARE",
]);

function invalidationCheckIsIncoherent(condition: ExperimentInvalidationCondition): boolean {
  const check = condition.check;
  if (check.kind === "LOGICALLY_SELF_CONTRADICTORY") return true;
  if (check.kind !== "METRIC_DOMAIN_BOUND") return false;
  const { metric, relation, bound } = check;
  if (relation === "EXCEEDS") {
    if (metric === "AVERAGE_VIEW_DURATION" && bound === "VIDEO_LENGTH") return true;
    if (metric === "AVERAGE_PERCENTAGE_VIEWED" && bound === "VIDEO_LENGTH") return true;
    if (metric === "UNIQUE_VIEWERS" && bound === "TOTAL_VIEWS") return true;
    if (bound === "ONE_HUNDRED_PERCENT" && FRACTION_OF_WHOLE_METRICS.has(metric)) return true;
  }
  if (relation === "BELOW" && bound === "ZERO" && NON_NEGATIVE_METRICS.has(metric)) return true;
  return false;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const rule = (code: string, severity: Finding["severity"], check: (ctx: ExperimentValidationContext) => string[]): ExperimentRule => ({ code, severity, check });

/**
 * The single authoritative rule catalogue. `deterministicChecksPassed` /
 * `deterministicChecksFailed` are always computed from this array's length and
 * from distinct failed codes -- never from a hand-maintained literal -- so an
 * added or removed rule can never silently drift the reported count out of sync
 * with what actually ran (the CHANNEL_VIDEO_PERFORMANCE P3 defect class).
 */
export const DETERMINISTIC_VIDEO_EXPERIMENT_RULES: ExperimentRule[] = [
  // --- Upstream integrity ----------------------------------------------------
  rule("UPSTREAM_DECISION_REFERENCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.approvedVideoDecisionReference, artifact.reference) ? [] : ["The experiment changed the exact approved Decision reference."]),
  rule("EXPERIMENT_SCOPE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.experimentScope, artifact.experimentScope) ? [] : ["The experiment changed the authoritative compact lineage projection."]),
  rule("EXPERIMENT_CONSTRAINTS_PROJECTION_CHANGED", "error", ({ result, expectedConstraints }) =>
    canonicalEquals(result.experimentConstraints, expectedConstraints) ? [] : ["The experiment changed the server-derived constraints projection."]),
  rule("VIEWER_VALUE_PROVENANCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.viewerValueProvenance, artifact.decisionResult.viewerValueProvenance) ? [] : ["Viewer Value provenance differs from the exact approved Decision artifact."]),
  rule("EXPERIMENT_SOURCE_CHANGED", "error", ({ result, artifact }) =>
    canonicalEquals(result.source, expectedSource(artifact)) ? [] : ["The experiment source identity does not match authoritative Decision state."]),

  // --- Decision fidelity / eligibility -------------------------------------
  rule("EXPERIMENT_ON_INELIGIBLE_DECISION", "error", ({ artifact, expectedConstraints }) =>
    artifact.reference.experimentEligible === true && (expectedConstraints.decisionType === "INVESTIGATE" || expectedConstraints.decisionType === "PRIORITIZE_CHANGE")
      ? []
      : ["An experiment was designed for a Decision that is not experiment-eligible."]),
  rule("EXPERIMENT_CATEGORY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.category === expectedConstraints.decisionCategory ? [] : ["The experiment category does not match the approved Decision's category."]),
  rule("EXPERIMENT_DECISION_LINKAGE_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const linkage = result.content.experiment.decisionLinkage;
    return linkage.decisionId === expectedConstraints.decisionId
      && linkage.decisionType === expectedConstraints.decisionType
      && linkage.testsDecisionStatement === expectedConstraints.decisionStatement
      ? []
      : ["decisionLinkage does not identify the exact approved Decision (id, type, and verbatim decision statement must all match the server projection)."];
  }),
  rule("DECISION_REWRITTEN", "error", ({ result }) =>
    freeText(result).some((text) => DECISION_OVERRIDE.test(text)) ? ["The experiment restates, overrides, or contradicts the approved Decision instead of testing it."] : []),
  // An INVESTIGATE / PRIORITIZE_CHANGE decision has already resolved to test a
  // change or an open question. An experiment whose stated PURPOSE is to confirm
  // or defend the current approach is a semantic rewrite of the decision -- even
  // when its id/type are correct. An interpretation-plan OUTCOME of "preserve"
  // stays valid and is not scanned.
  // ROUND 6: authority is `semanticIntent`'s decision-linkage enums. An
  // outcome-independent design (evidence cannot change what ships / incumbent
  // preserved regardless of result / adoption declared measurement-only on a
  // manipulation) is contradictory regardless of prose wording. Prose is a
  // fail-closed backup: if the structured linkage is NOT explicitly
  // evidence-conditioned and the prose still reads as immutability, that
  // disagreement also blocks.
  rule("EXPERIMENT_PURPOSE_CONTRADICTS_DECISION", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (semanticIntentDeclaresOutcomeIndependent(experiment)) {
      return ["The experiment's structured decision linkage declares its evidence cannot change what ships (or preserves the incumbent regardless of the result); an INVESTIGATE / PRIORITIZE_CHANGE decision is testing a change, not defending it."];
    }
    if (experiment.measurementOnly) return [];
    if (semanticIntentDeclaresEvidenceConditionedLinkage(experiment.semanticIntent)) return []; // explicitly evidence-conditioned -> valid, whatever the prose says
    const purpose = [
      experiment.title, experiment.hypothesis, experiment.decisionLinkage.hypothesisUnderTest,
      experiment.targetVariable, experiment.expectedDirection.justification,
      experiment.treatmentCondition.whatChanges, experiment.treatmentCondition.description,
    ];
    return purpose.some((text) => purposeFieldContradicts(text))
      ? ["The structured decision linkage is not explicitly evidence-conditioned and the design prose reads as preserving / confirming the current approach; an INVESTIGATE / PRIORITIZE_CHANGE decision is testing a change."]
      : [];
  }),
  rule("EXPERIMENT_TYPE_NOT_PERMITTED", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.permittedExperimentTypes.includes(result.content.experiment.experimentType)
      ? []
      : [`${result.content.experiment.experimentType} is not a server-permitted experiment shape for a ${expectedConstraints.decisionType} decision.`]),
  rule("DISAGREED_DECISION_ELEMENT_AS_BASIS", "error", ({ result }) => {
    const disputed = new Set(result.content.decisionDisagreements.map((item) => item.disputedFindingId).filter((id): id is string => id !== null));
    return result.content.experiment.supportingDecisionFindingIds.filter((id) => disputed.has(id)).map((id) => `${id} is both disputed and cited as experiment support.`);
  }),
  rule("DISAGREEMENT_RAISES_CONFIDENCE", "error", ({ result }) =>
    result.content.decisionDisagreements.length > 0 && result.content.experiment.confidenceInDesign === "high"
      ? ["A recorded objection to the Decision cannot itself justify high design confidence."]
      : []),

  // --- Lineage / citation fabrication ------------------------------------
  rule("EXPERIMENT_FINDING_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableFindingIds);
    const cited = [
      ...result.content.experiment.supportingDecisionFindingIds,
      ...result.content.decisionDisagreements.map((item) => item.disputedFindingId).filter((id): id is string => id !== null),
    ];
    return cited.filter((id) => !known.has(id)).map((id) => `${id} is not a finding the approved Decision cited.`);
  }),
  rule("EXPERIMENT_OBSERVATION_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableObservationIds);
    return result.content.experiment.supportingObservationIds.filter((id) => !known.has(id)).map((id) => `${id} is not an observation the approved Decision cited.`);
  }),
  rule("EXPERIMENT_UNKNOWN_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set(expectedConstraints.citableUnknownIds);
    return result.content.experiment.constrainingUnknownIds.filter((id) => !known.has(id)).map((id) => `${id} is not a constraining unknown the approved Decision carried.`);
  }),
  rule("EXPERIMENT_LINEAGE_NOT_FOUND", "error", ({ result }) => {
    const known = new Set(result.experimentScope.entries.map((entry) => entry.key));
    return result.experimentConstraints.citableLineageKeys.filter((key) => !known.has(key)).map((key) => `${key} is not in the authoritative lineage projection.`);
  }),
  rule("DUPLICATE_EXPERIMENT_ID", "error", ({ result }) => {
    const ids = [result.content.experiment.id, ...result.content.alternatives.map((item) => item.id)];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ids) { if (seen.has(id)) duplicates.push(id); seen.add(id); }
    return duplicates.map((id) => `${id} is used more than once across the experiment and its alternatives.`);
  }),
  rule("CRITIC_EVIDENCE_NOT_FOUND", "error", ({ result, expectedConstraints }) => {
    const known = new Set([
      ...expectedConstraints.citableFindingIds, ...expectedConstraints.citableUnknownIds,
      ...expectedConstraints.citableObservationIds, ...expectedConstraints.citableLineageKeys,
    ]);
    const messages: string[] = [];
    for (const finding of result.crossModelReview.findings) {
      if (finding.severity === "error" && finding.evidenceRefs.length === 0) messages.push(`Blocking critic issue ${finding.code} must cite authoritative evidence.`);
      for (const ref of finding.evidenceRefs) if (!known.has(ref)) messages.push(`Critic issue ${finding.code} cites unknown evidence ${ref}.`);
    }
    return messages;
  }),

  // --- Epistemic safety / fake precision --------------------------------
  // ROUND 6: authority is `semanticIntent.causalClaimStrength`. This contract is
  // qualitative with no significance testing, so a DEFINITIVE_CAUSAL claim is
  // never supportable. Prose regex is a fail-closed backup for a mis-declared
  // strength.
  rule("UNSUPPORTED_CAUSAL_CERTAINTY", "error", ({ result }) => {
    if (result.content.experiment.semanticIntent.causalClaimStrength === "DEFINITIVE_CAUSAL") {
      return ["semanticIntent.causalClaimStrength is DEFINITIVE_CAUSAL; this qualitative experiment contract cannot support a definitive causal claim."];
    }
    return freeText(result).some((text) => CAUSAL_CERTAINTY.test(text))
      ? ["The design prose asserts causal certainty the contract forbids while semanticIntent.causalClaimStrength is not DEFINITIVE_CAUSAL."]
      : [];
  }),
  rule("FABRICATED_QUANTITY_IN_DESIGN", "error", ({ result }) => {
    const messages = new Set<string>();
    for (const text of freeText(result)) {
      if (SPELLED_QUANTITY.test(text)) messages.add(`"${text.trim().slice(0, 90)}" states a spelled-out quantity; experiment design must stay qualitative.`);
      if (MAGNITUDE_CONTEXT.test(text)) messages.add(`"${text.trim().slice(0, 90)}" asserts a numeric magnitude or baseline; experiment design must stay qualitative.`);
      DIGIT_RUN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = DIGIT_RUN.exec(text)) !== null) {
        const token = match[0];
        if (YEAR.test(token)) continue;
        const before = text.slice(0, match.index);
        const after = text.slice(match.index + token.length);
        if (LABEL_BEFORE.test(before) && !QUANTITY_AFTER.test(after)) continue; // "variant 2" / "episode 7" is a label, not a measurement
        if (STRUCTURAL_NOUN_AFTER.test(after) && !QUANTITY_AFTER.test(after)) continue; // "3-part hook" / "5-section outline" is a structural count, not a measurement
        messages.add(`Numeric quantity "${token}" appears in the design; use a label ("variant B"), never a measurement, duration, or count.`);
      }
    }
    return [...messages];
  }),
  rule("FABRICATED_STATISTICAL_CLAIM", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_STAT.test(text)) ? ["The experiment states statistical-significance / power / MDE claims no data supports."] : []),
  rule("FABRICATED_SAMPLE_SIZE", "error", ({ result }) =>
    freeText(result).some((text) => SAMPLE_SIZE.test(text)) ? ["The experiment fabricates a sample size or exposure count; exposure sufficiency must stay qualitative and operator-confirmed."] : []),
  rule("FABRICATED_EFFECT_FORECAST", "error", ({ result }) =>
    freeText(result).some((text) => FABRICATED_FORECAST.test(text)) ? ["The experiment states a fabricated lift, ROI, or expected-effect forecast; no such quantity exists in this contract."] : []),
  rule("MAGNITUDE_CLAIM_NOT_QUALITATIVE", "error", ({ result }) =>
    result.content.experiment.expectedDirection.magnitudeClaim === "QUALITATIVE_ONLY" ? [] : ["expectedDirection.magnitudeClaim must remain QUALITATIVE_ONLY."]),

  // --- Causal interpretability / control -------------------------------
  rule("CONTROL_KIND_MISMATCH", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.controlCondition.kind === EXPERIMENT_TYPE_CONTROL_KIND[experiment.experimentType]
      ? []
      : ["The control condition kind does not match the server-derived kind for this experiment shape."];
  }),
  rule("CONTROL_TREATMENT_INDISTINGUISHABLE", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE") return [];
    if (experiment.treatmentCondition.whatChanges.trim().length === 0) return ["A comparison experiment must state what the treatment changes."];
    return normalize(experiment.treatmentCondition.description) === normalize(experiment.controlCondition.description)
      || normalize(experiment.treatmentCondition.whatChanges) === normalize(experiment.controlCondition.description)
      ? ["The treatment and control conditions are described identically; the comparison would not be interpretable."]
      : [];
  }),
  rule("UNCONTROLLED_CONFOUNDER", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE") return [];
    if (experiment.knownConfounders.length === 0) return ["A comparison experiment must name at least one known confounder and its mitigation."];
    return experiment.knownConfounders
      .filter((item) => item.residualRisk === "HIGH" && item.mitigation.trim().length === 0)
      .map((item) => `Confounder "${item.confounder}" has HIGH residual risk and no mitigation.`);
  }),
  rule("NOTHING_HELD_CONSTANT", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.experimentType !== "OBSERVATIONAL_PROBE" && experiment.heldConstant.length === 0
      ? ["A comparison experiment must hold something constant to keep the comparison interpretable."]
      : [];
  }),
  rule("OBSERVATIONAL_PROBE_MANIPULATES", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType !== "OBSERVATIONAL_PROBE") return [];
    const messages: string[] = [];
    if (experiment.unitOfAssignment !== "NONE_OBSERVATIONAL") messages.push("An observational probe cannot assign a treatment unit.");
    if (!NO_CHANGE_TREATMENT.test(experiment.treatmentCondition.whatChanges)) messages.push("An observational probe changes nothing; treatmentCondition.whatChanges must say so.");
    if (experiment.rollbackPlan !== null) messages.push("An observational probe has nothing to roll back.");
    return messages;
  }),

  // --- Stopping / failure / invalidation / rollback -------------------
  rule("STOPPING_CONDITIONS_INCOHERENT", "error", ({ result }) => {
    const stopping = result.content.experiment.stoppingConditions;
    const guardrailMetricTerms = result.content.experiment.guardrailMetrics.map((item) => item.metric.toLowerCase());
    if (stopping.length < 2) return ["At least two pre-committed stopping conditions are required."];
    const anyGuardTrigger = stopping.some((text) => STOPPING_TRIGGER.test(text) || guardrailMetricTerms.some((metric) => text.toLowerCase().includes(metric)));
    return anyGuardTrigger ? [] : ["No stopping condition is tied to a guardrail metric or a Viewer Value harm signal."];
  }),
  rule("MISSING_FAILURE_CONDITION", "error", ({ result }) =>
    result.content.experiment.failureConditions.length === 0 ? ["The experiment declares no condition under which the hypothesis is not supported."] : []),
  rule("MISSING_INVALIDATION_CONDITION", "error", ({ result }) =>
    result.content.experiment.invalidationConditions.length === 0 ? ["The experiment declares no condition that would make the result itself uninterpretable."] : []),
  rule("ROLLBACK_PLAN_MISSING", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return experiment.experimentType !== "OBSERVATIONAL_PROBE" && experiment.rollbackPlan === null
      ? ["A manipulation experiment requires a rollback plan."]
      : [];
  }),
  rule("TREATMENT_NOT_EASILY_REVERSIBLE", "error", ({ result, expectedConstraints }) => {
    const experiment = result.content.experiment;
    if (experiment.experimentType === "OBSERVATIONAL_PROBE" || experiment.rollbackPlan === null) return [];
    const riskyState = expectedConstraints.viewerValueState !== "PRESERVED" || expectedConstraints.decisionReversibility === "HARD_TO_REVERSE";
    return riskyState && experiment.rollbackPlan.reversibility !== "EASILY_REVERSIBLE"
      ? ["When Viewer Value is not preserved or the decision change is hard to reverse, the experiment treatment must be easily reversible."]
      : [];
  }),

  // --- Internal semantic coherence -----------------------------------
  rule("CONFOUNDER_HELD_CONSTANT_CONTRADICTION", "error", ({ result }) => {
    const held = new Set(result.content.experiment.heldConstant.map(normalize));
    return result.content.experiment.knownConfounders
      .filter((item) => held.has(normalize(item.confounder)))
      .map((item) => `"${item.confounder}" is listed as both a held-constant dimension and an uncontrolled confounder; it cannot be both.`);
  }),
  rule("GUARDRAIL_PRECEDENCE_CONTRADICTED_IN_PROSE", "error", ({ result }) => {
    const experiment = result.content.experiment;
    const texts = [
      ...experiment.stoppingConditions,
      experiment.interpretationPlan.ifPrimaryFavorable, experiment.interpretationPlan.ifPrimaryUnfavorable, experiment.interpretationPlan.ifInconclusive,
      ...(experiment.rollbackPlan ? [experiment.rollbackPlan.action, experiment.rollbackPlan.trigger] : []),
    ];
    return texts.some((text) => GUARDRAIL_OVERRIDE.test(text) || CONTINUE_NEAR_GUARDRAIL.test(text))
      ? ["The design says to continue despite a guardrail breach or degradation; this contradicts guardrailPrecedence and the stopping conditions."]
      : [];
  }),
  rule("ROLLBACK_DOES_NOT_REVERT", "error", ({ result }) => {
    const rollback = result.content.experiment.rollbackPlan;
    return rollback && ROLLBACK_NOT_REVERTING.test(rollback.action)
      ? ["The rollback plan's action continues or preserves the treatment instead of reverting it."]
      : [];
  }),
  // ROUND 6: authority is the typed `check` on each invalidation condition. A
  // domain-impossible (metric, relation, bound) triple, or a self-contradictory
  // criterion, can never fire. The prose `statement` is a fail-closed backup:
  // if the statement reads as "impossible by construction" while the typed check
  // does not encode that, the disagreement still blocks.
  rule("INVALIDATION_CONDITION_INCOHERENT", "error", ({ result }) =>
    result.content.experiment.invalidationConditions
      .filter((condition) => {
        if (invalidationCheckIsIncoherent(condition)) return true;
        // Prose backup applies ONLY to the unconstrained kinds -- a
        // METRIC_DOMAIN_BOUND not caught above, or a QUALITATIVE_JUDGMENT. A
        // check that names a concrete real trigger (DATA_UNAVAILABLE /
        // CONFOUNDING_EVENT / DELIVERY_FAILURE) is coherent whatever the prose says.
        if (condition.check.kind !== "QUALITATIVE_JUDGMENT" && condition.check.kind !== "METRIC_DOMAIN_BOUND") return false;
        const expanded = condition.statement.replace(/\bcan['’]t\b/gi, "can not").replace(/\bwon['’]t\b/gi, "will not").replace(/(\w)n['’]t\b/gi, "$1 not");
        return INCOHERENT_INVALIDATION.test(expanded) || invalidationDomainContradiction(expanded);
      })
      .map((condition) => `Invalidation condition "${condition.statement.trim().slice(0, 90)}" can never trigger; it is not a real safeguard.`)),

  // --- Viewer Value (hard constraint) ----------------------------------
  rule("VIEWER_VALUE_STATE_CHANGED", "error", ({ result, expectedConstraints }) =>
    result.content.viewerValueSafeguards.inheritedState === expectedConstraints.viewerValueState ? [] : ["Inherited Viewer Value state does not match the approved Decision state."]),
  rule("PROMISE_INTEGRITY_RISK_INCONSISTENT", "error", ({ result, expectedConstraints }) => {
    const safeguards = result.content.viewerValueSafeguards;
    if (safeguards.inheritedState === "AT_RISK" && safeguards.promiseIntegrityRisk === "NONE") return ["Viewer Value inherited state is AT_RISK; promiseIntegrityRisk cannot be NONE."];
    return PROMISE_RISK_ORDER[safeguards.promiseIntegrityRisk] < PROMISE_RISK_ORDER[expectedConstraints.promiseIntegrityRisk]
      ? ["The experiment understates the promise-integrity risk the approved Decision recorded."]
      : [];
  }),
  rule("MISSING_VIEWER_VALUE_GUARDRAIL", "error", ({ result }) =>
    result.content.experiment.viewerValueGuardrails.length === 0 ? ["The experiment declares no Viewer Value guardrail."] : []),
  // Layer 1 -- treatment safety. The intervention itself must not be a mechanism
  // that deliberately harms Viewer Value (padding, promise-withholding, outrage
  // bait, trust-damaging conversion). This is independent of Layer 2 (guardrail
  // adequacy): a compliant, family-appropriate guardrail does NOT sanitize a
  // harmful treatment. Scoped to the canonical treatment-intent fields; the
  // clause-aware classifier (see `treatmentIntentIsHarmful`) preserves treatments
  // described by what they avoid ("improve pacing without delaying the payoff")
  // and safe interventions that merely mention retention / filler / pacing.
  // ROUND 6: authority is `semanticIntent`. A treatment that structurally
  // declares a Viewer-Value-harming mechanism (disproportionate prolonging,
  // promise withholding, manufactured antagonism, or a scarcity claim without a
  // real, supported basis) is rejected regardless of prose. The Round 1-5 prose
  // classifier is retained as a fail-closed disagreement signal: if the
  // declaration positively asserts a clean treatment while the prose describes a
  // harmful mechanism, that blocks too.
  rule("VIEWER_VALUE_TREATMENT_HARMFUL", "error", ({ result }) => {
    const experiment = result.content.experiment;
    const intent = experiment.semanticIntent;
    if (semanticIntentDeclaresHarmfulTreatment(intent)) {
      return ["semanticIntent declares a Viewer-Value-harming treatment mechanism (disproportionate prolonging for retention, promise withholding, manufactured antagonism, or an unsupported scarcity claim); an independent guardrail cannot make a harmful intervention acceptable."];
    }
    const intentFields = [
      experiment.title, experiment.hypothesis, experiment.decisionLinkage.hypothesisUnderTest,
      experiment.targetVariable, experiment.expectedDirection.justification,
      experiment.treatmentCondition.description, experiment.treatmentCondition.whatChanges,
    ];
    return semanticIntentDeclaresCleanTreatment(intent) && intentFields.some(treatmentIntentIsHarmful)
      ? ["semanticIntent declares a clean treatment, but the design prose describes a Viewer-Value-harming mechanism; the contradiction is resolved fail-closed."]
      : [];
  }),
  // Every primary metric -- not only acquisition-side ones -- can be gamed
  // against viewer value. A guardrail metric must independently protect viewer
  // benefit, and it must differ from the primary itself. When the primary IS a
  // retention metric (itself gameable via padding), the guardrail must be a
  // harder-to-game loyalty signal (satisfaction / returning viewers).
  rule("NO_INDEPENDENT_VIEWER_BENEFIT_GUARDRAIL", "error", ({ result }) => {
    const experiment = result.content.experiment;
    const primary = experiment.primaryMetric.metric;
    const family = METRIC_FAMILY[primary] ?? "OTHER";
    const guardMetrics = experiment.guardrailMetrics.map((item) => item.metric);
    const acceptable = family === "RETENTION"
      ? guardMetrics.some((metric) => LOYALTY_METRICS.has(metric))
      : guardMetrics.some((metric) => VIEWER_BENEFIT_METRICS.has(metric) && metric !== primary);
    return acceptable
      ? []
      : [family === "RETENTION"
        ? "The primary metric is retention (gameable via padding); a guardrail metric must be a loyalty signal (survey satisfaction or returning-viewers rate)."
        : "No guardrail metric independently protects viewer benefit (satisfaction / returning viewers / retention distinct from the primary metric)."];
  }),
  rule("METRIC_GAMING_UNGUARDED", "error", ({ result }) => {
    const experiment = result.content.experiment;
    if (experiment.interpretationPlan.guardrailPrecedence !== true) return ["interpretationPlan.guardrailPrecedence must be true so a guardrail breach overrides a favorable primary result."];
    if (experiment.measurementOnly) return []; // an observational probe applies no treatment; there is no metric to game
    const family = METRIC_FAMILY[experiment.primaryMetric.metric] ?? "OTHER";
    const guardrailText = experiment.viewerValueGuardrails.join(" • ");
    return FAMILY_GAMING_TERMS[family].test(guardrailText)
      ? []
      : [`The primary metric can be gamed against viewer value (${family.toLowerCase()} family); no Viewer Value guardrail names the specific gaming risk (${family === "RETENTION" ? "padding / filler / stalling" : family === "ENGAGEMENT" ? "outrage / rage-bait" : family === "ACQUISITION" ? "misleading / over-promising hooks" : "misleading claims / eroding trust"}).`];
  }),
  rule("VIEWER_VALUE_ESCALATION_REQUIRED", "error", ({ result, expectedConstraints }) => {
    const escalationRequired = expectedConstraints.viewerValueEscalationRequired || expectedConstraints.viewerValueState === "AT_RISK";
    if (!escalationRequired) return [];
    return result.content.experiment.requiresHumanJudgment && result.content.viewerValueSafeguards.escalationRequired
      ? []
      : ["Viewer Value escalation is required: requiresHumanJudgment and viewerValueSafeguards.escalationRequired must both be set."];
  }),
  rule("ESCALATION_FLAG_MISMATCH", "error", ({ result, expectedConstraints }) => {
    const required = expectedConstraints.viewerValueEscalationRequired || expectedConstraints.viewerValueState === "AT_RISK";
    return result.content.viewerValueSafeguards.escalationRequired === required ? [] : ["viewerValueSafeguards.escalationRequired does not match the server-derived Viewer Value escalation rule."];
  }),
  rule("AT_RISK_REQUIRES_CONSERVATIVE_DESIGN", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueState === "AT_RISK" && result.content.experiment.experimentType === "SEQUENTIAL_COMPARISON"
      ? ["Viewer Value is AT_RISK: a forward-only sequential comparison exposes every viewer to the change; use a holdout, a simultaneous control, or an observational probe."]
      : []),
  rule("VIEWER_VALUE_CONFIDENCE_CAP", "error", ({ result, expectedConstraints }) =>
    expectedConstraints.viewerValueState === "UNKNOWN" && result.content.experiment.confidenceInDesign === "high"
      ? ["Design confidence cannot be high while Viewer Value state is unknown."]
      : []),
  rule("PROMISE_HARM_STOPPING_MISSING", "error", ({ result, expectedConstraints }) => {
    const risky = expectedConstraints.viewerValueState === "AT_RISK" || expectedConstraints.promiseIntegrityRisk !== "NONE";
    if (!risky) return [];
    return result.content.experiment.stoppingConditions.some((text) => PROMISE_HARM_TERM.test(text))
      ? []
      : ["A Viewer-Value-risky experiment must include a stopping condition tied to promise integrity, trust, or satisfaction harm."];
  }),

  // --- Confidence entitlement -----------------------------------------
  rule("DESIGN_CONFIDENCE_EXCEEDS_CEILING", "error", ({ result, expectedConstraints }) => {
    const strengthCeiling = EVIDENCE_STRENGTH_CEILING[expectedConstraints.evidenceStrength];
    const ceilings = [expectedConstraints.globalConfidenceCeiling, expectedConstraints.categoryConfidenceCeiling, strengthCeiling] as const;
    const ceiling = ceilings.reduce((lowest, current) => (CONFIDENCE_ORDER[current] < CONFIDENCE_ORDER[lowest] ? current : lowest));
    return CONFIDENCE_ORDER[result.content.experiment.confidenceInDesign] > CONFIDENCE_ORDER[ceiling]
      ? [`Design confidence ${result.content.experiment.confidenceInDesign} exceeds the evidence-entitled ceiling ${ceiling}.`]
      : [];
  }),
  rule("HIGH_CONFIDENCE_NOT_ALLOWED", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.confidenceInDesign === "high" && (expectedConstraints.evidenceStrength === "WEAK" || expectedConstraints.evidenceStrength === "NONE")
      ? ["High design confidence requires at least MODERATE category evidence in the approved Decision."]
      : []),

  // --- Measurement grounding ----------------------------------------
  rule("MISSING_INTERPRETIVE_EVIDENCE", "error", ({ result }) =>
    result.content.experiment.evidenceRequiredToInterpret.length === 0 ? ["The experiment names no evidence required to interpret its result."] : []),
  rule("UNRESOLVED_UNKNOWN_IGNORED", "error", ({ result, expectedConstraints }) => {
    const carried = new Set(result.content.experiment.constrainingUnknownIds);
    return expectedConstraints.citableUnknownIds.filter((id) => !carried.has(id)).map((id) => `Constraining unknown ${id} from the approved Decision was not carried into the experiment.`);
  }),

  // --- Alternatives -----------------------------------------------
  rule("MISSING_ALTERNATIVE", "error", ({ result }) => {
    const experiment = result.content.experiment;
    return result.content.alternatives.some((item) => item.experimentType !== experiment.experimentType || normalize(item.targetVariable) !== normalize(experiment.targetVariable))
      ? []
      : ["At least one alternative must propose a genuinely different experiment shape or target variable."];
  }),
  rule("ALTERNATIVE_NOT_REJECTED", "error", ({ result }) =>
    result.content.alternatives.filter((item) => item.notSelectedReason.trim().length === 0).map((item) => `${item.id} has no rejection basis.`)),

  // --- Scope boundary -------------------------------------------
  rule("EXPERIMENT_EXECUTION_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => EXPERIMENT_EXECUTION_LEAKED.test(text)) ? ["The experiment contains publishing / provider execution instructions Experiment is never allowed to issue."] : []),
  rule("PORTFOLIO_RESPONSIBILITY_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => PORTFOLIO_LEAKED.test(text)) ? ["The experiment performs cross-video / portfolio prioritization reserved for CHANNEL_VIDEO_PORTFOLIO."] : []),
  rule("INTELLIGENCE_RESPONSIBILITY_LEAKED", "error", ({ result }) =>
    freeText(result).some((text) => INTELLIGENCE_LEAKED.test(text)) ? ["The experiment performs channel-wide strategy / meta-learning work reserved for CHANNEL_VIDEO_INTELLIGENCE."] : []),

  // --- Derived-field tampering --------------------------------
  rule("DISPOSITION_MISMATCH", "error", ({ result }) =>
    result.content.experiment.disposition === EXPERIMENT_TYPE_DISPOSITION[result.content.experiment.experimentType] ? [] : ["disposition does not match the server-derived mapping for this experiment shape."]),
  rule("MEASUREMENT_ONLY_MISMATCH", "error", ({ result }) =>
    result.content.experiment.measurementOnly === EXPERIMENT_TYPE_MEASUREMENT_ONLY[result.content.experiment.experimentType] ? [] : ["measurementOnly does not match the server-derived mapping for this experiment shape."]),
  rule("EVIDENCE_STRENGTH_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experiment.evidenceStrength === expectedConstraints.evidenceStrength ? [] : ["evidenceStrength does not match the approved Decision's category evidence strength."]),
  rule("EXPERIMENT_READY_MISMATCH", "error", ({ result, expectedConstraints }) =>
    result.content.experimentReady === deriveExperimentReady(result.content.experiment, expectedConstraints.viewerValueState) ? [] : ["experimentReady does not match the server-derived readiness of this design."]),
  rule("PORTFOLIO_ELIGIBILITY_MISMATCH", "error", ({ result }) =>
    result.content.portfolioEligible === EXPERIMENT_TYPE_PORTFOLIO_ELIGIBLE[result.content.experiment.experimentType] ? [] : ["portfolioEligible does not match the server-derived mapping for this experiment shape."]),

  // --- Model authority / payload -----------------------------
  rule("CRITIC_REJECTED_EXPERIMENT", "error", ({ result }) =>
    !result.crossModelReview.safeToFinalize || result.crossModelReview.findings.some((item) => item.severity === "error")
      ? ["The independent critic found a blocking issue; automated revision is forbidden."]
      : []),
  rule("MODEL_PROVIDER_INDEPENDENCE_REQUIRED", "error", ({ result }) =>
    result.modelProvenance.length !== 2 || result.modelProvenance[0].provider === result.modelProvenance[1].provider
      ? ["Experiment requires exactly one analyst and one distinct-provider critic attribution."]
      : []),
  rule("RESULT_PAYLOAD_TOO_LARGE", "error", ({ result, maxPayloadBytes }) =>
    Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes ? ["Experiment exceeds the pre-persistence payload ceiling."] : []),
];

export function deterministicVideoExperimentValidation(
  result: ChannelVideoExperimentResult,
  artifact: ApprovedVideoDecisionArtifact,
  expectedConstraints: VideoExperimentConstraints = deriveVideoExperimentConstraints(artifact),
  maxPayloadBytes = 48_000,
): Finding[] {
  const ctx: ExperimentValidationContext = { result, artifact, expectedConstraints, maxPayloadBytes };
  return DETERMINISTIC_VIDEO_EXPERIMENT_RULES.flatMap((experimentRule) =>
    experimentRule.check(ctx).map((message) => ({ severity: experimentRule.severity, code: experimentRule.code, message, evidenceIds: [] as string[] })));
}

export function videoExperimentQA(findings: Finding[]): VideoExperimentQAResult {
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const distinctFailedCodes = new Set(findings.map((item) => item.code)).size;
  return videoExperimentQAResultSchema.parse({
    passed: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    findings: findings.slice(0, 50),
    recommendation: errors === 0 ? (warnings === 0 ? "accept" : "human_review_required") : "revise",
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_EXPERIMENT_RULES.length - distinctFailedCodes),
    deterministicChecksFailed: distinctFailedCodes,
    modelUsage: { model: "deterministic", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
}

export function parseVideoExperimentResult(value: unknown) {
  return channelVideoExperimentResultSchema.parse(value);
}
