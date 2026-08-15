import { delimiter, isAbsolute, relative, resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";

export async function assertTrustedRepositoryPath(
  repositoryPath: string,
  configuredRoots = process.env.LORE_ALLOWED_REPOSITORY_ROOTS ?? ""
): Promise<string> {
  const roots = configuredRoots.split(delimiter).map((root) => root.trim()).filter(Boolean);
  if (roots.length === 0) throw new Error("No trusted repository roots are configured; use the local Lore client graph-upload workflow");
  const canonicalPath = await realpath(resolve(repositoryPath));
  const allowed = await Promise.all(roots.map((root) => realpath(resolve(root))));
  if (!allowed.some((root) => {
    const child = relative(root, canonicalPath);
    return child === "" || (!child.startsWith("..") && !isAbsolute(child));
  })) {
    throw new Error("Repository path is outside the configured trusted roots");
  }
  const metadata = await lstat(canonicalPath);
  if (!metadata.isDirectory()) throw new Error("Repository path is not a directory");
  const currentUser = process.getuid?.();
  if (currentUser != null && metadata.uid !== currentUser) throw new Error("Repository path is owned by another user");
  return canonicalPath;
}
