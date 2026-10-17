import type { ConnectorDescriptor } from "@protocol"
import type { Device } from "@/shared/api"

export interface DeviceAccessProps {
  devices: Device[]
  connectors: ConnectorDescriptor[]
  revoke: (id: string) => void
}
