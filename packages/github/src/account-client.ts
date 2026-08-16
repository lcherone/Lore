import { Octokit } from "@octokit/rest";
import type { GitHubUserIdentity } from "@lore/shared/types.js";

export interface GitHubRepositoryOption {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  description?: string;
  cloneUrl: string;
  htmlUrl: string;
}

export class GitHubTokenAccountClient {
  readonly #octokit: Octokit;

  public constructor(token: string, octokit?: Octokit) {
    this.#octokit = octokit ?? new Octokit({ auth: token });
  }

  async identity(): Promise<GitHubUserIdentity> {
    const { data: user } = await this.#octokit.rest.users.getAuthenticated();
    const emails = await this.#octokit.rest.users.listEmailsForAuthenticatedUser({ per_page: 100 })
      .then((response) => response.data)
      .catch(() => []);
    const email = emails.find((item) => item.primary && item.verified)?.email
      ?? emails.find((item) => item.verified)?.email
      ?? user.email
      ?? `${user.id}+${user.login}@users.noreply.github.com`;
    const optional = (value: string | null | undefined): string | undefined => value?.trim() || undefined;
    return {
      providerUserId: String(user.id),
      login: user.login,
      email,
      name: optional(user.name) ?? user.login,
      profileUrl: user.html_url,
      ...(optional(user.avatar_url) ? { avatarUrl: optional(user.avatar_url) } : {}),
      ...(optional(user.bio) ? { bio: optional(user.bio) } : {}),
      ...(optional(user.company) ? { company: optional(user.company) } : {}),
      ...(optional(user.location) ? { location: optional(user.location) } : {}),
      ...(optional(user.blog) ? { websiteUrl: optional(user.blog) } : {})
    };
  }

  async repositories(): Promise<GitHubRepositoryOption[]> {
    const repositories = await this.#octokit.paginate(
      this.#octokit.rest.repos.listForAuthenticatedUser,
      {
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "full_name",
        direction: "asc",
        per_page: 100
      }
    );
    return repositories.map((repository) => ({
      id: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      private: repository.private,
      archived: repository.archived,
      ...(repository.description ? { description: repository.description } : {}),
      cloneUrl: repository.clone_url,
      htmlUrl: repository.html_url
    }));
  }
}
