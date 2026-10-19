import {
  ErrorCode,
  ProfileRequestKind,
  profileRequestSchema,
  profileResponseSchema,
  type ExecutionProfileAccess,
  type ProfileRequest,
  type ProfileResponse,
} from '@protocol';

function responseRecords(response: ProfileResponse) {
  if (response.kind === ProfileRequestKind.List || response.kind === ProfileRequestKind.ListPage) {
    return [...response.data.profiles, ...response.data.operations];
  }

  if (response.kind === ProfileRequestKind.Quota) {
    return response.data ? [response.data] : [];
  }

  return [response.data];
}

export class BoundProfileClient implements ExecutionProfileAccess {
  constructor(
    private deviceId: string,
    private exchange: (request: ProfileRequest) => Promise<unknown>,
    private current = () => true,
  ) {}

  async request(raw: ProfileRequest): Promise<ProfileResponse> {
    if (!this.current()) {
      throw new Error(ErrorCode.STALE_EPOCH);
    }

    const request = profileRequestSchema.parse(raw);
    const response = profileResponseSchema.parse(await this.exchange(request));

    if (!this.current()) {
      throw new Error(ErrorCode.STALE_EPOCH);
    }

    if (response.kind !== request.kind) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const records = responseRecords(response);

    if (records.some((record) => record.deviceId !== this.deviceId)) {
      throw new Error(ErrorCode.ACCESS_DENIED);
    }

    return response;
  }
}
