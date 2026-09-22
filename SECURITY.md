# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in things-mcp, please report it privately:

- Open a GitHub Security Advisory: **[Report a vulnerability](https://github.com/kierr/things-mcp/security/advisories/new)**

Please do not file public issues for security vulnerabilities.

## Scope

things-mcp reads from the local Things 3 SQLite database and writes via the `things:///` URL scheme. It runs entirely on the local machine and does not expose network services unless the `--http` flag is used.

### Auth token handling

The Things URL-scheme authentication token is read from `TMSettings` in the local database and cached in memory for the process lifetime. It is:

- Never logged, persisted to disk, or included in error output
- Only used to authenticate `things:///json` URL-scheme requests
- Discarded on process exit

If you have concerns about the auth token handling, please report via the advisory link above.
