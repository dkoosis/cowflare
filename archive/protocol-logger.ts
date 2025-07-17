// File: src/protocol-logger.ts

import type { Env, RTMTransaction } from './types';

export class ProtocolLogger {
  private env: Env;
  private sessionId: string;

  constructor(env: Env, sessionId: string) {
    this.env = env;
    this.sessionId = sessionId;
  }

  async logTransaction(tx: Omit<RTMTransaction, 'sessionId'>) {
    const transaction: RTMTransaction = {
      ...tx,
      sessionId: this.sessionId,
    };
    const key = `protocol:${this.sessionId}:${tx.timestamp}_${tx.transactionId}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(transaction), {
      expirationTtl: 86400,
    });
  }

  static async getSessionTransactions(env: Env, sessionId: string): Promise<RTMTransaction[]> {
    const list = await env.AUTH_STORE.list({ prefix: `protocol:${sessionId}` });
    const transactions: RTMTransaction[] = [];
    for (const key of list.keys) {
      const data = await env.AUTH_STORE.get(key.name);
      if (data) {
        transactions.push(JSON.parse(data));
      }
    }
    return transactions.sort((a, b) => a.timestamp - b.timestamp);
  }
}