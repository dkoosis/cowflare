/**
 * @file rtm-api/client.ts
 * @description Clean RTM API client implementation
 */

import { Env, RTMError } from '../types';
import { Logger } from '../utils/logger';
import { RetryManager } from '../utils/retry-manager';

export class RTMApiClient {
  private readonly baseUrl = 'https://api.rememberthemilk.com/services/rest/';
  
  constructor(
    private env: Env,
    private logger: Logger
  ) {}

  /**
   * Makes an authenticated RTM API request
   */
  async request<T = any>(
    method: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const allParams = {
      method,
      api_key: this.env.RTM_API_KEY,
      format: 'json',
      ...params
    };

    // Add signature
    allParams.api_sig = await this.generateSignature(allParams);

    // Build URL
    const url = new URL(this.baseUrl);
    Object.entries(allParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    // Make request with retry
    const response = await RetryManager.withRetry(
      () => this.executeRequest(url.toString()),
      {
        maxAttempts: 3,
        shouldRetry: (error) => {
          // Retry on network errors or 5xx status codes
          return error.message.includes('fetch failed') ||
                 error.message.includes('status: 5');
        }
      }
    );

    return response;
  }

  /**
   * Initiates OAuth authentication flow
   */
  async initiateAuth(): Promise<{ frob: string; authUrl: string }> {
    const response = await this.request<{ frob: string }>('rtm.auth.getFrob');
    
    const authParams: Record<string, string> = {
      api_key: this.env.RTM_API_KEY,
      perms: 'write',
      frob: response.frob
    };

    authParams.api_sig = await this.generateSignature(authParams);
    
    const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}`;

    return { frob: response.frob, authUrl };
  }

  /**
   * Exchanges frob for auth token
   */
  async exchangeFrobForToken(frob: string) {
    const response = await this.request<{ auth: any }>('rtm.auth.getToken', { frob });
    return response.auth;
  }

  /**
   * Creates a timeline for undoable operations
   */
  async createTimeline(authToken: string): Promise<string> {
    const response = await this.request<{ timeline: string }>('rtm.timelines.create', {
      auth_token: authToken
    });
    return response.timeline;
  }

  /**
   * Executes the actual HTTP request
   */
  private async executeRequest(url: string): Promise<any> {
    const startTime = Date.now();
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new RTMError(
          `HTTP error ${response.status}`,
          'HTTP_ERROR',
          { status: response.status, statusText: response.statusText }
        );
      }

      const data = await response.json();
      
      if (data.rsp?.stat !== 'ok') {
        throw new RTMError(
          data.rsp?.err?.msg || 'Unknown RTM API error',
          data.rsp?.err?.code,
          data.rsp?.err
        );
      }

      const duration = Date.now() - startTime;
      this.logger.debug('RTM API request successful', {
        method: data.rsp?.method,
        duration
      });

      return data.rsp;
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      this.logger.error('RTM API request failed', {
        url,
        error: error.message,
        duration
      });
      
      throw error;
    }
  }

  /**
   * Generates MD5 signature for RTM API
   */
  private async generateSignature(params: Record<string, string>): Promise<string> {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
    const signatureBase = this.env.RTM_SHARED_SECRET + paramString;

    const encoder = new TextEncoder();
    const data = encoder.encode(signatureBase);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}