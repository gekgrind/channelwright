/**
 * Deterministic, LLM-free semantic-feature layer for the video-experiment
 * validator.
 *
 * The round-1..4 detectors in `video-experiment-validation.ts` enforce their
 * invariants with large surface-phrase alternations. Independent adversarial
 * verification showed that approach fits known phrasings rather than the
 * underlying semantics: 36 of 41 fresh harmful-treatment probes passed while the
 * 120-case regression suite stayed green.
 *
 * This module raises the abstraction one level. Instead of matching whole
 * sentence templates it:
 *
 *   1. normalises text (contractions expanded, unicode dashes/quotes folded,
 *      whitespace collapsed) so voice and punctuation do not matter;
 *   2. segments into clauses that carry their leading connective type
 *      (conditional / concessive / contrastive / causal / coordinating) so a
 *      mechanism in one clause can be composed with a purpose or a concession in
 *      an adjacent one;
 *   3. detects a small set of SEMANTIC FEATURES with inflection-tolerant anchors
 *      (`\w*` suffixes, nominalisations, passive participles) and tests concept
 *      presence + object/purpose presence SEPARATELY rather than as a rigid
 *      `verb + object` adjacency;
 *   4. composes those features into the four invariants the verifier broke,
 *      with explicit negation-parity and reduction/position guards so the
 *      generalisation does not swallow legitimate editorial language.
 *
 * It deliberately still relies on bounded lexical anchors for each feature
 * (there is no parser or model here); the generalisation is in the COMPOSITION
 * and in the morphology tolerance, not in open-vocabulary understanding. See the
 * "Remaining risk" note in the repair report.
 */

// --------------------------------------------------------------------------
// Normalisation + clause segmentation
// --------------------------------------------------------------------------

/** Lowercase, expand contractions, fold dashes/quotes, collapse whitespace. */
export function normalizeSemanticText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−⁃]/g, " ")
    // Contractions: the apostrophe is REQUIRED so ordinary words that merely end
    // in "nt" ("current", "present", "experiment", "moment") are never touched.
    .replace(/\bcan['’]t\b/g, "can not")
    .replace(/\bwo\s*n['’]t\b/g, "will not")
    .replace(/\bwon['’]t\b/g, "will not")
    .replace(/\bshan['’]t\b/g, "shall not")
    .replace(/\bain['’]t\b/g, "is not")
    .replace(/([a-z])n['’]t\b/g, "$1 not")
    .replace(/['’]re\b/g, " are")
    .replace(/['’]ve\b/g, " have")
    .replace(/['’]ll\b/g, " will")
    .replace(/['’]m\b/g, " am")
    .replace(/\s+/g, " ")
    .trim();
}

export type Connective =
  | "NONE"
  | "CONDITIONAL"
  | "CONCESSIVE"
  | "CONTRAST"
  | "CAUSAL"
  | "PURPOSE"
  | "COORD";

export type SemClause = { raw: string; norm: string; lead: Connective };

// Split points: sentence punctuation, semicolons/colons, and a contrastive
// coordinator or subordinator that starts a materially new proposition. Plain
// commas are kept inside a clause so "if X, preserve Y" stays one analysable
// unit and its condition -> consequence link remains visible.
const SEM_SPLIT =
  /[.!?;:]+|\s+(?:but|yet|however|nevertheless|nonetheless|whereas|while|although|though)\s+|,\s*(?:but|yet|however|whereas|although|though|while|nonetheless|nevertheless|and yet|then again)\s+|\s+—\s+/i;

const LEAD_CONDITIONAL = /^(?:if\b|iff\b|should\s+(?:the|a|an|it|they|we|you|challenger|treatment|results?)\b|when(?:ever)?\b|were\s+(?:the|it|we|they|a|an)\b|assuming\b|provided\b|providing\b|given\s+that\b|in\s+the\s+event\b|in\s+case\b|on\s+the\s+off\s+chance\b|so\s+long\s+as\b|as\s+long\s+as\b)/i;
const LEAD_CONCESSIVE = /^(?:although|though|even\s+though|even\s+if|even\s+when|even\s+where|unless|despite|in\s+spite\s+of|notwithstanding|regardless\b|no\s+matter\b|whatever\b|whichever\b|however\b|come\s+what\s+may|either\s+way|whether\b|for\s+all\s+that)/i;
const LEAD_CONTRAST = /^(?:but|yet|however|nevertheless|nonetheless|still|anyway|anyhow|all\s+the\s+same|even\s+so|that\s+said|then\s+again|whereas)\b/i;
const LEAD_CAUSAL = /^(?:because|since|as\s+the|as\s+we|as\s+it|for\s+the\s+reason|seeing\s+that|given\s+that|inasmuch)\b/i;
const LEAD_PURPOSE = /^(?:so\s+that\b|so\s+as\s+to\b|in\s+order\s+to\b|so\s+(?:the|that|people|viewers?|nobody|no\s+one|they)\b|to\s+(?:increase|boost|inflate|lift|raise|drive|maximi[sz]e|keep|hold|stop|prevent|pad|make|get|have|compel|force|ensure|guarantee))/i;
const LEAD_COORD = /^(?:and|or|then|plus|also|additionally|moreover|furthermore)\b/i;

function classifyLead(norm: string): Connective {
  if (LEAD_CONDITIONAL.test(norm)) return "CONDITIONAL";
  if (LEAD_CONCESSIVE.test(norm)) return "CONCESSIVE";
  if (LEAD_CONTRAST.test(norm)) return "CONTRAST";
  if (LEAD_CAUSAL.test(norm)) return "CAUSAL";
  if (LEAD_PURPOSE.test(norm)) return "PURPOSE";
  if (LEAD_COORD.test(norm)) return "COORD";
  return "NONE";
}

export function segmentSemClauses(text: string): SemClause[] {
  const whole = normalizeSemanticText(text);
  return whole
    .split(SEM_SPLIT)
    .map((piece) => (piece ?? "").trim())
    .filter((piece) => piece.length > 0)
    .map((norm) => ({ raw: norm, norm, lead: classifyLead(norm) }));
}

// --------------------------------------------------------------------------
// Negation parity + guard scope
// --------------------------------------------------------------------------

// Constructions that read as negations token-by-token but AFFIRM the action.
const NEG_FALSE = /\bnot only\b|\b(?:wrong|a\s+mistake|mistaken|bad|foolish|unwise|remiss|negligent|careless|silly|counterproductive)\s+not\s+to\b/gi;
// A negation cue toggles polarity. "refrain from" / "fail to" / "neglect to" /
// "skip" / "omit to" are themselves negations, so "do not fail to X" /
// "never skip X" is an even count that still affirms X.
const NEG_CUE = /\b(?:without|avoids?|avoiding|avoided|not|never|no longer|rather than|instead of|does not|do not|is not|are not|was not|were not|will not|would not|can not|cannot|must not|should not|shall not|so as not to|prevents?|preventing|prevented|refus(?:e|es|ing|ed)\s+to|refrain(?:s|ing|ed)?\s+from|fail(?:s|ing|ed)?\s+to|neglect(?:s|ing|ed)?\s+to|omit(?:s|ting|ted)?\s+to|hesitat\w+\s+to|shy\s+away\s+from|skip(?:s|ping|ped)?|forgo(?:es|ing)?|forego(?:es|ing)?|leaves?\s+out|stop(?:s|ping)?\s+short\s+of|discourage(?:s|d|ing)?)\b/gi;
// A negation only governs the predicate it is adjacent to: the look-back is cut
// at the last comma or contrastive coordinator before the action. "instead (of)"
// is deliberately NOT a cut point -- it is itself a negation cue ("fix it fairly
// instead of manufacturing conflict").
const NEG_SCOPE_CUT = /,|\b(?:but|yet|however|nonetheless|nevertheless|though|although|whereas)\b/gi;

/** True when the action at `actionIndex` in `clauseNorm` is NOT negated (even cue count). */
export function actionAffirmed(clauseNorm: string, actionIndex: number): boolean {
  let before = clauseNorm.slice(0, Math.max(0, actionIndex)).replace(NEG_FALSE, " ");
  NEG_SCOPE_CUT.lastIndex = 0;
  let cut = 0;
  let m: RegExpExecArray | null;
  while ((m = NEG_SCOPE_CUT.exec(before)) !== null) {
    cut = m.index + m[0].length;
    if (m.index === NEG_SCOPE_CUT.lastIndex) NEG_SCOPE_CUT.lastIndex++;
  }
  before = before.slice(cut);
  const negations = before.match(NEG_CUE)?.length ?? 0;
  return negations % 2 === 0;
}

// --------------------------------------------------------------------------
// Semantic features
// --------------------------------------------------------------------------

// PURPOSE: keeping viewers watching / lifting retention-family metrics /
// prolonging the session / suppressing early exits. Expressed as retention,
// completion, audience hold, session duration, watch time, "the whole video",
// etc. -- and inflection/nominalisation tolerant.
export const RETENTION_PURPOSE =
  /\b(?:watch\s?time|watch\s+hours?|view(?:ing)?\s+(?:time|minutes|duration|hours?)|minutes?\s+(?:watched|viewed|of\s+view\w*)|average\s+view\s+duration|\bavd\b|session\s+(?:duration|length|time)|time\s+(?:on|in|with)\s+(?:the\s+)?(?:video|page|content|session)|dwell\s+time|time\s+watched|retention(?:\s+(?:rate|curve|metric))?|audience\s+retention|completion(?:\s+rate)?|complet\w*\s+(?:the\s+)?(?:video|whole|entire)|finish(?:es|ing|ed)?\s+(?:rate|the\s+video|the\s+whole|watching)|unfinished\s+view\w*|percentage\s+(?:viewed|watched)|percent\s+(?:viewed|watched)|stick\w*\s+(?:around|with\s+it)|stickiness)\b/i;
const RETENTION_METRIC =
  "watch\\s?time|view\\w*\\s+(?:time|minutes|duration)|minutes?\\s+(?:watched|viewed)|retention|session\\s+(?:duration|length|time)|time[- ]in[- ]session|dwell\\s+time|completion(?:\\s+rate)?|average\\s+view\\s+duration|\\bavd\\b|time\\s+(?:on|in)\\s+(?:the\\s+)?(?:video|page|session)";
const RETENTION_PURPOSE_COMPOSED = new RegExp(
  "\\b(?:increase|increases?|increasing|boost\\w*|inflat\\w*|rais\\w*|drive\\w*\\s+up|driving\\s+up|grow\\w*|maximi[sz]\\w*|lift\\w*|pump\\w*\\s+up|improv\\w*|extend\\w*|pad\\w*|bump\\w*|push\\w*\\s+up|build\\w*|rack\\w*\\s+up|juic\\w*|edg\\w*\\s+(?:up|higher)|nudg\\w*\\s+up|prop\\w*\\s+up|shore\\w*\\s+up|hold\\w*\\s+(?:up|steady|firm)|keep\\w*\\s+\\w*\\s*(?:up|high|from\\s+dropping))\\b[^.;:!?]{0,50}?\\b(?:" + RETENTION_METRIC + ")\\b" +
  "|\\bkeep\\w*\\s+(?:the\\s+)?(?:" + RETENTION_METRIC + ")\\s+(?:up|high|steady|from\\s+(?:drop\\w*|slid\\w*|slipp\\w*|fall\\w*|sag\\w*|dip\\w*|declin\\w*|sink\\w*|sliding))" +
  "|\\b(?:" + RETENTION_METRIC + ")\\b[^.;:!?]{0,30}?\\b(?:up\\b|rise\\w*|climb\\w*|higher|increase\\w*|grow\\w*|improv\\w*|jump\\w*|edg\\w*\\s+(?:up|higher)|go(?:es|ing)?\\s+up|balloon\\w*|creep\\w*\\s+up|hold\\w*(?:\\s+(?:up|steady|firm))?|stay\\w*\\s+(?:up|high|flat)|does\\s+not\\s+drop|is\\s+maintained|keeps?\\s+up)\\b",
  "i",
);
const KEEP_WATCHING_PURPOSE =
  /\b(?:so|to)\s+(?:that\s+)?(?:people|viewers?|users?|they|the\s+audience|nobody|no\s+one|everyone|folks)\s+(?:keep\w*\s+watching|stay\w*|remain\w*|watch\w*\s+(?:longer|more|on|the\s+whole|the\s+entire|it\s+to\s+the\s+end|until\s+the\s+end)|do\s+not\s+leave|don\s+not\s+leave|hang\s+(?:on|around)|linger\w*|stick\s+(?:around|with\s+it)|finish\w*\s+(?:the\s+)?(?:video|whole|entire|it|watching)|see\s+the\s+(?:whole|entire|full))\b/i;
const HOLD_ATTENTION_PURPOSE =
  /\b(?:keep\w*|hold\w*|retain\w*|sustain\w*|maintain\w*|preserv\w*)\s+(?:on\s+to\s+|onto\s+)?(?:the\s+)?(?:viewers?|audience|people|them|user\w*)\s*(?:['’]s)?\s*(?:attention|engaged|watching|hooked|glued|around|from\s+leaving|in\s+their\s+seats?|on\s+the\s+(?:video|page))\b|\bhold\w*\s+(?:on\s+to\s+|onto\s+)?(?:the\s+)?attention\b|\bhold\w*\s+(?:on\s+to\s+|onto\s+)?(?:the\s+)?(?:viewer\w*|audience|people|them)\b/i;
const SUPPRESS_EXIT_PURPOSE =
  /\b(?:stop\w*|prevent\w*|reduc\w*|cut\w*|curb\w*|minimi[sz]\w*|kill\w*|lower\w*|suppress\w*|trim\w*|shrink\w*|shave\w*|stem\w*|stanch\w*|arrest\w*|keep\w*\s+(?:people|viewers?|them|the\s+audience|anyone)\s+from)\s+(?:the\s+)?(?:early\s+)?(?:drop[- ]?off\w*|drop[- ]?out\w*|bounce\w*|bounce\s+rate|early\s+exit\w*|abandon\w*|viewers?\s+leaving|people\s+leaving|churn|tune[- ]?out\w*|click[- ]?(?:away|off))\b|\bso\s+(?:that\s+)?(?:nobody|no\s+one|not\s+a\s+single\s+(?:viewer|person)|people|viewers?|they)\s+(?:leave\w*|bail\w*|drop\w*\s+off|click\w*\s+(?:away|off)|bounce\w*|tune\w*\s+out|abandon\w*)\b|\b(?:nobody|no\s+one)\s+(?:leave\w*|bail\w*|drop\w*\s+off|click\w*\s+(?:away|off))\s*(?:early|before|until|halfway|part\s?way)?\b|\bcontinued\s+view\w*\b|\bprolong\w*\s+(?:the\s+)?(?:session|view\w*|watch\w*|visit|engagement)\b/i;
const AUDIENCE_STAYS_PURPOSE =
  /\b(?:audience|viewers?|people|users?|they|nobody|no\s+one|everyone|folks|the\s+crowd)\b[^.;:!?]{0,45}?\b(?:stay\w*\s+(?:longer|watching|on\b|put|glued|with\s+it|around|to\s+the\s+end|until\s+the\s+end|to\s+the\s+finish|through(?:out)?)|watch\w*\s+(?:longer|for\s+longer|to\s+the\s+end|the\s+whole|the\s+entire)|keep\w*\s+(?:on\s+)?watching|keep\w*\s+(?:people|viewers?|them|the\s+audience|us|everyone)\s+watching|remain\w*\s+(?:longer|watching|on\s+the\s+(?:video|page))|linger\w*|spend\w*\s+(?:longer|more\s+time)|stick\w*\s+(?:around|with\s+it)|do\s+not\s+leave|leave\w*\s+early|finish\w*\s+(?:the\s+video|it|watching)|do\s+not\s+click\s+off)\b/i;
const LONGER_RUN_PURPOSE =
  /\bso\s+(?:that\s+)?(?:the\s+)?(?:video|clip|episode|piece|runtime|run\s?time|it|segment|middle)\s+(?:is|runs?|lasts?|goes?\s+on|becomes?)\s+longer\b|\b(?:the\s+)?(?:clip|video|episode|piece|runtime|it|segment)\s+(?:lasts?|runs?|goes?\s+on)\s+(?:for\s+)?longer\b/i;

/** Any retention / keep-watching / hold-attention / session-prolonging purpose. */
export function retentionPurposePresent(text: string): boolean {
  const norm = normalizeSemanticText(text);
  return (
    RETENTION_PURPOSE_COMPOSED.test(norm) ||
    KEEP_WATCHING_PURPOSE.test(norm) ||
    HOLD_ATTENTION_PURPOSE.test(norm) ||
    SUPPRESS_EXIT_PURPOSE.test(norm) ||
    AUDIENCE_STAYS_PURPOSE.test(norm) ||
    LONGER_RUN_PURPOSE.test(norm) ||
    (RETENTION_PURPOSE.test(norm) &&
      /\b(?:rise\w*|ris\w*|climb\w*|increase\w*|grow\w*|improv\w*|jump\w*|go(?:es|ing)?\s+up|going\s+up|higher|lift\w*|boost\w*|maximi[sz]\w*|benefit\w*|gain\w*|for\s+(?:more\s+)?retention|for\s+watch)\b/i.test(norm))
  );
}

// MECHANISM: harmful prolonging -- inflection/voice/nominalisation tolerant.
// Concept presence is tested separately from the object; passive ("the runtime
// is padded"), nominal ("artificial extension of the runtime") and active
// ("pad the runtime") all surface the same feature.
const PROLONG_CONCEPT =
  /\b(?:pad(?:s|ded|ding)?|padd\w+|lengthen\w*|elongat\w*|prolong\w*|bloat\w*|balloon\w*|fatten\w*|over[- ]?long|overrun\w*|distend\w*)\b|\b(?:stretch\w*|extend\w*|expand\w*|inflat\w*|drag\w*|draw\w*|spin\w*|string\w*|elongat\w*)\b[^.;:!?]{0,30}?\b(?:runtime|run\s?time|video|episode|length|duration|footage|content|cut|middle|mid-?section|mid-?roll|section|segment|intro|introduction|opening|explanation\w*|recap\w*|answer\w*|it|this|out)\b|\b(?:the\s+)?(?:runtime|run\s?time|video|episode|length|duration|cut|footage|content|middle|mid-?section|mid-?roll|section|segment|explanation\w*|answer\w*|recap\w*)\b[^.;:!?]{0,25}?\b(?:is|are|was|were|be|been|being|get\w*)\s+(?:\w+ly\s+)?(?:made\s+to\s+(?:run|last|go)\s+(?:\w+ly\s+)?longer|padded|padd\w+|stretched|lengthened|elongated|prolonged|bloated|ballooned|fattened|dragged\s+out|drawn\s+out|extended|expanded|distended)\b|\b(?:artificial\w*|deliberate\w*|needless\w*|unnecessar\w*|gratuitous\w*)\s+(?:extension|lengthening|elongation|prolongation|padding|inflation|expansion)\b|\b(?:extension|lengthening|elongation|prolongation|padding|inflation)\s+of\s+(?:the\s+)?(?:runtime|run\s?time|video|episode|viewing|session|content|middle|explanation|every\s+segment)\b|\b(?:make\w*|makes?|making|made)\b[^.;:!?]{0,35}?\b(?:run|runs|running|be|last|lasts|go|goes)\s+(?:\w+ly\s+)?longer\b|\b(?:run\w*|last\w*|goes?\s+on)\s+(?:\w+ly\s+)?longer\b/i;
const REDUNDANCY_CONCEPT =
  /\b(?:repeat\w*|re-?state\w*|reiterat\w*|recap\w*|rehash\w*|re-?hash\w*|echo\w*|duplicat\w*|re-?tread\w*|re-?litigat\w*|re-?run\w*|re-?cover\w*|circl\w*|loop\w*|revisit\w*|labour\s+again|say\w*\s+(?:it|the\s+same\s+thing)\s+again)\b[^.;:!?]{0,45}?\b(?:point\w*|section\w*|segment\w*|material|content|ground|step\w*|thesis|claim\w*|idea\w*|lesson\w*|summary|summaries|explanation\w*|information|argument\w*|again|twice|repeatedly|over\s+and\s+over|a\s+second\s+time|two\s+more\s+times|before\s+the\s+reveal)\b|\bthe\s+same\s+(?:[-\w]+\s+){0,3}?(?:point\w*|idea\w*|material|ground|thesis|claim\w*|step\w*|argument\w*|thing\w*|content)\b[^.;:!?]{0,25}?\b(?:again|twice|two\s+more\s+times|a\s+second\s+time|repeatedly|over\s+and\s+over|more\s+than\s+once)\b|\b(?:another|a\s+second|an?\s+extra|a\s+duplicate|a\s+repeat|an?\s+additional|one\s+more|yet\s+another)\s+(?:[-\w]+\s+){0,2}?(?:walk-?through|run-?through|pass|recap|summary|overview|rundown|go-?over|explanation|lap|round)\b|\b(?:redundant|repetitive|duplicate|needless|pointless|filler|padding|throwaway|superfluous|gratuitous|unnecessary|extraneous|low[- ]value|no[- ]value|time[- ]wasting|extra)\s+(?:[-\w]+\s+){0,2}?(?:material|content|segment\w*|section\w*|recap\w*|summ\w+|restatement\w*|re-?explanation\w*|footage|clip\w*|filler|padding|tangent\w*|aside\w*|repetition\w*|preamble|throat[- ]clearing)\b|\b(?:go(?:es|ing)?|circl\w*|loop\w*|come\w*|return\w*|run\w*)\s+(?:back\s+)?(?:over|to|through)\b[^.;:!?]{0,35}?\b(?:again|twice|a\s+second\s+time|repeatedly|over\s+and\s+over|each\s+(?:section|segment|chapter|point))\b/i;
const RAMBLE_CONCEPT =
  /\b(?:rambl\w+|meander\w*|waffl\w+|digress\w*|drone\s+on|drones\s+on|witter\w*|blather\w*|prattl\w*|ad[- ]?lib\w*)\b|\bgo(?:es|ing)?\s+(?:off\s+)?on\s+(?:a\s+|multiple\s+|lengthy\s+|long\s+|endless\s+|extended\s+|several\s+)?tangent\w*\b|\b(?:lengthy|long|endless|extended|needless|pointless|unrelated)\s+(?:tangent\w*|aside\w*|digression\w*)\b|\bwander\w*\s+off\b|\b(?:let\w*|allow\w*|have\w*)\s+(?:the\s+)?(?:host|presenter|narrator|speaker|guest|voice[- ]?over)\s+(?:ramble\w*|meander\w*|wander\w*|go\s+off|drone\s+on|waffle\w*|digress\w*)\b/i;
const SLOW_CONCEPT =
  /\b(?:slow[- ]?walk\w*|belabou?r\w*|labou?r\s+the\s+point|drag\s+(?:one['’]s|your|their|his|her)\s+feet|dawdl\w*|dwell\w*\s+(?:needlessly|too\s+long|at\s+length|endlessly))\b|\bstall\w*\s+(?:the\s+)?(?:viewer\w*|video|reveal|payoff|answer|conclusion)\b|\bslow\w*\s+(?:the\s+)?(?:pac\w*|tempo|delivery|video|segment\w*|reveal|read)\b[^.;:!?]{0,15}?\b(?:down|right\s+down|way\s+down|so|to\b|for\b)|\b(?:draw|drag|spin)\s+out\s+(?:the\s+)?(?:pac\w*|delivery)\b/i;

const PROLONG_CONCEPTS: Array<[RegExp, string]> = [
  [PROLONG_CONCEPT, "prolong"],
  [REDUNDANCY_CONCEPT, "redundancy"],
  [RAMBLE_CONCEPT, "ramble"],
  [SLOW_CONCEPT, "slow"],
];

// MECHANISM: withholding the promised value. Signal + value-noun + position/purpose.
const WITHHOLD_SIGNAL =
  /\b(?:withhold\w*|withheld|(?:hold\w*|held)\s+(?:it\s+|them\s+|the\s+\w+\s+)?(?:back|off|on\s+to)|(?:hold\w*|held)\s+[^.;:!?]{0,25}?\bback\b|hang\w*\s+on\s+to|hung\s+on\s+to|cling\w*\s+to|clung\s+to|clutch\w*|hoard\w*|(?:keep\w*|kept)\s+[^.;:!?]{0,25}?\b(?:back|in\s+reserve|under\s+wraps|out\s+of\s+sight|in\s+(?:the|your|our|its)\s+back\s+pocket|to\s+one\s+side|aside|on\s+ice)|sit\w*\s+(?:tight\s+)?on|sat\s+on|reserv\w+|sav\w+\s+(?:the|it|for)|shelv\w*|mothball\w*|delay\w*|postpon\w+|defer\w*|deferr\w*|deferral|push\w*\s+back|pushed\s+back|put\w*\s+off|hold\w*\s+off|held\s+off|bury|buries|burying|buried|hid\w+|hidden|conceal\w*|stash\w*|park\w+\s+(?:the|it)|tuck\w*\s+away|(?:wrap\w*|nest\w*|sandwich\w*|embed\w*|couch\w*|encas\w*|bury\w*)\s+(?:up\s+)?(?:the\s+)?(?:[-\w]+\s+){0,4}?(?:in|inside|within|among|between|deep\s+in)\b|ration(?:s|ed|ing)?\s+(?:out\s+)?(?:the|its|our|each)\b|(?:dole|parcel|mete|drip-?feed|trickle|eke)\w*(?:\s+(?:it|them|the\s+\w+))?\s+out|(?:dole|parcel|meter|mete|drip|drip-?feed|trickle|eke|sprinkle|spread|space)\w*\s+(?:it\s+|them\s+|the\s+\w+\s+|out\s+)?(?:across|over|through(?:out)?|toward\w*|along)|time\w*\s+(?:the\s+)?(?:reveal|answer|payoff|verdict|conclusion|drop|diagnosis)\s+(?:for|to|at)|wait\w*\s+(?:un)?til\s+(?:the\s+)?(?:end|last|final|close|finale)\s+to\s+(?:reveal|share|give|deliver|show))\b/i;
const VALUE_NOUN =
  /\b(?:answer\w*|payoff\w*|pay[- ]off|reveal\w*|result\w*|conclusion\w*|outcome\w*|takeaway\w*|take[- ]away|lede|lead|resolution\w*|explanation\w*|lesson\w*|guidance|advice|tip\w*|insight\w*|instruction\w*|solution\w*|recommendation\w*|verdict\w*|diagnos\w*|assessment\w*|fix\w*|remedy|correction\w*|the\s+useful\s+(?:bit|part|stuff)|main\s+point|key\s+(?:point|takeaway|lesson|insight)|actionable\s+(?:step\w*|item\w*|advice|takeaway)|practical\s+(?:step\w*|advice|guidance|answer)|concrete\s+(?:step\w*|recommendation\w*|advice)|the\s+(?:real|actual|useful|concrete|promised|core)\s+(?:answer|point|info\w*|part|recommendation\w*|guidance|value))\b/i;
const END_POSITION =
  /\b(?:un)?til\s+(?:the\s+)?(?:very\s+)?(?:end|finish|close|closing|wrap-?up|conclusion|coda|finale|outro|sign-?off|last\s+(?:minute|section|segment|third|part|chapter))\b|\b(?:at|near|toward\w*|into|in)\s+(?:the\s+)?(?:very\s+)?(?:end|finish|close|closing|conclusion|finale|outro|wrap-?up|back\s+half|last\s+(?:third|section|segment|part|minute\w*))\b|\b(?:last|final|closing|very\s+last|dying|home)\s+(?:minute\w*|section|segment|third|seconds?|moment\w*|stretch|part|chapter|breath|act)\b|\bright\s+at\s+the\s+end\b|\bin\s+the\s+(?:final|closing|home)\s+(?:stretch|minutes?|section|segment)\b|\bacross\s+the\s+back\s+half\b|\bfor\s+the\s+(?:end|finale|close|last)\b|\bat\s+the\s+(?:very\s+)?finish\b/i;
// "at the top" is deliberately NOT here -- it is ambiguous ("at the top of each
// act" is a repetition location, not a front-load). Only unambiguous
// front-loading language.
const FRONT_POSITION =
  /\b(?:up\s+front|front[- ]?load\w*|lead\w*\s+with|at\s+the\s+(?:very\s+)?(?:start|beginning|outset)|at\s+the\s+top\s+of\s+(?:the\s+)?(?:video|clip|piece|episode|opening)|from\s+the\s+(?:outset|start|get[- ]?go)|early\s+on|right\s+away|straight\s+away|immediately|in\s+the\s+(?:first|opening)\s+(?:minute|seconds?|line|moments?)|to\s+the\s+very\s+opening|sooner|faster|earlier|first\s+thing|to\s+the\s+point|get\w*\s+to\s+(?:the\s+)?(?:point|answer|recommendation|payoff|tip)\s+(?:fast|quick\w*|early|first))\b/i;

// MECHANISM: manufactured conflict / outrage. Causative + conflict noun, or a
// framing/assignment that casts a minor thing as a scandal, or provoking anger.
const CONFLICT_NOUN =
  "controvers\\w+|scandal\\w*|drama|outrage\\w*|conflict\\w*|feud\\w*|rivalr(?:y|ies)|backlash|uproar|furor\\w*|furore|firestorm|spat\\w*|quarrel\\w*|beef|dust[- ]?up\\w*|kerfuffle|flame\\s?war\\w*|shouting\\s+match|pile[- ]?on\\w*|war\\s+of\\s+words|hit\\s?piece\\w*|slanging\\s+match";
const CONFLICT_MANUFACTURE = new RegExp(
  "\\b(?:manufactur\\w*|fabricat\\w*|invent\\w*|gin\\w*\\s+up|ginn\\w+|drum\\w*\\s+up|whip\\w*\\s+up|stir\\w*(?:\\s+up)?|stag\\w*|staged|concoct\\w*|cook\\w*\\s+up|creat\\w*|start\\w*|spark\\w*|generat\\w*|engineer\\w*|orchestrat\\w*|foster\\w*|brew\\w*|sow\\w*|kick\\w*\\s+off|set\\w*\\s+up|provok\\w*|incit\\w*|foment\\w*|hyp\\w*\\s+up|ignit\\w*|kindl\\w*|escalat\\w*)\\s+(?:a\\s+|an\\s+|the\\s+|some\\s+|into\\s+a\\s+)?(?:[-\\w]+\\s+){0,3}?(?:" + CONFLICT_NOUN + ")\\b" +
  "|\\b(?:deliberate\\w*|manufactured|engineered|intentional\\w*|needless\\w*|cynical\\w*|artificial\\w*)\\s+escalation\\s+of\\b" +
  "|\\bescalat\\w*\\s+(?:a\\s+|the\\s+)?(?:[-\\w]+\\s+){0,2}?(?:dispute\\w*|feud\\w*|conflict\\w*|disagreement\\w*|row|argument\\w*|quarrel\\w*)\\b" +
  "|\\b(?:overstat\\w*|exaggerat\\w*|blow\\w*\\s+up|blew\\s+up|blown\\s+up|blow\\w*|inflat\\w*|hyp\\w*|dramati[sz]\\w*|sensationali[sz]\\w*|overhyp\\w*|spin\\w*|play\\w*\\s+up|turn\\w*|make\\w*|talk\\w*\\s+up|puff\\w*\\s+up|whip\\w*\\s+up)\\s+(?:a\\s+|an\\s+|the\\s+|some\\s+|this\\s+)?(?:[-\\w]+\\s+){0,3}?(?:dispute\\w*|disagreement\\w*|difference\\w*|spat\\w*|quarrel\\w*|quibble\\w*|nitpick\\w*|issue\\w*|matter\\w*|point\\w*|remark\\w*|comment\\w*|wording|caption\\w*|typo\\w*|correction\\w*|fix|edit\\w*|tweak\\w*|note\\w*|change\\w*|amendment\\w*|revision\\w*|update\\w*|detail\\w*|slight\\w*|story)\\b[^.;:!?]{0,60}?\\b(?:as|into|out\\s+of\\s+(?:all\\s+)?proportion)\\b[^.;:!?]{0,25}?\\b(?:a\\s+|an\\s+)?(?:[-\\w]+\\s+){0,3}?(?:full-?blown\\s+\\w+|drama|scandal\\w*|controvers\\w+|outrage\\w*|crisis|war|feud\\w*|firestorm|catastrophe|disaster|betrayal\\w*|bombshell|explosion|meltdown|travesty)\\b" +
  "|\\b(?:frame\\w*|framed|cast\\w*|paint\\w*|portray\\w*|depict\\w*|dress\\w*|brand\\w*|label\\w*|spin\\w*|present\\w*|bill\\w*|pitch\\w*|sell\\w*|play\\w*)\\b[^.;:!?]{0,65}?\\bas\\s+(?:a\\s+|an\\s+)?(?:[-\\w]+\\s+){0,4}?(?:scandal\\w*|controvers\\w+|betrayal\\w*|outrage\\w*|outrageous\\s+\\w+|crisis|disaster|drama|war|firestorm|bombshell|catastrophe|travesty|meltdown)\\b" +
  "|\\b(?:assign\\w*|cast\\w*|appoint\\w*|designat\\w*|name\\w*|anoint\\w*|pick\\w*|make\\w*|set\\s+up)\\s+(?:a\\s+|an\\s+|one\\s+|some\\s+|someone\\s+)?(?:[-\\w]+\\s+){0,3}?(?:as\\s+(?:the\\s+|a\\s+|our\\s+)?)?(?:villain\\w*|bad\\s+guy|enemy|enemies|scapegoat\\w*|antagonist\\w*|hate\\s+figure|hate[- ]figure|punching\\s+bag|target\\s+for\\s+(?:the\\s+)?(?:pile[- ]?on|anger|outrage))\\b" +
  "|\\b(?:make\\w*|get\\w*|have\\w*|drive\\w*|goad\\w*|egg\\w*|set\\w*|put\\w*|bait\\w*)\\s+(?:the\\s+)?(?:viewer\\w*|people|users?|the\\s+audience|reader\\w*|commenter\\w*|comment\\s+section|two\\s+[-\\w]+|them|everyone)\\s+(?:to\\s+)?(?:fight\\w*|argu\\w*|bicker\\w*|attack\\s+(?:each\\s+other|one\\s+another)|pile\\s+on|rag\\w*|clash\\w*|turn\\s+on\\s+each\\s+other|at\\s+(?:each\\s+other|one\\s+another['’]s\\s+throats))\\b" +
  "|\\bpit\\w*\\s+(?:[-\\w]+\\s+){0,4}?(?:commenter\\w*|viewer\\w*|fan\\w*|people|guest\\w*|expert\\w*|two\\s+[-\\w]+|side\\w*|camp\\w*|faction\\w*)\\s+against\\s+(?:each\\s+other|one\\s+another|another)\\b" +
  "|\\b(?:keep\\w*|fuel\\w*|stok\\w*|sustain\\w*|prolong\\w*|feed\\w*|inflam\\w*)\\s+(?:a\\s+|the\\s+)?(?:comment[- ]?section|comment|flame|comments?)\\s+(?:war|brawl|fight|slugfest|scrap|dust-?up|meltdown|feud)\\b" +
  "|\\b(?:comment[- ]?section|comment|flame)\\s+war\\b" +
  "|\\b(?:provok\\w*|incit\\w*|inflam\\w*|foment\\w*|stok\\w*|farm\\w*|drum\\w*\\s+up|stir\\w*\\s+up|whip\\w*\\s+up|manufactur\\w*|generat\\w*)\\s+(?:reader\\s+|viewer\\s+|audience\\s+|user\\s+|hostile\\s+|angry\\s+|more\\s+)?(?:anger|outrage\\w*|indignation|rage|hostility|resentment|hate|fury|hostile\\s+comment\\w*|angry\\s+(?:comment\\w*|repl\\w*))\\b" +
  "|\\b(?:deliberately|intentionally|purposely|artificially|needlessly|cynically|knowingly)\\s+polari[sz]\\w*\\b" +
  "|\\binflammator\\w*\\s+(?:framing|hook\\w*|title\\w*|thumbnail\\w*|angle\\w*|claim\\w*|language|headline\\w*)\\b[^.;:!?]{0,45}?\\b(?:comment\\w*|engagement|repl\\w*|reaction\\w*|clicks?)\\b" +
  "|\\b(?:incendiary|divisive|polari[sz]ing)\\s+(?:framing|hook\\w*|angle\\w*|take\\w*|thumbnail\\w*)\\b",
  "i",
);
const BAIT_SWITCH = /\bbait[ -]and[ -]switch\w*\b|\bpromis\w+\s+one\s+thing\b[^.;:!?]{0,40}?\bdeliver\w*\s+another\b|\bswitch\w*\s+(?:the\s+)?(?:topic|subject|content)\b[^.;:!?]{0,40}?\bafter\s+the\s+click\b/i;

// MECHANISM: deceptive scarcity / urgency (a claim of scarcity/expiry) and the
// truth that contradicts it (supply unlimited / access stays open / no real
// deadline). Composed across clauses -- claim in one sentence, admission in
// another -- and independent of any particular noun or time phrase.
const SMALL_QTY = "few|handful|couple|dozen|\\d+|one|two|three|four|five|six|seven|eight|nine|ten";
export const SCARCITY_CLAIM = new RegExp(
  "\\b(?:almost\\s+gone|nearly\\s+(?:gone|sold\\s+out|out|exhausted|depleted)|running\\s+(?:low|out)|about\\s+to\\s+(?:run\\s+out|sell\\s+out|close|end|expire|disappear|vanish)" +
  "|only\\s+(?:a\\s+)?(?:" + SMALL_QTY + ")\\s+(?:[-\\w]+\\s+){0,2}?(?:left|remain\\w*|spot\\w*|seat\\w*|cop(?:y|ies)|slot\\w*|unit\\w*|place\\w*|kit\\w*|licen[cs]e\\w*|ticket\\w*)" +
  "|(?:just|merely|barely|under|fewer\\s+than|less\\s+than|no\\s+more\\s+than)\\s+(?:" + SMALL_QTY + ")\\s+(?:[-\\w]+\\s+){0,2}?(?:left|remain\\w*|available|in\\s+stock|spot\\w*|seat\\w*|cop(?:y|ies)|slot\\w*|unit\\w*|kit\\w*|place\\w*|licen[cs]e\\w*)" +
  "|limited\\s+(?:spot\\w*|seat\\w*|cop(?:y|ies)|stock|supply|quantit\\w+|availability|slot\\w*|unit\\w*|number|place\\w*|licen[cs]e\\w*|time)" +
  "|last\\s+chance|final\\s+chance|selling\\s+(?:out|fast)|sell\\w*\\s+out\\s+(?:soon|fast|tonight|today|tomorrow|by|before)" +
  "|(?:seat\\w*|spot\\w*|slot\\w*|cop(?:y|ies)|ticket\\w*|place\\w*)\\s+(?:are\\s+)?(?:selling|going)\\s+(?:out\\s+)?fast" +
  "|stock\\s+(?:is\\s+)?(?:low|almost\\s+gone|nearly\\s+gone|running\\s+out)" +
  "|suppl(?:y|ies)\\s+(?:are\\s+|is\\s+)?(?:low|limited|dwindling|running\\s+out|nearly\\s+(?:exhausted|gone|out|depleted))" +
  "|(?:access|door\\w*|gate\\w*|cart\\w*|the\\s+(?:offer|deal|price|discount|bonus|course|link|video|content|workshop|webinar|class|session|cohort|programme?|sale|store|shop|window|batch|intake|cart|door\\w*|download)|it|enrol?ment|registration|sign-?ups?)\\s+(?:vanish\\w*|disappear\\w*|go(?:es)?\\s+away|going\\s+away|expir\\w*|end\\w*|clos\\w*|shut\\w*|goes?\\s+dark|drop\\w*|die\\w*|dying|lapse\\w*|is\\s+gone|(?:is\\s+|will\\s+be\\s+|about\\s+to\\s+be\\s+)?(?:pulled|taken\\s+down|removed|deleted|yanked|retired|withdrawn))\\b[^.;:!?]{0,35}?\\b(?:today|tomorrow|tonight|soon|at\\s+midnight|at\\s+noon|this\\s+week|by\\s+\\w+|in\\s+\\w+\\s+(?:hour\\w*|day\\w*|minute\\w*))" +
  "|(?:doors?|the\\s+cart|the\\s+gate\\w*|sign-?ups?)\\s+clos\\w*\\s+(?:at\\s+midnight|tonight|today|tomorrow|soon|at\\s+\\w+)" +
  "|\\b(?:link|download|file|offer|deal|page|video|bonus|freebie|resource)\\s+(?:is|will\\s+be|is\\s+going\\s+to\\s+be)\\s+(?:about\\s+to\\s+be\\s+)?(?:pulled|taken\\s+down|removed|deleted|yanked|gone|retired)" +
  "|countdown(?:\\s+(?:timer|clock))?\\b[^.;:!?]{0,40}?\\b(?:hits?\\s+zero|runs?\\s+out|expir\\w*|ends?)" +
  ")",
  "i",
);
export const AVAILABILITY_TRUTH =
  /\b(?:even\s+though|although|though|but|while\s+(?:it|in\s+fact|really)|when\s+(?:in\s+fact|really|actually|it|we|you|the\s+team)|despite|in\s+(?:fact|reality|truth)|actually|really|in\s+practice)\b[^.;:!?]{0,110}?\b(?:remain\w*\s+(?:fully\s+)?available|stay\w*\s+(?:fully\s+)?available|stay\w*\s+(?:up|live|online|posted|active|open)|still\s+(?:be\s+)?(?:available|around|for\s+sale|on\s+sale|open|accessible|there|up|live)|will\s+(?:still\s+|in\s+fact\s+)?(?:remain|stay|be)\s+(?:there|available|around|accessible|for\s+sale|open|up|live)|(?:supply|stock|quantit\w+|availability|inventory|seating|seats|capacity|room|space\w*|place\w*)\s+(?:is|are|remain\w*|stay\w*)\s+(?:effectively\s+|essentially\s+|basically\s+|virtually\s+|practically\s+)?(?:unlimited|ample|plentiful|not\s+limited|fine|healthy|endless|abundant|uncapped)|plenty\s+(?:left|available|in\s+stock|to\s+go\s+around|remain\w*|of\s+(?:room|space|seats|copies))|(?:effectively|essentially|basically|virtually|practically)\s+unlimited|unlimited\s+(?:supply|stock|availability|cop(?:y|ies)|seat\w*|spot\w*|seating)|no\s+(?:real\s+|actual\s+|hard\s+)?(?:deadline|limit|shortage|scarcity|cap|cut[- ]?off|end\s+date)|not\s+(?:actually\s+|really\s+)?(?:going\s+away|limited|scarce|running\s+out|ending|disappearing|expiring)|is\s+not\s+(?:ending|going\s+away|limited|expiring)|never\s+(?:closes?|ends?|expires?|sells?\s+out|runs?\s+out|goes?\s+away)|(?:can|could)\s+(?:print|make|produce|offer|add|supply|generate|create|issue|mint|spin\s+up|ship|deliver|fulfil?l?|send|churn\s+out)\s+(?:unlimited|as\s+many|endless|any\s+number\s+of|as\s+many\s+as\s+(?:ordered|needed|wanted|requested|asked\s+for)|more\s+(?:on\s+demand|as\s+needed))|(?:key\w*|cop(?:y|ies)|seat\w*|licen[cs]e\w*|slot\w*|kit\w*|unit\w*)\s+on\s+demand|(?:sign-?ups?|enrol?ment|registration|intake|the\s+(?:workshop|webinar|class|cohort|course|programme?|sale|store|door|cart))\s+(?:actually\s+)?(?:run\w*|stay\w*|remain\w*|is|are)\s+(?:open\s+)?(?:year-?round|all\s+year|continuous(?:ly)?|on\s+a\s+rolling\s+basis|always|perpetually|ongoing))\b/i;
const AVAILABILITY_TRUTH_LOOSE =
  /\b(?:supply|stock|inventory|availability|seating|seats|capacity)\s+(?:is|are|remain\w*|stay\w*)\s+(?:effectively\s+|essentially\s+|basically\s+|virtually\s+|practically\s+)?(?:unlimited|ample|plentiful|not\s+limited|endless|abundant|uncapped)\b|\b(?:room|venue|hall|space|house|theatre|theater)\s+(?:actually\s+|really\s+|in\s+fact\s+)?(?:seats?|holds?|fits?|accommodates?|takes?)\s+(?:hundreds|thousands|dozens|many\s+more|far\s+more|plenty|a\s+crowd|way\s+more)\b|\bplenty\s+of\s+(?:room|seats?|space|spots?|places?)\b|\b(?:effectively|essentially|basically|virtually|practically)\s+unlimited\b|\bunlimited\s+(?:supply|stock|inventory|availability|seating|cop(?:y|ies)|seat\w*)\b|\bwill\s+(?:still\s+|in\s+fact\s+)?(?:remain|stay|be)\s+(?:there|available|around|accessible|up|live|online|open)\b|\bstay\w*\s+(?:up|live|online|posted)\s+(?:for\s+good|indefinitely|permanently|for\s+the\s+foreseeable)\b|\bremain\w*\s+(?:fully\s+)?available\b|\b(?:has|have|is|are)\s+no\s+(?:real\s+|actual\s+)?(?:deadline|end\s+date|shortage|limit)\b|\b(?:run\w*|stay\w*|remain\w*)\s+(?:open\s+)?(?:year-?round|all\s+year)\b|\bship\s+as\s+many\s+as\s+ordered\b|\bwe\s+can\s+ship\s+as\s+many\b|\b(?:price|deal|offer|rate|cost|link|download)\s+(?:never|does\s+not|will\s+not)\s+(?:change\w*|move\w*|budge\w*|expire\w*|end\w*|go\s+away|get\s+pulled)\b|\b(?:price|deal|offer|rate|cost)\s+(?:is\s+)?(?:always\s+)?(?:the\s+same|unchanged|fixed|constant|stable|permanent)\b|\b(?:enrol?ment|registration|sign-?ups?|the\s+doors?|intake|admission|the\s+cart)\s+(?:is|are)\s+(?:genuinely\s+|actually\s+|really\s+|still\s+|in\s+fact\s+)?(?:rolling|open-?ended|ongoing|continuous(?:ly)?|always\s+open|on\s+a\s+rolling\s+basis|rolling\s+and\s+open-?ended)\b|\bopen-?ended\s+and\s+(?:rolling|ongoing)\b/i;

// REDUCTION / honesty guard: a mechanism token that is the object of a removal
// verb, or a clause dominated by "get to it sooner / cut / trim / front-load",
// is an ordinary tightening edit, not a harmful mechanism.
const REDUCTION_VERB =
  /\b(?:remov\w*|delet\w*|cut\w*|trim\w*|drop\w*|strip\w*|eliminat\w*|reduc\w*|minimi[sz]\w*|shorten\w*|condens\w*|tighten\w*|slash\w*|prun\w*|ax\w*|excis\w*|scrap\w*|ditch\w*|kill\w*|clear\s+out|take\s+out|get\s+rid\s+of|do\s+away\s+with|pare\s+(?:back|down)|clean\s+up)\b/i;
const HONESTY_VERB =
  /\b(?:describ\w*|state\w*|present\w*|summari[sz]\w*|explain\w*|clarif\w*|report\w*|show\w*)\b[^.;:!?]{0,30}?\b(?:honestly|accurately|fairly|plainly|truthfully|as\s+it\s+is|both\s+sides)\b|\b(?:honest|accurate|fair|truthful|straight)\s+(?:framing|description|account|summary|hook)\b/i;

function reductionGuarded(clauseNorm: string, hitIndex: number): boolean {
  if (FRONT_POSITION.test(clauseNorm)) return true;
  if (HONESTY_VERB.test(clauseNorm)) return true;
  // removal verb governing the mechanism token (verb ... <=4 words ... hit)
  const window = clauseNorm.slice(Math.max(0, hitIndex - 60), hitIndex + 1);
  if (REDUCTION_VERB.test(window)) return true;
  return false;
}

/** First match index of any concept regex in the clause, or -1. */
function firstIndex(re: RegExp, clauseNorm: string): number {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const g = new RegExp(re.source, flags);
  const m = g.exec(clauseNorm);
  return m ? m.index : -1;
}

// --------------------------------------------------------------------------
// FINDING 1 -- harmful-treatment mechanism, by composed semantic features
// --------------------------------------------------------------------------

export function harmfulTreatmentByFeatures(text: string): boolean {
  const clauses = segmentSemClauses(text);
  if (clauses.length === 0) return false;
  const whole = normalizeSemanticText(text);
  const purposeField = clauses.some((c) => retentionPurposePresent(c.norm)) || retentionPurposePresent(whole);

  // Cross-clause deceptive scarcity: a scarcity/expiry claim anywhere + an
  // admission of continued availability anywhere in the same field.
  const scarcityIdx = clauses.findIndex((c) => SCARCITY_CLAIM.test(c.norm));
  if (scarcityIdx >= 0) {
    const truth = clauses.some((c) => AVAILABILITY_TRUTH.test(c.norm) || AVAILABILITY_TRUTH_LOOSE.test(c.norm));
    if (truth) {
      const sc = clauses[scarcityIdx];
      const at = firstIndex(SCARCITY_CLAIM, sc.norm);
      if (at < 0 || actionAffirmed(sc.norm, at)) {
        if (!REDUCTION_VERB.test(sc.norm) || END_POSITION.test(sc.norm)) return true;
      }
    }
  }

  // Coreference: a value-noun named earlier in the field can be the referent of
  // a bare pronoun in a later withholding clause, but only when exactly one
  // value-noun antecedent appeared and no competing concrete object is present.
  const valueAntecedents = clauses.filter((c) => VALUE_NOUN.test(c.norm)).length;

  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    const norm = clause.norm;

    // Tier A -- the mechanism alone is a Viewer Value harm.
    for (const re of [CONFLICT_MANUFACTURE, BAIT_SWITCH]) {
      const at = firstIndex(re, norm);
      if (at >= 0 && actionAffirmed(norm, at)) return true;
    }

    // Tier B -- prolonging concepts; harmful with a keep-watching purpose.
    if (purposeField) {
      for (const [re] of PROLONG_CONCEPTS) {
        const at = firstIndex(re, norm);
        if (at >= 0 && actionAffirmed(norm, at) && !reductionGuarded(norm, at)) return true;
      }
    }

    // Tier B -- withholding the promised value.
    const wIdx = firstIndex(WITHHOLD_SIGNAL, norm);
    if (wIdx >= 0 && actionAffirmed(norm, wIdx) && !reductionGuarded(norm, wIdx)) {
      const localValue = VALUE_NOUN.test(norm);
      const corefValue =
        !localValue &&
        valueAntecedents === 1 &&
        i > 0 &&
        /\b(?:it|that|this|them|the\s+same)\b/.test(norm) &&
        clauses.slice(0, i).some((c) => VALUE_NOUN.test(c.norm));
      const hasValue = localValue || corefValue;
      const positional = END_POSITION.test(norm) && !FRONT_POSITION.test(norm);
      if (hasValue && (positional || purposeField)) return true;
    }
  }

  return false;
}

// --------------------------------------------------------------------------
// FINDING 4 -- invalidation conditions that are contradictory by construction
// (in addition to the "can never occur" lexical family already handled).
// Scoped to relationships that can actually appear in Channelwright experiment
// invalidation criteria -- NOT a general theorem prover. "Unlikely" is left
// alone; only "cannot hold at all" is rejected.
// --------------------------------------------------------------------------

// Verb-anchored "greater than" -- deliberately NOT a bare preposition, so an
// ordinary "... over the first day ..." does not read as a comparison.
const COMPARATOR_GT =
  "(?:exceed\\w*|surpass\\w*|outstrip\\w*|outnumber\\w*|outpace\\w*|(?:be\\s+|is\\s+|are\\s+|comes?\\s+in\\s+|comes?\\s+out\\s+|lands?\\s+|reads?\\s+|sits?\\s+|register\\w*\\s+|clock\\w*\\s+)?(?:greater|higher|more|larger|longer|bigger)\\s+than|go(?:es)?\\s+(?:above|over|beyond|past)|is\\s+(?:above|over|beyond|greater\\s+than|more\\s+than)|climb\\w*\\s+(?:above|over|past)|rise\\w*\\s+(?:above|over|past)|be\\s+over|top\\w*|run\\w*\\s+(?:longer|higher)\\s+than|comes?\\s+in\\s+(?:above|over|at\\s+more\\s+than)|lands?\\s+(?:above|over|past)|read\\w*\\s+(?:above|over))";
// For a fixed unambiguous bound (100% of a whole) a bare preposition is safe.
const ABOVE_100 =
  "(?:" + COMPARATOR_GT + "|above|over|past|beyond|more\\s+than|greater\\s+than|north\\s+of|in\\s+excess\\s+of)";

// Each entry: a quantity/relationship that cannot hold for these known
// experiment quantities. `subject` and `object` are matched in either order
// around a "greater than" comparator, or the phrase is matched whole.
const DOMAIN_CONTRADICTIONS: RegExp[] = [
  // average view duration cannot be greater than the video's own length
  new RegExp("\\b(?:average\\s+view\\s+duration|\\bavd\\b|average\\s+watch\\s+time|mean\\s+(?:view\\s+duration|watch\\s+time)|watch\\s+time\\s+per\\s+view)\\b[^.;:!?]{0,50}?" + COMPARATOR_GT + "[^.;:!?]{0,40}?\\b(?:the\\s+)?(?:video['’]?s?\\s+|clip['’]?s?\\s+)?(?:own\\s+|total\\s+)?(?:length|runtime|run\\s?time|duration|video|clip|episode|piece)(?:\\s+itself)?\\b", "i"),
  new RegExp("\\b(?:the\\s+)?(?:video['’]?s?\\s+|clip['’]?s?\\s+)?(?:total\\s+)?(?:length|runtime|run\\s?time|duration|video|clip|episode)\\b[^.;:!?]{0,40}?\\bis\\s+(?:shorter|less)\\s+than\\b[^.;:!?]{0,50}?\\b(?:average\\s+view\\s+duration|\\bavd\\b|average\\s+watch\\s+time|mean\\s+view\\s+duration)\\b", "i"),
  // any percentage-of-a-whole metric above 100%
  new RegExp("\\b(?:average\\s+percentage\\s+viewed|percentage\\s+viewed|percent\\s+viewed|completion\\s+rate|completion|retention(?:\\s+rate)?|click[- ]?through\\s+rate|\\bctr\\b|watched\\s+percentage|view\\s+rate|survey\\s+satisfaction)\\b[^.;:!?]{0,50}?" + ABOVE_100 + "[^.;:!?]{0,15}?(?:100\\s*(?:%|per\\s?cent|percent|percentage\\s+points?)|one\\s+hundred\\s+(?:%|per\\s?cent|percent))", "i"),
  new RegExp("\\b(?:above|over|beyond|more\\s+than|greater\\s+than)\\s+(?:100\\s*(?:%|per\\s?cent|percent)|one\\s+hundred\\s+percent)[^.;:!?]{0,40}?\\b(?:percentage\\s+viewed|completion|retention|click[- ]?through|\\bctr\\b|watched)\\b", "i"),
  // more views than impressions (every view requires an impression)
  new RegExp("\\bviews?\\b[^.;:!?]{0,40}?" + COMPARATOR_GT + "[^.;:!?]{0,25}?\\bimpressions?\\b", "i"),
  new RegExp("\\bimpressions?\\b[^.;:!?]{0,40}?\\bis\\s+(?:fewer|less|lower)\\s+than\\b[^.;:!?]{0,25}?\\bviews?\\b", "i"),
  /\bmore\s+views?\s+than\s+(?:total\s+)?impressions?\b/i,
  /\bmore\s+(?:unique\s+)?viewers?\s+than\s+(?:total\s+)?views?\b/i,
  /\bmore\s+(?:subscribers?|subs)\s+(?:gained\s+)?than\s+(?:unique\s+)?(?:viewers?|views?)\b/i,
  // more unique viewers than views, or subscribers gained beyond viewers
  new RegExp("\\bunique\\s+viewers?\\b[^.;:!?]{0,40}?" + COMPARATOR_GT + "[^.;:!?]{0,25}?\\b(?:total\\s+)?views?\\b", "i"),
  // a criterion required to be simultaneously satisfied and not satisfied
  /\b(?:both\s+(?:be\s+)?(?:met|satisfied|true|triggered|active)\s+and\s+(?:not\s+(?:met|satisfied|true|triggered|active)|un(?:met|satisfied|triggered))|(?:met|satisfied|true|triggered)\s+and\s+un(?:met|satisfied|triggered)\s+at\s+the\s+same\s+time|simultaneously\s+(?:hold\w*|be\s+true)\s+and\s+(?:not\s+hold|be\s+false))\b/i,
  // a value required to be in two mutually exclusive states at once
  /\b(?:the\s+same\s+metric|the\s+metric|it|the\s+result|the\s+number|the\s+figure)\s+(?:must|has\s+to|needs\s+to|would\s+have\s+to|to)?\s*(?:both\s+|simultaneously\s+|at\s+once\s+)?(?:rise\w*|increase\w*|go\s+up|climb\w*|be\s+higher|grow\w*)\s+and\s+(?:simultaneously\s+|also\s+)?(?:fall\w*|decrease\w*|drop\w*|decline\w*|be\s+lower|go\s+down|shrink\w*)\b/i,
  /\bboth\s+(?:rise\w*|increase\w*|climb\w*|go\s+up|grow\w*)\s+and\s+(?:fall\w*|drop\w*|decrease\w*|decline\w*|go\s+down|shrink\w*)\b/i,
  /\bat\s+once\s+(?:higher|greater|more)\s+and\s+(?:lower|less|fewer)\s+than\b/i,
  // an impossible range relation (a lower bound above its own upper bound)
  /\b(?:at\s+least|no\s+fewer\s+than|minimum\s+of)\s+([a-z]+|\d+)\b[^.;:!?]{0,40}?\band\s+(?:at\s+most|no\s+more\s+than|maximum\s+of)\s+(?:the\s+same|fewer|less)\b/i,
];

export function invalidationDomainContradiction(text: string): boolean {
  const norm = normalizeSemanticText(text);
  return DOMAIN_CONTRADICTIONS.some((re) => re.test(norm));
}
