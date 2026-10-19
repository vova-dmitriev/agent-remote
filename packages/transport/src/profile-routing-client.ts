import {
  ErrorCode,
  HttpRequestMethod,
  profileRoutingSettingsSchema,
  profileRoutingSnapshotSchema,
  saveProfileRoutingSchema,
  type ProfileRoutingAccess,
  type SaveProfileRouting,
} from '@protocol';

type RoutingExchange = (method: HttpRequestMethod, path: string, body?: unknown) => Promise<unknown>;

export class BoundProfileRoutingClient implements ProfileRoutingAccess {
  constructor(
    private readonly deviceId: string,
    private readonly exchange: RoutingExchange,
    private readonly current: () => boolean = () => true,
  ) {}

  async get() {
    const value = await this.request(HttpRequestMethod.Get);
    const snapshot = profileRoutingSnapshotSchema.parse(value);

    this.assertDevice(snapshot.settings.deviceId);

    if (
      snapshot.observations.some(
        (item) => item.deviceId !== this.deviceId || item.ownerId !== snapshot.settings.ownerId,
      )
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    return snapshot;
  }

  async save(raw: SaveProfileRouting) {
    const input = saveProfileRoutingSchema.parse(raw);
    const settings = profileRoutingSettingsSchema.parse(await this.request(HttpRequestMethod.Put, input));

    this.assertDevice(settings.deviceId);

    return settings;
  }

  private async request(method: HttpRequestMethod, body?: unknown) {
    this.assertCurrent();

    const response = await this.exchange(
      method,
      `/devices/${encodeURIComponent(this.deviceId)}/profile-routing`,
      body,
    );

    this.assertCurrent();

    return response;
  }

  private assertDevice(deviceId: string) {
    this.assertCurrent();

    if (deviceId !== this.deviceId) {
      throw new Error(ErrorCode.ACCESS_DENIED);
    }
  }

  private assertCurrent() {
    if (!this.current()) {
      throw new Error(ErrorCode.STALE_EPOCH);
    }
  }
}
