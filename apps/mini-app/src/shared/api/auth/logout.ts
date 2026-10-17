interface SessionConnection {
  request(path: string, options: RequestInit): Promise<unknown>
  close(): void
}

export async function logoutSession(connection: SessionConnection) {
  try {
    await connection.request("/auth/logout", { method: "POST", body: "{}" })
  } finally {
    connection.close()
  }
}
