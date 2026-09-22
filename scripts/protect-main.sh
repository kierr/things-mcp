#!/usr/bin/env bash
# Apply branch protection to kierr/things-mcp after making it public.
# Free-plan public repos support branch protection; private repos do not.
#
# Usage: ./scripts/protect-main.sh

set -euo pipefail

REPO="kierr/things-mcp"
BRANCH="main"

echo "Applying branch protection to ${REPO}:${BRANCH}..."

gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": []
  },
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "enforce_admins": false,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
EOF

echo ""
echo "Branch protection applied:"
echo "  - Require PR (0 approvals, stale reviews dismissed)"
echo "  - Require status checks to pass before merge"
echo "  - Require linear history (no merge commits)"
echo "  - No force pushes"
echo "  - No branch deletions"
echo "  - Admins not enforced (allows the release bot to push version bumps)"
