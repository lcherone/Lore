import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Docker web proxy", () => {
  it("re-resolves the replaceable API service through Docker DNS", async () => {
    const configuration = await readFile("docker/nginx.conf", "utf8");

    expect(configuration).toContain("resolver 127.0.0.11 valid=5s ipv6=off;");
    expect(configuration).toContain("set $lore_api http://api:3001;");
    expect(configuration.match(/proxy_pass \$lore_api;/g)).toHaveLength(2);
    expect(configuration).not.toContain("proxy_pass http://api:3001;");

    const localScript = await readFile("scripts/lore-local.sh", "utf8");
    expect(localScript).toContain('curl -fsS "$app_url/healthz"');
    expect(localScript).toContain("Web-to-API proxy check failed");
  });
});
