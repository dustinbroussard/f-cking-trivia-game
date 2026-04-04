const COMMON_RESPONSE_KEYS = new Set([
  'heckle',
  'heckles',
  'commentary',
  'commentaryBooth',
  'line',
  'lines',
  'message',
  'messages',
  'trashTalk',
  'trash_talk',
]);

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function cleanDisplayText(text: string) {
  const cleaned = stripCodeFence(text)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,[{]+/, '')
    .replace(/[\s,}\]]+$/, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function collectFromObject(value: Record<string, unknown>) {
  const prioritized = Object.keys(value).sort((a, b) => {
    const aKnown = COMMON_RESPONSE_KEYS.has(a) ? 0 : 1;
    const bKnown = COMMON_RESPONSE_KEYS.has(b) ? 0 : 1;
    return aKnown - bKnown;
  });

  for (const key of prioritized) {
    const extracted = extractTextValues(value[key]);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  return [];
}

function tryParseJsonLike(text: string) {
  const candidates = [text];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying the next shape.
    }
  }

  return null;
}

function extractQuotedValues(text: string) {
  const matches = Array.from(text.matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1] ?? '')
    .map((value) => value.replace(/\\"/g, '"').trim())
    .filter((value) => value.length > 0 && !COMMON_RESPONSE_KEYS.has(value));

  return matches.map((value) => cleanDisplayText(value)).filter((value): value is string => !!value);
}

function shouldExtractQuotedValues(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return true;
  }

  return /"(?:heckle|heckles|commentary|commentaryBooth|line|lines|message|messages|trashTalk|trash_talk)"\s*:/.test(trimmed);
}

function extractTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = stripCodeFence(value);
    if (!normalized) {
      return [];
    }

    const parsed = tryParseJsonLike(normalized);
    if (parsed !== null) {
      return extractTextValues(parsed);
    }

    const quotedValues = shouldExtractQuotedValues(normalized) ? extractQuotedValues(normalized) : [];
    if (quotedValues.length > 0) {
      return quotedValues;
    }

    const cleaned = cleanDisplayText(normalized);
    return cleaned ? [cleaned] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextValues(item));
  }

  if (value && typeof value === 'object') {
    return collectFromObject(value as Record<string, unknown>);
  }

  return [];
}

export function extractAiDisplayLines(value: unknown) {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const line of extractTextValues(value)) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(normalized);
  }

  return lines;
}

export function extractAiDisplayText(value: unknown) {
  const lines = extractAiDisplayLines(value);
  if (lines.length === 0) {
    return null;
  }

  return lines.join('\n');
}

export function extractFirstAiDisplayLine(value: unknown) {
  return extractAiDisplayLines(value)[0] ?? null;
}
