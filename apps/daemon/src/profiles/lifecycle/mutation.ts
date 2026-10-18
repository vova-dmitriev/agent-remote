import { ProfileAction, type ProfileMutation } from '../../../../../packages/protocol/src/index.js';
import type { ProfileRegistry } from '../registry.js';

export function mutateProfile(registry: ProfileRegistry, request: ProfileMutation) {
  switch (request.action) {
    case ProfileAction.Create:
      return registry.create(request.input);
    case ProfileAction.Rename:
      return registry.update(request.profileId, request.expectedVersion, { label: request.label });
    case ProfileAction.Disable:
      return registry.update(request.profileId, request.expectedVersion, { enabled: false });
    case ProfileAction.Enable:
      return registry.update(request.profileId, request.expectedVersion, { enabled: true });
    case ProfileAction.Remove:
      return registry.beginRemoval(request.profileId, request.expectedVersion);
    case ProfileAction.SetDefault:
      registry.setDefault(request.profileId, request.expectedVersion);

      return registry.get(request.profileId);
  }
}
