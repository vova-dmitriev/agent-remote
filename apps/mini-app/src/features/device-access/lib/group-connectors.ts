import type { ConnectorDescriptor } from "@protocol"

interface Status {
  state: ConnectorDescriptor["state"]
  reason: string | null
  count: number
}

interface Group {
  kind: ConnectorDescriptor["kind"]
  count: number
  statuses: Map<string, Status>
}

export function groupConnectors(connectors: readonly ConnectorDescriptor[]) {
  const groups = new Map<ConnectorDescriptor["kind"], Group>()
  const seen = new Set<string>()

  for (const connector of connectors) {
    if (seen.has(connector.connectorId)) continue
    seen.add(connector.connectorId)

    let group = groups.get(connector.kind)

    if (!group) {
      group = { kind: connector.kind, count: 0, statuses: new Map() }
      groups.set(connector.kind, group)
    }

    group.count++
    const key = JSON.stringify([connector.state, connector.reason])
    const status = group.statuses.get(key)

    if (status) status.count++
    else group.statuses.set(key, { state: connector.state, reason: connector.reason, count: 1 })
  }

  return [...groups.values()].map((group) => ({ ...group, statuses: [...group.statuses.values()] }))
}
