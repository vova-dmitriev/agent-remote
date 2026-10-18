import {
  ErrorCode,
  ProfileLimits,
  ProfileRequestKind,
  profileListSchema,
  type ProfileList,
  type ProfileRequest,
  type ProfileResponse,
} from '../../../../../packages/protocol/src/index.js';

export async function readProfilePages(
  send: (request: ProfileRequest) => Promise<ProfileResponse>,
): Promise<Extract<ProfileResponse, { kind: typeof ProfileRequestKind.List }>> {
  let data: ProfileList | undefined;
  let revision: string | undefined;
  let offset = 0;

  // Every nonempty page must advance by at least one bounded registry record.
  for (let page = 0; page <= ProfileLimits.ActiveProfiles * 2; page++) {
    const response = await send({
      kind: ProfileRequestKind.ListPage,
      offset,
      ...(revision ? { revision } : {}),
    });

    if (response.kind !== ProfileRequestKind.ListPage || (revision && response.revision !== revision)) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    revision = response.revision;

    if (!data) {
      data = { ...response.data, profiles: [], operations: [] };
    }

    data.profiles.push(...response.data.profiles);
    data.operations.push(...response.data.operations);

    if (
      data.profiles.length > ProfileLimits.ActiveProfiles ||
      data.operations.length > ProfileLimits.ActiveProfiles
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    if (response.nextOffset === null) {
      return { kind: ProfileRequestKind.List, data: profileListSchema.parse(data) };
    }

    if (response.nextOffset <= offset) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    offset = response.nextOffset;
  }

  throw new Error(ErrorCode.INVALID_FRAME);
}
