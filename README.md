# MARICODE

A Mac workspace for Claude and Codex coding sessions, with a remote web client.

**MARICODE 1.0.0 is available.** [Download the Apple Silicon Mac DMG](https://github.com/wi202im/MARICODE/releases/download/v1.0.0/MARICODE-1.0.0-arm64.dmg) or see the [release notes, sources and checksums](https://github.com/wi202im/MARICODE/releases/tag/v1.0.0). HAPI 0.33.3 and Node are included.

## What it does

- Organize projects, workspaces and AI sessions in one window.
- Work directly in an existing folder or choose a Git branch/worktree.
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

- No Intel Mac build, App Store release, Developer ID notarization or automatic updater.
- No QR pairing, multiple account selection for the same AI, or cross-machine native session migration.
- AI settings and approval choices are limited to the capabilities exposed by the provider and HAPI; not every upstream AI feature is supported.
- Actual Codex question UI, full sub-agent lifecycle, a clean second Mac installation and long sleep/wake behavior have not all been verified.
- The release app has been tested for native local connection and a Codex session through response, stop and resume. The latest DMG passed image and mounted-app signature verification, and its installation disk contents were confirmed in Finder. A clean second Mac installation remains unverified.

## License

MARICODE product code is [AGPL-3.0-only](LICENSE). Third-party notices and licenses retain their own terms. This source tree contains only the selected product and tests, without prior private history, account profiles, sessions or machine configuration.
