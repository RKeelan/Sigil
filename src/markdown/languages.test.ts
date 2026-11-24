import { describe, expect, test } from "bun:test";
import { fenceLanguage, fenceName } from "./languages.ts";

describe("fenceName", () => {
  test("is the info string's first word, in lower case", () => {
    expect(fenceName("TypeScript")).toBe("typescript");
    expect(fenceName('  js title="a.js"')).toBe("js");
    expect(fenceName("ts{1,3}")).toBe("ts");
    expect(fenceName("")).toBe("");
  });
});

describe("fenceLanguage", () => {
  test("knows a language by any of its names", () => {
    expect(fenceLanguage("ts")).toBe(fenceLanguage("typescript"));
    expect(fenceLanguage("C#")).toBe(fenceLanguage("csharp"));
    expect(fenceLanguage("bash")).toBe(fenceLanguage("sh"));
    expect(fenceLanguage("ts")).not.toBe(fenceLanguage("js"));
  });

  test("is null for a name it doesn't know, or none", () => {
    expect(fenceLanguage("nonesuch")).toBeNull();
    expect(fenceLanguage("")).toBeNull();
  });
});
