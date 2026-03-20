class TerminalIO {
  private rawModeEnabled = false;
  private interruptHandler: (() => void) | null = null;

  setInterruptHandler(handler: (() => void) | null): void {
    this.interruptHandler = handler;
  }

  private beforeWriteCallback: (() => void) | null = null;

  setBeforeWriteCallback(cb: (() => void) | null): void {
    this.beforeWriteCallback = cb;
  }

  private skipCallback = false;

  stdoutWrite(text: string): void {
    if (text && this.beforeWriteCallback && !this.skipCallback) {
      this.skipCallback = true;
      this.beforeWriteCallback();
      this.skipCallback = false;
    }
    this.doStdoutWrite(text);
  }

  doStdoutWrite(text: string): void {
    process.stdout.write(text);
  }

  stderrWrite(text: string): void {
    if (text && this.beforeWriteCallback && !this.skipCallback) {
      this.skipCallback = true;
      this.beforeWriteCallback();
      this.skipCallback = false;
    }
    this.doStderrWrite(text);
  }

  doStderrWrite(text: string): void {
    process.stderr.write(text);
  }

  get isTTY(): boolean {
    return process.stdin.isTTY;
  }

  get isStdoutTTY(): boolean {
    return process.stdout.isTTY;
  }

  get isStderrTTY(): boolean {
    return process.stderr.isTTY;
  }

  get stdoutColumns(): number {
    return process.stdout.columns ?? 0;
  }

  setRawMode(enable: boolean): void {
    if (this.isTTY) {
      process.stdin.setRawMode(enable);
      this.rawModeEnabled = enable;
    }
  }

  restoreTerminal(): void {
    try {
      if (this.isStderrTTY) {
        this.stderrWrite("\x1B[?25h");
        this.stderrWrite("\r\x1B[2K");
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.rawModeEnabled) {
        this.setRawMode(false);
      }
    } catch {
      /* ignore */
    }
  }

  registerCleanup(): void {
    const cleanup = () => this.restoreTerminal();
    process.on("exit", cleanup);
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
    process.on("SIGINT", () => {
      if (this.interruptHandler) {
        this.interruptHandler();
      } else {
        cleanup();
        process.exit(130);
      }
    });
    process.on("uncaughtException", (err) => {
      cleanup();
      throw err;
    });
    process.on("unhandledRejection", (reason) => {
      cleanup();
      throw reason instanceof Error ? reason : new Error(String(reason));
    });
  }

  onStdinData(handler: (data: Buffer) => void): () => void {
    process.stdin.on("data", handler);
    return () => process.stdin.off("data", handler);
  }
}

export const terminal = new TerminalIO();
