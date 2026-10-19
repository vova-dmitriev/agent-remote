import { EventType } from '@protocol';
import { attachmentSourceCurrent } from '../../attachments/content/source-current.js';
import { AttachmentService } from '../../attachments/service.js';
import type { Monitor } from '../../monitor/monitor.js';
import type { LocalServices } from '../../local/bootstrap/services.js';
import type { runtimeConfiguration } from '../../local/bootstrap/configuration.js';

type RuntimeConfiguration = Awaited<ReturnType<typeof runtimeConfiguration>>;

export function createAttachments(
  config: RuntimeConfiguration,
  directory: string,
  monitor: Monitor,
  localServices: LocalServices,
) {
  const attachments = new AttachmentService({
    ...(config.relay ? { relayUrl: config.relay.relayUrl, deviceToken: config.relay.deviceToken } : {}),
    local: localServices.media,
    directory,
    current: (source) => {
      const current = monitor.session(source.id);

      return attachmentSourceCurrent(current, source);
    },
  });

  const retryExports = () =>
    attachments.retryExports((source, message) => {
      const current = monitor.session(source.id);

      if (attachmentSourceCurrent(current, source)) {
        monitor.publish(source.id, EventType.Message, message);
      }
    });

  return { attachments, retryExports };
}
