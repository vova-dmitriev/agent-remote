export const profileKeys = {
  all: ["execution-profiles"] as const,
  list: (epoch: number, deviceId: string) => ["execution-profiles", epoch, deviceId] as const,
}
