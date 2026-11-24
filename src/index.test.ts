import { expect, test } from "bun:test";
import pkg from "../package.json";
import { version } from "./index.ts";

test("version matches package.json", () => {
  expect(version).toBe(pkg.version);
});
