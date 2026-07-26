# Linear MCP

This repository configures Linear's official read-write MCP server in
`.codex/config.toml`. The configuration is shared; OAuth credentials are personal and must never
be committed.

## Connect

Trust this repository in Codex, then run:

```sh
codex mcp login linear
```

Complete the Linear OAuth flow in the browser, restart Codex or open a new repository session, and
check the connection with `codex mcp list` or `/mcp`.

## Backlog writes

Before creating or updating Linear data:

1. read the repository roadmap and current handoff;
2. present the proposed project, milestones, issues and relationships for review;
3. apply only the approved structure;
4. do not invent owners, deadlines, estimates or dependencies;
5. read the created objects back and report their identifiers.

Use the project-scoped `linear` connection for this repository. Keep tokens, OAuth responses and
local authentication storage outside the repository. `.codex` remains development-only and the
Factory excludes it from generated projects.
