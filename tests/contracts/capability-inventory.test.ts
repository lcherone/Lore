import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const sourceRoutes = (): string[] => {
  const source = read("apps/api/src/app.ts");
  return [...source.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)]
    .map((match) => `${match[1]!.toUpperCase()} ${match[2]!}`)
    .sort();
};

const documentedRoutes = (): string[] => {
  const documentation = read("docs/capabilities.md");
  return [...documentation.matchAll(/`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`/g)]
    .map((match) => `${match[1]!} ${match[2]!}`)
    .sort();
};

const sourceJobs = (): string[] => {
  const source = read("apps/worker/src/index.ts");
  return [...source.matchAll(/job\.name === "([^"]+)"/g)].map((match) => match[1]!).sort();
};

const documentedJobs = (): string[] => {
  const documentation = read("docs/capabilities.md");
  const section =
    documentation.split("## Worker jobs")[1]?.split("## Human control surface")[0] ?? "";
  return [...section.matchAll(/\| `([^`]+)`\s*\|/g)].map((match) => match[1]!).sort();
};

describe("documentation capability inventory", () => {
  it("lists every current API route and no removed route", () => {
    expect(documentedRoutes()).toEqual(sourceRoutes());
  });

  it("lists every executable worker job and no removed job", () => {
    expect(documentedJobs()).toEqual(sourceJobs());
  });
});
