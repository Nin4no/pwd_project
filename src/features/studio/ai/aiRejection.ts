import { serverCode, serverMessage, statusOf } from '../../../services/api/client';

export type AiErrorCode =
  | 'AI_PROMPT_INJECTION'
  | 'AI_INVALID_PROMPT'
  | 'AI_UNRELATED_PROMPT'
  | 'AI_UNRELATED_IMAGE';

export type AiRejectionContext = 'furniture-text' | 'furniture-photo' | 'room-photo';

export const MAX_FURNITURE_PROMPT_LEN = 500;
export const MAX_HINT_NAME_LEN = 120;

const AI_ERROR_CODES = new Set<AiErrorCode>([
  'AI_PROMPT_INJECTION',
  'AI_INVALID_PROMPT',
  'AI_UNRELATED_PROMPT',
  'AI_UNRELATED_IMAGE',
]);

const HANGUL_RE = /[가-힣]/;
const ASCII_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g;
const HAS_LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;
const HAS_LETTER_RE = /\p{L}/u;
const STANDALONE_JAMO_RE = /^[\u1100-\u11FFㄱ-ㅎㅏ-ㅣ\s\p{P}\p{N}]+$/u;
const REPEATED_CHAR_RE = /([^\s])\1{4,}/u;
const DIMENSION_UNIT_RE = /(?:^|[\s\p{P}\p{N}])(?:mm|cm|m|x|×|\*)(?=$|[\s\p{P}\p{N}])/giu;
const NON_WORD_OR_DIGIT_RE = /[\d\s\p{P}×*]/gu;

const BOUNDARY_TAG_NAMES = [
  'user_request',
  'user-request',
  'hint_name',
  'hint-name',
  'system_prompt',
  'system-prompt',
  'system_message',
  'system-message',
  'system',
  'assistant',
  'developer',
  'instructions',
  'instruction',
  'prompt',
  'tool_call',
  'tool_use',
  'tool_result',
  'tool',
  'function_call',
  'function',
  'context',
  'user',
  'hint',
  'role',
  'rules',
].join('|');

const BOUNDARY_TAG_RE = new RegExp(
  `<\\s*(?:\\/\\s*)?(?:${BOUNDARY_TAG_NAMES})(?:[\\s/][^<>]*)?>`,
  'gi',
);

const DELIMITER_INJECTION_PATTERNS: readonly RegExp[] = [
  /<\|[^|>\n]{1,40}\|>/,
  /\[\/?INST\]/i,
  /<<\/?SYS>>/i,
  /###\s*(?:system|instruction|instructions|assistant|developer)\s*:/i,
];

const PHRASE_INJECTION_PATTERNS: readonly RegExp[] = [
  // English: override / ignore / bypass previous or system instructions/prompts/rules
  /\b(?:ignore|disregard|forget|override|bypass|skip|drop|cancel|overwrite|abandon|reset)\b(?:\s+\b(?:all|any|every|the|your|my|these|those|following|above|prior|previous|earlier|preceding|original|initial|current|existing|system|developer|hidden|safety|security)\b){0,6}\s+\b(?:instructions?|prompts?|rules?|directives?|guidelines?|constraints?|policies|policy|commands?|orders?|context|behavior|guardrails?|restrictions?|settings?)\b/i,
  // English: ignore/forget everything/all/what above/before/prior/was said/you were told
  /\b(?:ignore|disregard|forget|override)\b\s+\b(?:everything|all|anything|what)\b\s+(?:\b(?:above|before|prior|previously)\b|was\s+said|you\s+were\s+told)/i,
  // English: reveal / dump / show system or developer prompt/instructions
  /\b(?:reveal|show|print|output|dump|leak|repeat|disclose|expose|tell|give|return|display|echo|extract|list|share)\b(?:\s+\b(?:me|us)\b)?(?:\s+\b(?:all|the|your|full|complete|exact|verbatim|entire|original|initial)\b){0,3}\s+\b(?:system|developer|hidden|secret|internal|initial|original|meta)\b\s+\b(?:prompt|prompts|instructions?|message|messages|rules?|directives?|guidelines?|config|configuration)\b/i,
  // English: reveal / repeat above/previous instructions/prompt
  /\b(?:reveal|show|print|output|dump|leak|repeat|disclose|expose|tell)\b(?:\s+\b(?:me|us)\b)?(?:\s+\b(?:all|the|your|verbatim|exact)\b){0,2}\s+\b(?:above|previous|prior)\b\s+\b(?:prompt|prompts|instructions?|text|rules?)\b/i,
  // English: ask for system/developer/hidden prompt
  /\bwhat\s+(?:is|are)\s+(?:the|your)\s+(?:system|developer|hidden|initial|original)\s+(?:prompt|instructions?|rules?)\b/i,
  // English: role / persona hijack & jailbreak
  /\byou\s+are\s+now\s+\S/i,
  /\bfrom\s+now\s+on\s+you\s+are\b/i,
  /\bpretend\s+to\s+be\b/i,
  /\bact\s+like\b/i,
  /\broleplay\s+as\b/i,
  /\b(?:act|behave|pretend|respond|operate)\s+as\s+(?:a\s+|an\s+|the\s+)?(?:unrestricted|unfiltered|jailbroken|evil|root|admin|system|developer|dan|hacker|different\s+(?:ai|model|assistant))\b/i,
  /\b(?:dan|developer|god|admin|sudo|unrestricted|unfiltered|jailbreak)\s+mode\b/i,
  /\bjailbreak(?:ing|ed)?\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bnew\s+(?:system\s+)?instructions?\s*:/i,
  /(?:^|\n)[ \t]*(?:system|developer)\s+(?:prompt|instructions?)\s*:/i,

  // Korean: expanded instruction override & system/developer prompt exfiltration
  /(?:이전|기존|앞선|위의|위쪽|상단|지금까지|방금|여태|그동안|모든|전체|전부|시스템|개발자|원래|초기|숨겨진|숨긴|내부|보안)[\s\S]{0,35}(?:지시사항|지시문|지시|지침|명령어|명령|규칙|프롬프트|정책|제약|가이드라인|역할|페르소나|말|내용|요청)[\s\S]{0,35}(?:무시|잊어|잊고|잊으|까먹|버리|폐기|무효|덮어|재정의|우회|취소|해제|삭제|초기화|바꿔|변경해|따르지\s*말|지키지\s*말|출력|공개|보여|알려|노출|표시|반환|유출|말해|적어|써줘|추출|반복)/,
  // Korean: settings override/exfiltration (tight adjacency to avoid false positives on "모듈 시스템 선반 크기 설정 알려줘")
  /(?:이전|기존|앞선|위의|원래|초기|시스템|개발자|보안)(?:의)?\s*설정[\s\S]{0,16}(?:무시|잊어|잊고|잊으|덮어|재정의|우회|취소|해제|삭제|초기화|출력|공개|보여|알려|노출|표시|반환|유출)/,
  // Korean: forget / ignore shorthand
  /(?:이전|기존|위의|지금까지|방금|모든|전부|다|싹|명령|지시|규칙|프롬프트|지침)[\s\S]{0,20}(?:잊고|잊어버|잊어줘|잊으|까먹|무시하|무시해)/,
  // Korean: direct system/developer/hidden prompt exfiltration or override
  /(?:시스템|개발자|숨겨진|숨긴|내부|원래|초기)\s*프롬프트/,
  /프롬프트[\s\S]{0,16}(?:출력|공개|보여|알려|노출|표시|반환|무시|덮어|우회|잊어|재정의|유출)/,
  // Korean: verb-first ordering
  /(?:무시|잊어|덮어|우회|출력|공개|보여|알려|노출|반환)[\s\S]{0,12}(?:이전|기존|위의|모든|시스템|개발자|숨겨진)[\s\S]{0,12}(?:지시사항|지시|지침|명령|규칙|프롬프트|설정)/,
  // Korean: jailbreak / privileged mode / safety bypass / role hijack
  /탈옥/,
  /(?:개발자|관리자|루트|제한\s*없는|무제한|시스템)\s*모드/,
  /(?:보안|안전|안전장치|필터|제한|규칙|가이드라인)\s*(?:[을를]\s*)?(?:해제|우회|끄고|꺼줘|비활성화|무력화)/,
  /(?:이제부터|지금부터)\s*(?:너는|당신은|넌)\s*\S/,
  /(?:너는|당신은|넌)\s*(?:이제부터|지금부터)/,
  /(?:네|너의|당신의)\s*(?:새로운\s*)?(?:역할|페르소나|임무)(?:은|는)/,
  /(?:\S+)(?:처럼|인\s*척)\s*(?:행동|대답|응답|연기)/,
  // Korean/Mixed: secret/key exfiltration
  /(?:api\s*키|시크릿\s*키|환경\s*변수|토큰|\.env)[\s\S]{0,20}(?:출력|공개|보여|알려|노출|유출)/i,
];

const OFF_TOPIC_INTENT_RE =
  /날씨|기온|일기예보|점심\s*메뉴|저녁\s*메뉴|메뉴\s*추천|레시피|맛집|파이썬|자바스크립트|타입스크립트|코딩|프로그래밍|소스\s*코드|코드\s*짜|함수\s*작성|알고리즘|쿼리|구구단|번역해|요약해\s*줘|소설\s*써|시\s*써줘|노래\s*가사|운세|사주|주식\s*추천|비트코인|\b(?:weather|forecast|recipe)\b|\b(?:python|javascript|typescript|sql)\s+(?:code|script|function|program)\b|\bwrite\s+(?:a\s+)?(?:code|script|program|essay|poem|story)\b/i;

const FURNITURE_DOMAIN_RE =
  /침대|매트리스|베드|벙커|데이베드|평상|헤드보드|해먹|책상|데스크|식탁|테이블|탁자|협탁|소반|교자상|좌탁|아일랜드|홈바|화장대|드레서|콘솔|다이닝|작업대|거치대|받침대|스탠드|이젤|수납장|수납함|수납|책장|책꽂이|옷장|붙박이장|장롱|서랍장|서랍|신발장|슈즈랙|거실장|장식장|진열장|찬장|그릇장|렌지대|싱크대|하부장|상부장|시스템\s*주방|팬트리|사물함|락커|캐비닛|선반|랙|타공판|페그보드|행거|옷걸이|코트랙|트롤리|왜건|우산꽂이|잡지꽂이|화분대|리빙박스|바구니|빨래함|문갑|뒤주|tv\s*장|티비\s*장|미디어장|사이드보드|의자|체어|소파|카우치|벤치|스툴|암체어|리클라이너|빈백|오토만|푸프|방석|조명|램프|라이트|전등|무드등|샹들리에|벽등|거울|미러|전신거울|파티션|칸막이|가벽|병풍|창문|창호|유리창|미닫이\s*창|미닫이문|여닫이문|현관문|중문|폴딩도어|슬라이딩\s*도어|도어|(?<![가-힣])문(?![가-힣])|(?<![가-힣])창(?![가-힣])|커튼|블라인드|러그|카펫|벽시계|화분|플랜터|가전|냉장고|김치냉장고|와인셀러|세탁기|건조기|의류관리기|스타일러|에어컨|공기청정기|제습기|가습기|히터|난로|선풍기|식기세척기|전자레인지|오븐|정수기|청소기|안마의자|티비|텔레비전|모니터|스피커|피아노|건반|캣타워|스크래처|강아지\s*계단|펫\s*하우스|개집|어항|수조|가구|(?<![a-z])(?:desk|table|chair|sofa|couch|bed|bunk|mattress|shelf|shelves|shelving|rack|cabinet|wardrobe|closet|armoire|dresser|vanity|drawer|chest|nightstand|bookcase|bookshelf|stool|bench|ottoman|armchair|recliner|lamp|light|lighting|sconce|chandelier|mirror|pegboard|partition|divider|hutch|sideboard|console|credenza|buffet|trolley|cart|hanger|fridge|refrigerator|freezer|washer|dryer|styler|aircon|purifier|dishwasher|microwave|oven|tv|television|window|door|curtain|blind|rug|carpet|piano|hammock|furniture|appliance|kitchen\s*system)s?(?![a-z])/i;

export class AiInputRejectedError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AiInputRejectedError';
    this.code = code;
    this.status = status;
  }
}

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && AI_ERROR_CODES.has(value as AiErrorCode);
}

export function defaultRejectionMessage(code: AiErrorCode, context: AiRejectionContext): string {
  switch (code) {
    case 'AI_PROMPT_INJECTION':
      return '허용되지 않는 지시문이나 명령어가 포함되어 가구를 생성할 수 없어요. 가구의 종류·크기·재질만 입력해 주세요.';
    case 'AI_INVALID_PROMPT':
      return '입력 형식이 올바르지 않아요. 가구 설명이나 입력값을 확인해 주세요.';
    case 'AI_UNRELATED_PROMPT':
      return '가구와 관련이 없는 내용이라 가구를 생성하지 않았어요. 침대·책상·수납장 같은 가구 설명을 입력해 주세요.';
    case 'AI_UNRELATED_IMAGE':
      return context === 'room-photo'
        ? '방이나 실내 도면과 관련이 없는 이미지예요. 실내 공간이나 평면도 사진을 올려 주세요.'
        : '가구와 관련이 없는 이미지라 가구를 생성하지 않았어요. 단일 가구가 잘 보이는 사진을 올려 주세요.';
  }
}

function stripBoundaryTags(input: string, replacement = ''): string {
  let current = input;
  while (true) {
    const next = current.replace(BOUNDARY_TAG_RE, replacement);
    if (next === current) return current;
    current = next;
  }
}

export function normalizeForGuard(raw: string): string {
  return raw
    .replace(ZERO_WIDTH_RE, '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\s]+/g, ' ')
    .trim();
}

export function sanitizeClientPromptText(raw: string): string {
  const cleaned = raw.replace(ASCII_CONTROL_RE, '').replace(ZERO_WIDTH_RE, '');
  return stripBoundaryTags(cleaned, '').trim();
}

export function hasClientPromptInjection(raw: string): boolean {
  const withoutZeroWidth = raw.replace(ZERO_WIDTH_RE, '').normalize('NFKC');
  const withoutControls = withoutZeroWidth.replace(ASCII_CONTROL_RE, '');
  if (DELIMITER_INJECTION_PATTERNS.some((pattern) => pattern.test(withoutControls))) {
    return true;
  }

  const stripped = stripBoundaryTags(withoutControls, '').trim();
  const tagSpaced = stripBoundaryTags(withoutControls, ' ').replace(/[ \t]+/g, ' ').trim();
  const controlSpaced = stripBoundaryTags(withoutZeroWidth.replace(ASCII_CONTROL_RE, ' '), ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const collapsed = normalizeForGuard(stripBoundaryTags(withoutControls, ' '));

  return PHRASE_INJECTION_PATTERNS.some(
    (pattern) =>
      pattern.test(stripped) ||
      pattern.test(tagSpaced) ||
      pattern.test(controlSpaced) ||
      pattern.test(collapsed),
  );
}

function hasNoMeaningfulLetters(text: string): boolean {
  const withoutUnits = text.replace(DIMENSION_UNIT_RE, ' ').replace(NON_WORD_OR_DIGIT_RE, '');
  return !HAS_LETTER_RE.test(withoutUnits);
}

function isKeyboardSmashAscii(text: string): boolean {
  if (FURNITURE_DOMAIN_RE.test(text)) return false;
  if (HANGUL_RE.test(text)) return false;
  const asciiLetters = text.match(/[a-zA-Z]/g);
  if (!asciiLetters || asciiLetters.length < 6) return false;
  const joined = asciiLetters.join('').toLowerCase();
  if (/asdf|qwer|zxcv/.test(joined)) return true;
  const vowels = (joined.match(/[aeiouy]/g) ?? []).length;
  return vowels / joined.length < 0.15;
}

export function isUnrelatedFurniturePrompt(safePrompt: string): boolean {
  const normalized = normalizeForGuard(safePrompt);
  if (hasNoMeaningfulLetters(normalized)) return true;
  if (STANDALONE_JAMO_RE.test(normalized)) return true;
  if (REPEATED_CHAR_RE.test(normalized)) return true;
  if (OFF_TOPIC_INTENT_RE.test(normalized)) return true;
  if (!FURNITURE_DOMAIN_RE.test(normalized)) return true;
  return false;
}

function isUnrelatedHintName(safeHint: string): boolean {
  const normalized = normalizeForGuard(safeHint);
  if (hasNoMeaningfulLetters(normalized)) return true;
  if (STANDALONE_JAMO_RE.test(normalized)) return true;
  if (REPEATED_CHAR_RE.test(normalized)) return true;
  if (OFF_TOPIC_INTENT_RE.test(normalized)) return true;
  if (isKeyboardSmashAscii(normalized)) return true;
  return false;
}

export function guardClientFurniturePrompt(prompt: string): string {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new AiInputRejectedError(
      'AI_INVALID_PROMPT',
      defaultRejectionMessage('AI_INVALID_PROMPT', 'furniture-text'),
      400,
    );
  }
  const trimmed = prompt.trim();
  if (trimmed.length > MAX_FURNITURE_PROMPT_LEN) {
    throw new AiInputRejectedError(
      'AI_INVALID_PROMPT',
      `가구 설명은 ${MAX_FURNITURE_PROMPT_LEN}자 이하로 입력해 주세요.`,
      400,
    );
  }
  if (hasClientPromptInjection(trimmed)) {
    throw new AiInputRejectedError(
      'AI_PROMPT_INJECTION',
      defaultRejectionMessage('AI_PROMPT_INJECTION', 'furniture-text'),
      400,
    );
  }
  const safePrompt = sanitizeClientPromptText(trimmed);
  if (!safePrompt || !HAS_LETTER_OR_DIGIT_RE.test(safePrompt)) {
    throw new AiInputRejectedError(
      'AI_INVALID_PROMPT',
      defaultRejectionMessage('AI_INVALID_PROMPT', 'furniture-text'),
      400,
    );
  }
  if (isUnrelatedFurniturePrompt(safePrompt)) {
    throw new AiInputRejectedError(
      'AI_UNRELATED_PROMPT',
      defaultRejectionMessage('AI_UNRELATED_PROMPT', 'furniture-text'),
      422,
    );
  }
  return safePrompt;
}

export function guardClientHintName(hintName?: string): string | undefined {
  if (hintName === undefined) return undefined;
  if (typeof hintName !== 'string' || hintName.length > MAX_HINT_NAME_LEN) {
    throw new AiInputRejectedError(
      'AI_INVALID_PROMPT',
      `가구 이름은 ${MAX_HINT_NAME_LEN}자 이하로 입력해 주세요.`,
      400,
    );
  }
  if (hasClientPromptInjection(hintName)) {
    throw new AiInputRejectedError(
      'AI_PROMPT_INJECTION',
      defaultRejectionMessage('AI_PROMPT_INJECTION', 'furniture-photo'),
      400,
    );
  }
  const safeHint = sanitizeClientPromptText(hintName);
  if (!safeHint || !HAS_LETTER_OR_DIGIT_RE.test(safeHint)) {
    throw new AiInputRejectedError(
      'AI_INVALID_PROMPT',
      defaultRejectionMessage('AI_INVALID_PROMPT', 'furniture-photo'),
      400,
    );
  }
  if (isUnrelatedHintName(safeHint)) {
    throw new AiInputRejectedError(
      'AI_UNRELATED_PROMPT',
      defaultRejectionMessage('AI_UNRELATED_PROMPT', 'furniture-photo'),
      422,
    );
  }
  return safeHint;
}

export function toAiRejectionError(err: unknown, context: AiRejectionContext): AiInputRejectedError | null {
  if (err instanceof AiInputRejectedError) return err;
  const status = statusOf(err);
  const code = serverCode(err);
  const msg = serverMessage(err);

  if (isAiErrorCode(code) || status === 400 || status === 422) {
    const resolvedCode: AiErrorCode = isAiErrorCode(code)
      ? code
      : status === 422
        ? context === 'furniture-text'
          ? 'AI_UNRELATED_PROMPT'
          : 'AI_UNRELATED_IMAGE'
        : 'AI_INVALID_PROMPT';
    const resolvedMessage =
      msg && HANGUL_RE.test(msg) ? msg : defaultRejectionMessage(resolvedCode, context);
    return new AiInputRejectedError(resolvedCode, resolvedMessage, status);
  }

  return null;
}
