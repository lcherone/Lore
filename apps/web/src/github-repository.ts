export interface GitHubRepositoryReference {
  owner: string;
  name: string;
}

export function parseGitHubRepositoryReference(value: string): GitHubRepositoryReference {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/, "");
  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Use a github.com repository URL");
    }
    path = url.pathname.replace(/^\//, "");
  }
  const [owner, name, extra] = path.split("/");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !name || extra || !validPart.test(owner) || !validPart.test(name)) {
    throw new Error("Use OWNER/REPOSITORY or https://github.com/OWNER/REPOSITORY");
  }
  return { owner, name };
}
