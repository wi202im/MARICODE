# MARICODE

A Mac workspace for Claude and Codex coding sessions, with a remote web client.

**MARICODE 1.0.6 is available.** [Download the Apple Silicon Mac DMG](https://github.com/wi202im/MARICODE/releases/download/v1.0.6/MARICODE-1.0.6-arm64.dmg) or see the [release notes, sources and checksums](https://github.com/wi202im/MARICODE/releases/tag/v1.0.6). HAPI 0.33.3 and Node are included.

## What it does

- Organize projects, workspaces and AI sessions in one window. A sole default workspace shows its sessions directly under the project; additional workspaces keep their location groups.
- Work directly in an existing folder or choose a Git branch/worktree. Start a general conversation without choosing a project; its CLI working folder is managed separately by the app.
- Default new sessions to the most recent AI in the same workspace, carrying over supported model/reasoning settings without copying approval grants.
- Import selected local Claude Code transcripts for the same working folder, preserve the originals and inspect a read-only history snapshot. Continue from the copied native session through HAPI.
- Read conversations, tool activity and file changes; answer questions and approval requests near the composer.
- Attach files or paste images/Finder files, preview them and remove individual attachments.
- Combine local, server and remote roles. Connect to multiple running computers over LAN or Tailscale.
- Use the native Mac app locally and a browser or optional PWA remotely.

## Install and use

Apple Silicon Mac; build target macOS 14 or newer. The DMG is ad-hoc signed, **not notarized**. Claude/Codex CLI installation and official subscription login are separate. Tailscale is optional for same-LAN access and required for the Tailscale connection path.

- [Installation, first session and remote access](apps/mac-launcher/USER-GUIDE.txt)
- [Build from source](apps/mac-launcher/BUILDING.txt)
- [Architecture and packaging](apps/mac-launcher/README.md)
- [Third-party notices and source delivery](apps/mac-launcher/NOTICES.txt)

No public relay or internet-facing server is provided. Do not put access tokens in URLs, issues or chat messages. Updating the app preserves its external data directory; unsent text and attachment drafts are only held in the current window.

Version 1.0.0 does not have the in-app update check; download this patch from the link above. See the release notes for changes and exact verification limits.

## Develop

Node.js 26.7+ is required; the tested version is 26.12.1. There are no npm dependencies for MARICODE's own source or tests.

```sh
npm test
```

Building the native app also requires Xcode Command Line Tools and the pinned HAPI artifacts described in the build guide. Tests use synthetic data and temporary folders; live AI account tests are not run by this command.

- [Product requirements](docs/goals.md)
- [Current state and next work](docs/handoff.md)
- [Contributor workflow](AGENTS.md)

## Current limitations

- No Intel Mac build, App Store release or Developer ID notarization. The app checks for updates and downloads a verified DMG; app replacement is manual.
- No QR pairing, multiple account selection for the same AI, or cross-machine native session migration.
- AI settings and approval choices are limited to the capabilities exposed by the provider and HAPI; not every upstream AI feature is supported.
- Actual Codex question UI, full sub-agent lifecycle, a clean second Mac installation and long sleep/wake behavior have not all been verified.
- Version 1.0.6 includes 269 automated checks. Claude session discovery now uses a paginated catalog, keeps problematic records visible with reasons, and prefers stored native titles. A real browser with synthetic records verified pagination, selection and import registration. Company records, native update shutdown-to-Finder handoff and installation over an existing app remain unverified.
- Claude record discovery checks an explicit selection, the inherited CLI environment, and one literal shell-profile path before using ~/.claude. Conditional settings, aliases, functions and multiple candidates require manual folder selection; shell files are never executed. The exact company-machine configuration and a signed-in Claude response recalling imported context remain unverified. Actual AI/MCP responses in the general-conversation flow also remain unverified.
- Import does not copy credentials, MCP/settings, memory or attachment files. The copied transcript and original diverge after import. Cross-machine import and external Codex transcript import are not supported.
- Version 1.0.0 was tested for native local connection and a Codex response/stop/resume. Installing this new DMG over an existing app, mounting it and real use on another Mac were not tested in this release.

## License

MARICODE product code is [AGPL-3.0-only](LICENSE). Third-party notices and licenses retain their own terms. This source tree contains only the selected product and tests, without prior private history, account profiles, sessions or machine configuration.
