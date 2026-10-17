# Session input, labels and activity ordering

User scope: ordinary new Claude terminals must be controllable, newest message sorts first, clicking an open session title allows renaming in Agent Remote.

1. Persist owner/device/source-scoped title aliases and owner/device/session message times. Use native message timestamps, never status polling or event ingestion time. Fence mutations against native snapshots and device revocation. Preserve aliases across reconnects.
2. Add title editor with explicit Save/Cancel, no automatic retries, generation/connection fences, localized errors, synthetic stories and browser coverage.
3. Integrate interactive `claude` terminal startup with the existing owned PTY launcher, preserving local flags and using the original executable for non-interactive commands. Do not attach to arbitrary terminal input or fork an active native conversation. Existing ordinary terminals need one explicit exit/resume in the owned launcher.
4. Test synthetic process startup, owner/generation guards, alias persistence, native timestamps, browser ordering and title editing. Run source gates and full regression, rebuild package, restart the personal service once and verify permanent ingress/pairing.

Follow-up authentication correction (previous user report): access tokens retain a 15-minute TTL. A separate random HttpOnly/Secure/SameSite=Strict cookie references a hashed, 30-day absolute browser session in PostgreSQL. Same-origin-only refresh creates new access tokens; stale Telegram launch data is accepted only as a signed identity binding matching the authenticated browser session, never as login proof. Logout revokes linked access tokens and sockets. The frontend renews before expiry, restores stale-launch reloads through the cookie, and preserves selection/drafts during renewal. Authentication failure clears stale owner/session errors.

## User follow-up: one-click restart and reading position

The user ran the copied `claude --resume` inside an already open zsh that had not sourced the new integration. It remained a native hooks-only process. Add an explicit owned `restart_session` command and UI button. The Mac resolves the native session's exact PID/start time/current executable/cwd from owner-only Claude metadata, revalidates before SIGTERM, waits for that exact process to exit, then launches the fixed managed entrypoint with the original session ID. Never accept PIDs, executables or arbitrary args from the client; never replay an uncertain restart. This user action explicitly authorizes the restart, including stopping its current turn. Reuse the original Agent Remote session identity after the native session exits and its managed wrapper binds.

Sort snapshots on the server as well as the UI so already open clients receive newest-message order. Preserve a bounded per-device/session reading anchor (message ID plus within-row offset), restore it after history arrives, and disable unconditional end anchoring. New events only follow when already at the bottom. Back/reopen/reload preserve the reading position; explicit marker/bottom navigation remains smooth and cancels restoration.
