# Native Desktop image paths on macOS

The reported Desktop user item includes a native `localImage` field and its original JPEG still exists. The reader rejected `/tmp/...` because macOS resolves it to `/private/tmp/...`; ordinary symlink prevention incorrectly included the system alias. No text-path extraction is needed.

- [x] Reproduce the original JPEG rejection and failing `/tmp` and `/var` filesystem tests.
- [x] Accept only the Darwin system aliases with exact canonical-path matching. Preserve owner, regular-file, size, inode, timestamp and no-follow guards.
- [x] Verify that nested file/directory symlinks remain rejected; verify preview, viewer, original-byte download and reload through the real daemon/relay/browser with a synthetic Desktop history image.
- [x] Verify the refreshed personal service imports the reported original image and returns matching JPEG bytes through authenticated public download.
- [x] Complete regression checks, package verification and status records. No commits.

The regression suite first failed twice and then passed. The full unit/integration suite passed 337 cases; 18 targeted attachment/runtime browser cases passed. Independent review found no actionable security or regression issues. Native Desktop historical-image observation is distinct from the still-unaccepted disposable Desktop attachment-input probe.

Final evidence: all 90 mobile browser E2E cases passed, including both recent Desktop regressions. TypeScript, source gates, production build and companion archive verification passed. The running service imported the exact reported native JPEG into its original message; authenticated public download returned the original 37,176 bytes with `image/jpeg`. Public/local health, current bundle, bot menu, WebSocket, pairing fingerprint and companion heartbeat passed. The previous duplicate-message repair remained intact.
