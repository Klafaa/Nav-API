import { describe, expect, test } from "bun:test";
import { ATTR_KEY, asBoolean, asNumber, asString, buildXml, parseXml } from "./xml";

describe("buildXml", () => {
  test("emits XML declaration and attributes", () => {
    const xml = buildXml(
      "Root",
      {
        a: "1",
        nested: { [ATTR_KEY("k")]: "v", "#text": "hello" },
      },
      { xmlns: "urn:test", "xmlns:c": "urn:c" },
    );
    expect(xml.startsWith("<?xml")).toBeTrue();
    expect(xml).toContain('xmlns="urn:test"');
    expect(xml).toContain('xmlns:c="urn:c"');
    expect(xml).toContain("<a>1</a>");
    expect(xml).toContain('<nested k="v">hello</nested>');
  });
});

describe("parseXml", () => {
  test("strips namespaces and exposes attributes", () => {
    const xml = `<?xml version="1.0"?><ns:r xmlns:ns="urn:n"><x foo="bar">1</x></ns:r>`;
    const parsed = parseXml<any>(xml);
    expect(parsed.r).toBeDefined();
    expect(parsed.r.x).toBeDefined();
    expect(asString(parsed.r.x)).toBe("1");
  });

  test("asBoolean / asNumber / asString primitives", () => {
    expect(asBoolean("true")).toBe(true);
    expect(asBoolean("false")).toBe(false);
    expect(asNumber("3.14")).toBeCloseTo(3.14, 5);
    expect(asString({ "#text": "hi" })).toBe("hi");
    expect(asString(undefined)).toBeUndefined();
  });
});
