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
 * Capabilities added from now on can be gated on the negotiated version instead of a one-time release order
 * (as `subagentHistory` needed: relay before daemons).
 */
export const RELAY_PROTOCOL = { Current: 2, MinimumSupported: 1 } as const;

/** The version of a daemon that sends no `protocolVersion`. */
export const UNVERSIONED_RELAY_PROTOCOL = 1;

/** Whether the relay speaks a daemon's protocol version. */
export const supportsRelayProtocol = (version: number) =>
  version >= RELAY_PROTOCOL.MinimumSupported && version <= RELAY_PROTOCOL.Current;
