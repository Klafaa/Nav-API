import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { ParseError } from "../errors";

/**
 * Configured fast-xml-parser instances for the NAV API.
 *
 * NAV is XSD-strict; we therefore:
 *   - emit a stable, attribute-aware XML using the conventional `:@` prefix,
 *   - keep element order exactly as inserted into the JS object,
 *   - never auto-convert numeric strings (NAV expects xs:decimal as plain text),
 *   - always include the XML declaration with UTF-8 + standalone="yes".
 */
const ATTR_PREFIX = "@_";
const TEXT_NODE = "#text";

const builder = new XMLBuilder({
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_NODE,
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
  processEntities: true,
});

const parser = new XMLParser({
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_NODE,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: () => false,
  allowBooleanAttributes: true,
});

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function buildXml(rootName: string, body: Record<string, unknown>, attrs?: Record<string, string>): string {
  const root: Record<string, unknown> = { ...body };
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      root[`${ATTR_PREFIX}${k}`] = v;
    }
  }
  const xml = builder.build({ [rootName]: root });
  return XML_DECL + xml;
}

export function parseXml<T = unknown>(xml: string): T {
  try {
    return parser.parse(xml) as T;
  } catch (err) {
    throw new ParseError("XML_PARSE_FAILED", "Failed to parse NAV XML response", err);
  }
}

/**
 * Get a deeply nested value while traversing optional namespaces and arrays.
 * Returns undefined if any intermediate value is missing.
 */
export function pick(obj: unknown, ...path: string[]): unknown {
  let cursor: any = obj;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && TEXT_NODE in (v as object)) {
    return asString((v as Record<string, unknown>)[TEXT_NODE]);
  }
  return undefined;
}

export function asNumber(v: unknown): number | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function asBoolean(v: unknown): boolean | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  return s === "true" || s === "1";
}

export const ATTR_KEY = (name: string) => `${ATTR_PREFIX}${name}`;
