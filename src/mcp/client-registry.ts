interface ClosableMcpClient {
  close: () => Promise<void>;
}

export class McpClientRegistry {
  private readonly clients = new Set<ClosableMcpClient>();

  add(client: ClosableMcpClient): void {
    this.clients.add(client);
  }

  async closeAll(): Promise<void> {
    const clients = Array.from(this.clients);
    this.clients.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}
