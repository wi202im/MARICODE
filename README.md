# Maricode

A Mac workspace for Claude and Codex coding sessions, with a remote web client.

**Maricode 1.2.5** [Download the Apple Silicon Mac DMG](https://github.com/wi202im/MARICODE/releases/download/v1.2.5/MARICODE-1.2.5-arm64.dmg) or see the [release notes, sources and checksums](https://github.com/wi202im/MARICODE/releases/tag/v1.2.5). HAPI 0.33.3 and Node are included.

**1.2.5 update:** Preserves settings, project registrations and conversations created in 1.1.0. This version does not run the 1.1.0 full reset. Finish active work and quit the previous app before replacing it.


App, menu and Dock names use **Maricode**; the native title bar displays the installed version. HAPI corresponding source is provided as a separate release attachment, with licenses and notices retained inside the app.

## What it does

- Organize projects, workspaces and AI sessions in one window. A sole default workspace shows its sessions directly under the project; additional workspaces keep their location groups.
- Work directly in an existing folder or choose a Git branch/worktree. Start a general conversation without choosing a project; its CLI working folder is managed separately by the app.
- Default new sessions to the most recent AI in the same workspace, carrying over supported model/reasoning settings without copying approval grants.
- Import selected local Claude Code or Codex conversations for the project, preserve the originals and automatically resume the copied native session through HAPI.
- Read conversations, tool activity and file changes; answer questions and approval requests near the composer.
- Connect each AI to its existing official CLI settings and login; no app-owned AI account copies are created.
- Inspect Git diffs, hand recent conversation text to another AI as a draft, or branch supported Codex conversations at a message.
- Use model/reasoning/access controls, supported Codex Fast/plan options, context usage, command/skill suggestions, conversation search and in-app turn alerts.
- Connect another device with a short-lived one-time code, without putting a long-lived token in a URL.
- Attach files or paste images/Finder files, preview them and remove individual attachments.
- Work on this Mac in the native app. Optionally let other devices in over Tailscale: they use a browser or an installable PWA (one window per server), connected with a QR or one-time code.

## Install and use

Apple Silicon Mac; build target macOS 14 or newer. The app and DMG are **Developer ID signed and Apple notarized**, with attached notarization tickets. Claude/Codex CLI installation and official subscription login are separate. Tailscale is optional for same-LAN access and required for the Tailscale connection path.

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

## Verification and limitations

- Version 1.2.5 includes updated automated and synthetic UI checks; see the release notes for results. Earlier isolated real-engine tests on the included HAPI/Node versions exercised Claude/Codex responses, permissions, imported-context recall, Claude Bypass retention, Codex conversation branching, handoff and attachment responses. UI checks used headless Chrome at desktop/mobile widths.
- CLI-only commands open the same HAPI session in an official terminal UI. The previous MCP/plugin/account/diagnostic command cards have been removed. Actual terminal handoff and return still need live verification.
- No Intel Mac build or App Store release. The app downloads a verified DMG; replacing the installed app is manual and preserves the external data directory.
- Each AI uses one connected official CLI settings location. Changing that connection is blocked while its sessions are active or unconfirmed.
- The Mac app shows a QR (Tailscale install link with the one-time code); no cross-machine automatic session synchronization, MCP OAuth/stdio editing, built-in terminal or subscription quota display. Connection codes still require an accessible LAN/Tailscale server.
- Import does not copy credentials, MCP/settings, memory or attachment files. Originals and copies diverge after import. Codex subfolder discovery has automated coverage; resuming those specific subfolder conversations remains unverified.
- AI settings and approval choices depend on provider/HAPI support. Fast/plan option values were verified at the server; their actual response differences were not. Claude does not support the exposed per-message branching flow.
- A failed resume can recover after the Runner and Hub confirm it did not start; ambiguous requests are never automatically resent. Forced backend termination with unresolved state, or a settings change before engine readiness, may still require manual recovery.
- Clean second-Mac installation, company records, long sleep/wake, full sub-agent lifecycle and all new controls/shortcuts in native WKWebView remain unverified. Source and headless-engine checks are not a claim that those workflows have passed.

## License

MARICODE product code is [AGPL-3.0-only](LICENSE). Third-party notices and licenses retain their own terms. This source tree contains only the selected product and tests, without prior private history, account profiles, sessions or machine configuration.
