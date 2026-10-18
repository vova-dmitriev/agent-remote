import type { ClientCommand, CommandResult } from "@protocol"
import type { ApplicationClient } from "@/shared/api"
import { RECEIPT_BATCH_SIZE } from "../values"

interface QueueReceipt {
  command: ClientCommand
  receipt: CommandResult | null
}

export async function readQueueReceipts(
  persistence: NonNullable<ApplicationClient["persistence"]>,
  commands: ClientCommand[],
): Promise<QueueReceipt[]> {
  const batch = await Promise.all(
    commands.slice(0, RECEIPT_BATCH_SIZE).map(async (command) => ({
      command,
      receipt: await persistence.readReceipt(command.commandId),
    })),
  )

  if (commands.length <= RECEIPT_BATCH_SIZE) return batch

  return [...batch, ...(await readQueueReceipts(persistence, commands.slice(RECEIPT_BATCH_SIZE)))]
}
