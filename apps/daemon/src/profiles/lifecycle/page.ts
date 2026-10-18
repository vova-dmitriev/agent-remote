import { createHash } from 'node:crypto';
import {
  ErrorCode,
  ProfileLimits,
  ProfileRequestKind,
  type ProfileList,
  type ProfileRequest,
  type ProfileResponse,
} from '../../../../../packages/protocol/src/index.js';

export function profileListPage(
  list: ProfileList,
  request: Extract<ProfileRequest, { kind: typeof ProfileRequestKind.ListPage }>,
): Extract<ProfileResponse, { kind: typeof ProfileRequestKind.ListPage }> {
  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        profiles: list.profiles.map(({ id, version }) => [id, version]),
        operations: list.operations.map(({ id, version }) => [id, version]),
        defaults: list.defaults,
      }),
    )
    .digest('hex');

  if (
    (request.offset > 0 && request.revision !== revision) ||
    (request.revision && request.revision !== revision)
  ) {
    throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
  }

  const data: ProfileList = { ...list, profiles: [], operations: [] };
  const total = list.profiles.length + list.operations.length;

  if (request.offset > total) {
    throw new Error(ErrorCode.INVALID_REQUEST);
  }

  let bytes = Buffer.byteLength(JSON.stringify(data));
  let index = request.offset;

  for (; index < total; index++) {
    const profile = list.profiles[index];
    const operation = list.operations[index - list.profiles.length];
    const record = profile ?? operation!;
    const size = Buffer.byteLength(JSON.stringify(record)) + 1;

    if (bytes + size > ProfileLimits.PageBytes) {
      break;
    }

    if (profile) {
      data.profiles.push(profile);
    } else {
      data.operations.push(operation!);
    }

    bytes += size;
  }

  if (index === request.offset && index < total) {
    throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  }

  return { kind: ProfileRequestKind.ListPage, data, revision, nextOffset: index < total ? index : null };
}
