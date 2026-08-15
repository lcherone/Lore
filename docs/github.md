# GitHub App setup

1. In GitHub, create an App for the organisation.
2. Set the webhook URL to `https://YOUR_HOST/api/github/webhook`.
3. Generate a private key and store it outside the repository.
4. Grant repository metadata, contents, and pull request read access. Add issues read access only when ticket-link evidence is needed.
5. Subscribe to pull request, pull request review, and pull request review comment events.
6. Copy the App ID, webhook secret, and private key into the runtime environment.
7. Install the App on selected repositories.
8. Set the repository retention policy, then start an import from the repository screen or `POST /api/repositories/:id/github-import`.

Historical import is bounded to 50, 100, 250, 500, or 1,000 merged PRs. Review-comment retention is independent; summary-only mode excludes raw bodies and raw diffs, and raw diff retention is opt-in. GitHub delivery IDs, PR IDs, comment IDs, and commit SHAs make replay safe.

For local exploration, leave all GitHub variables empty and use demo mode.
