// File: src/protocol-logger.ts

import type { Env, McpTransaction } from './types';

export class ProtocolLogger {
  private env: Env;
  private sessionId: string;

  constructor(env: Env, sessionId: string) {
    this.env = env;
    this.sessionId = sessionId;
  }

  async logTransaction(tx: Omit<McpTransaction, 'sessionId'>) {
    const transaction: McpTransaction = {
      ...tx,
      sessionId: this.sessionId,
    };
    const key = `protocol:${this.sessionId}:${tx.timestamp}_${tx.transactionId}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(transaction), {
      expirationTtl: 86400,
    });
  }

  static async getSessionTransactions(env: Env, sessionId: string): Promise<McpTransaction[]> {
    const list = await env.AUTH_STORE.list({ prefix: `protocol:${sessionId}` });
    const transactions: McpTransaction[] = [];
    for (const key of list.keys) {
      const data = await env.AUTH_STORE.get(key.name);
      if (data) {
        transactions.push(JSON.parse(data));
      }
    }
    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }
}