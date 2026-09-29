# Parallel Code Custom: personal macOS release

This fork is an independent personal distribution. Its release identity is
deliberately separate from upstream Parallel Code:

| Setting               | Custom value                                             |
| --------------------- | -------------------------------------------------------- |
| Product name          | `Parallel Code Custom`                                   |
| App ID                | `com.parallel-code.custom`                               |
| Package metadata name | `parallel-code-custom`                                   |
| macOS profile         | `~/Library/Application Support/Parallel Code Custom`     |
| Development profile   | `~/Library/Application Support/Parallel Code Custom-dev` |
| URL scheme            | `parallelcode-custom://`                                 |
| Updates               | Manual; no release feed is contacted                     |

The official app and its profile are never removed or overwritten by the build
script. Keep the official app until real-project testing and rollback checks are
complete.

## Build and sign on Apple Silicon

Install dependencies with `npm ci`, then run:

```sh
npm run build:custom:mac
```

The script builds an arm64 `.app`, signs it and verifies the complete bundle.
By default it prefers the local identity:

```text
PasteBar Lite Local Code Signing
```

Override it with `CUSTOM_SIGN_IDENTITY`. Use `-` explicitly for ad-hoc signing:

```sh
CUSTOM_SIGN_IDENTITY="My Local Identity" npm run build:custom:mac
CUSTOM_SIGN_IDENTITY=- npm run build:custom:mac
```

When the preferred identity is unavailable the script warns and falls back to
ad-hoc signing. Both modes are for local personal installation only: neither is
Apple-notarized or suitable for distributing to other Macs.

The default output is under `release/custom-macos-arm64/`. To test without
replacing anything, open the built app from that directory. To install it,
quit any running Custom build and copy **Parallel Code Custom.app** to
`/Applications`; do not rename it to or copy it over `Parallel Code.app`.

## Updating the personal release

Settings intentionally displays the build as manual-update-only. A release
upgrade is: merge or rebase the fork, run checks, rebuild with the command
above, quit the existing Custom app and replace only `Parallel Code Custom.app`.
The profile remains in the independent Custom data directory.

## Protocol compatibility

This app registers `parallelcode-custom://`, not upstream's `parallelcode://`.
An external Super Productivity integration must be configured to send, for
example:

```text
parallelcode-custom://new-task?spTaskId=TASK_ID
```

This separation prevents either app from taking ownership of the other's URL
scheme.
