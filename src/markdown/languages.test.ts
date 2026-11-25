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
  test("knows a language by its name or any of its aliases", () => {
    expect(fenceLanguage("TypeScript")?.name).toBe("TypeScript");
    expect(fenceLanguage("ts")?.name).toBe("TypeScript");
    expect(fenceLanguage("C#")?.name).toBe("C#");
    expect(fenceLanguage("bash")?.name).toBe("Shell");
    expect(fenceLanguage("erlang")?.name).toBe("Erlang");
  });

  test("knows a language by a file extension", () => {
    expect(fenceLanguage("py")?.name).toBe("Python");
    expect(fenceLanguage("rs")?.name).toBe("Rust");
    expect(fenceLanguage("ps1")?.name).toBe("PowerShell");
  });

  test("is null for plain text, or a name it doesn't know, or none", () => {
    expect(fenceLanguage("text")).toBeNull();
    expect(fenceLanguage("nonesuch")).toBeNull();
    expect(fenceLanguage("")).toBeNull();
  });
});
