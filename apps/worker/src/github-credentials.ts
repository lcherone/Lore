import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_PRIVATE_KEY_BYTES = 100_000;
const MAX_TOKEN_BYTES = 16_000;

async function readSecureCredentialFile(
  configuredPath: string,
  label: string,
  maxBytes: number
): Promise<string> {
  const path = resolve(configuredPath);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} path must be a regular, non-symlink file: ${path}`);
  }
  if (metadata.size > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} permissions are too broad; run: chmod 600 ${path}`);
  }
  return (await readFile(path, "utf8")).trim();
}

export async function loadGitHubPrivateKey(
  environment: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const inline = environment.GITHUB_PRIVATE_KEY?.trim();
  if (inline) return inline;

  const configuredPath = environment.GITHUB_PRIVATE_KEY_PATH?.trim();
  if (!configuredPath) return undefined;
  const key = await readSecureCredentialFile(
    configuredPath,
    "GitHub private key",
    MAX_PRIVATE_KEY_BYTES
  );
  if (!key.includes("BEGIN") || !key.includes("PRIVATE KEY")) {
    throw new Error("GITHUB_PRIVATE_KEY_PATH does not contain a PEM private key");
  }
  return key;
}

export async function loadGitHubToken(
  environment: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const inline = environment.GITHUB_TOKEN?.trim();
  const token =
    inline ??
    (environment.GITHUB_TOKEN_PATH?.trim()
      ? await readSecureCredentialFile(
          environment.GITHUB_TOKEN_PATH,
          "GitHub token file",
          MAX_TOKEN_BYTES
        )
      : undefined);
  if (!token) return undefined;
  if (token.length < 20 || /\s/.test(token)) {
    throw new Error("GitHub token is malformed; expected one non-whitespace token");
  }
  return token;
}
