import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ErrorCode, RuleAction, rulesViewSchema, type RulesRequest } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"

const RULES_KEY = "rules"

function useClient() {
  const runtime = useRuntime()

  return {
    epoch: runtime.epoch,
    apply: (deviceId: string, request: RulesRequest) => {
      if (!runtime.client) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

      return runtime.client.rules(deviceId, request)
    },
  }
}

/** The device's rules: every project, and the given session's own and inherited rules. */
export function useRulesView(deviceId: string, sessionId: string | null, enabled: boolean) {
  const client = useClient()

  return useQuery({
    queryKey: [RULES_KEY, client.epoch, deviceId, sessionId],
    queryFn: async () => rulesViewSchema.parse(await client.apply(deviceId, { action: RuleAction.View, sessionId })),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** Changes a rule on the device, then re-reads every rules view. */
export function useRulesChange(deviceId: string) {
  const client = useClient()
  const queries = useQueryClient()

  return useMutation({
    mutationFn: (request: RulesRequest) => client.apply(deviceId, request),
    onSuccess: () => queries.invalidateQueries({ queryKey: [RULES_KEY] }),
  })
}
