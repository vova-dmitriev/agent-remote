import { SESSION_SHELL_CLASS, ShellLayout } from "../config/values"
import type { SessionFrameProps } from "./application-shell.types"

/** The compact session frame on its own, for the session skeleton before the shell's data exists. */
export function SessionFrame({ children, testId }: SessionFrameProps) {
  return (
    <main className={SESSION_SHELL_CLASS} data-shell-layout={ShellLayout.Session} aria-busy="true" data-testid={testId}>
      {children}
    </main>
  )
}
