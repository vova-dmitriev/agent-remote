import { ErrorCode, type AttachmentDescriptor } from "@protocol"
import type { ApplicationClient } from "@/shared/api"

type Persistence = NonNullable<ApplicationClient["persistence"]>
type Draft = Awaited<ReturnType<Persistence["readDraft"]>>

export class DraftState {
  private conflicted = false
  private saved: Draft | undefined
  private desired: Omit<Draft, "revision"> | undefined
  private reconciling: Promise<Draft> | undefined
  private writing: Promise<void> | undefined

  constructor(
    private persistence: Persistence,
    private sessionId: string,
    private generation: string,
    private current: () => boolean,
  ) {}

  load() {
    return this.read(false)
  }
  reconcile() {
    return this.read(true)
  }

  private read(reconcile: boolean): Promise<Draft> {
    if (this.reconciling) return this.reconciling
    const baseline = this.saved
    const desired = this.desired
    const contents = (draft: Omit<Draft, "revision">) => JSON.stringify({ text: draft.text, attachments: draft.attachments })

    const result = this.persistence.readDraft(this.sessionId).then((saved) => {
      if (!this.current()) throw new Error(ErrorCode.STALE_SESSION)
      this.saved = saved
      if (reconcile && baseline) {
        const matchesBaseline = contents(saved) === contents(baseline)
        const matchesDesired = desired && contents(saved) === contents(desired)
        const empty = !saved.text && !saved.attachments.length

        if (!matchesBaseline && !matchesDesired && !empty) {
          this.conflicted = true
          this.desired = undefined
          throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT)
        }

        if ((matchesDesired || empty) && this.desired === desired) this.desired = undefined
      } else this.conflicted = false

      return saved
    })

    const tracked = result.finally(() => {
      if (this.reconciling === tracked) this.reconciling = undefined
    })

    this.reconciling = tracked

    return tracked
  }

  update(text: string, attachments: AttachmentDescriptor[]) {
    this.desired = { text, attachments }
  }

  async flush(): Promise<void> {
    if (this.reconciling) await this.reconciling
    if (this.conflicted) throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT)

    if (this.writing) {
      await this.writing

      return this.flush()
    }

    if (!this.saved || !this.desired || !this.current()) return
    const desired = this.desired

    if (JSON.stringify(desired) === JSON.stringify({ text: this.saved.text, attachments: this.saved.attachments })) {
      this.desired = undefined

      return
    }

    this.writing = this.write(desired)

    try {
      await this.writing
    } finally {
      this.writing = undefined
    }
  }

  private async write(desired: Omit<Draft, "revision">) {
    try {
      const saved = await this.persistence.saveDraft(
        this.sessionId,
        this.generation,
        this.saved!.revision,
        desired.text,
        desired.attachments,
      )

      if (!this.current()) return
      this.saved = saved
      if (this.desired === desired) this.desired = undefined
    } catch (error) {
      if (error instanceof Error && error.message === ErrorCode.LOCAL_REVISION_CONFLICT && this.current()) {
        this.conflicted = true
        this.saved = await this.persistence.readDraft(this.sessionId)
        this.desired = undefined
      }

      throw error
    }
  }
}
