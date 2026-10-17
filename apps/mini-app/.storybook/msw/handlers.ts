import { http, HttpResponse } from "msw"

export const handlers = [http.post("http://api.storybook.local/pair/claim", () => HttpResponse.json({ claimId: "synthetic-claim" }))]
