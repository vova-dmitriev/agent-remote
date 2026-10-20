/**
 * The version of the frames that cross the daemon ↔ relay WebSocket.
 *
 * Rule: adding or changing a field in any frame between the daemon and the relay requires bumping `Current`.
 * Both sides parse frames strictly, so an unannounced field breaks the older peer.
 *
 * The daemon sends its version in the device `Auth` frame; a daemon that sends none speaks version 1. The relay
 * accepts `MinimumSupported` through `Current`, rejects anything else with `PROTOCOL_UNSUPPORTED` and close code
 * 4004, and repeats the negotiated version in `Authenticated` only to a daemon that sent one.
 *
 * From version 2 on, versioning removes release-order constraints: capabilities and frame changes can be gated on
 * the negotiated version instead of a one-time release order (as `subagentHistory` needed: relay before daemons).
 * Introducing the field itself still needs one: a relay older than version 2 rejects an `Auth` frame that carries
 * `protocolVersion`, so such relays must be upgraded before daemons that send it (see docs/desktop.md).
 * The relay strips unknown `Auth` fields from now on, so a later field never repeats that.
 */
export const RELAY_PROTOCOL = { Current: 5, MinimumSupported: 1 } as const;

/** The first version that carries each later frame change; gate on the negotiated version. */
export const RelayProtocolFeature = {
  /** `pinned` on snapshot sessions and the relay's `SessionPin` frame. */
  SessionPins: 3,
  /** The relay's `SessionRename` frame: the device renames the session in its agent. */
  SessionRename: 4,
  /** The relay's `FileRequest` frame and the device's `FileResult`: the app reads a file a session changed. */
  SessionFiles: 5,
} as const;

/** The version of a daemon that sends no `protocolVersion`. */
export const UNVERSIONED_RELAY_PROTOCOL = 1;

/** Whether the relay speaks a daemon's protocol version. */
export const supportsRelayProtocol = (version: number) =>
  version >= RELAY_PROTOCOL.MinimumSupported && version <= RELAY_PROTOCOL.Current;
