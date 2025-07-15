// File: src/rtm-api.ts
import type { RTMResponse, RTMTask, RTMTaskSeries, RTMList } from './types';

export class RtmApi {
  private apiKey: string;
  private sharedSecret: string;
  private baseUrl = 'https://api.rememberthemilk.com/services/rest/';

  constructor(apiKey: string, sharedSecret: string) {
    console.log('[RtmApi] Constructor called', {
      hasApiKey: !!apiKey,
      hasSharedSecret: !!sharedSecret,
      apiKeyLength: apiKey?.length,
      sharedSecretLength: sharedSecret?.length
    });
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
  }

  private async generateSignature(params: Record<string, string>): Promise<string> {
    console.log('[RtmApi] generateSignature called with params:', Object.keys(params));
    
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
    const message = this.sharedSecret + paramString;
    
    console.log('[RtmApi] Signature params:', {
      sortedKeys,
      paramStringLength: paramString.length,
      messageLength: message.length,
      firstParam: sortedKeys[0] ? `${sortedKeys[0]}=${params[sortedKeys[0]]}` : 'none'
    });
    
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log('[RtmApi] Generated signature:', signature);
    return signature;
  }

  async makeRequest<T = any>(method: string, params: Record<string, string> = {}): Promise<T> {
    console.log('[RtmApi] makeRequest called:', {
      method,
      params: Object.keys(params).reduce((acc, key) => {
        acc[key] = key === 'auth_token' ? '[REDACTED]' : params[key];
        return acc;
      }, {} as Record<string, string>)
    });
    
    const allParams: Record<string, string> = {
      ...params,
      api_key: this.apiKey,
      method,
      format: 'json'
    };

    allParams.api_sig = await this.generateSignature(allParams);

    const url = new URL(this.baseUrl);
    Object.entries(allParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    console.log('[RtmApi] Making request to:', {
      url: url.pathname,
      method,
      paramCount: Object.keys(allParams).length,
      hasApiKey: !!allParams.api_key,
      hasSignature: !!allParams.api_sig
    });

    try {
      const response = await fetch(url.toString());
      const responseText = await response.text();
      
      console.log('[RtmApi] Raw response:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: responseText.length,
        preview: responseText.substring(0, 200)
      });

      let data: RTMResponse<T>;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[RtmApi] Failed to parse JSON:', {
          error: parseError,
          responseText: responseText.substring(0, 500)
        });
        throw new Error(`Invalid JSON response from RTM API: ${responseText.substring(0, 100)}...`);
      }

      console.log('[RtmApi] Parsed response:', {
        stat: data.rsp?.stat,
        hasData: !!data.rsp,
        error: data.rsp?.err,
        dataKeys: data.rsp ? Object.keys(data.rsp).filter(k => k !== 'stat') : [],
        fullResponse: JSON.stringify(data.rsp).substring(0, 500)
      });

      if (data.rsp.stat !== 'ok') {
        console.error('[RtmApi] RTM API Error:', {
          error: data.rsp.err,
          method,
          params: Object.keys(params)
        });
        throw new Error(`RTM API Error: ${data.rsp.err?.msg} (${data.rsp.err?.code})`);
      }

      return data.rsp;
    } catch (error) {
      console.error('[RtmApi] Request failed:', {
        error: error instanceof Error ? error.message : String(error),
        method,
        hasApiKey: !!this.apiKey,
        hasSharedSecret: !!this.sharedSecret
      });
      throw error;
    }
  }

  async getFrob(): Promise<string> {
    console.log('[RtmApi] getFrob called');
    try {
      const response = await this.makeRequest<{ frob: string }>('rtm.auth.getFrob');
      console.log('[RtmApi] getFrob response:', { 
        frob: response.frob,
        frobLength: response.frob?.length,
        responseKeys: Object.keys(response)
      });
      return response.frob;
    } catch (error) {
      console.error('[RtmApi] getFrob error:', error);
      throw error;
    }
  }

  async getAuthUrl(frob: string, perms: 'read' | 'write' | 'delete' = 'delete'): Promise<string> {
    console.log('[RtmApi] getAuthUrl called:', { frob, perms, frobLength: frob?.length });
    
    const params = {
      api_key: this.apiKey,
      frob,
      perms
    };

    const signature = await this.generateSignature(params);
    const url = new URL('https://www.rememberthemilk.com/services/auth/');
    
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    url.searchParams.append('api_sig', signature);

    const authUrl = url.toString();
    console.log('[RtmApi] Generated auth URL:', {
      baseUrl: url.origin + url.pathname,
      paramCount: url.searchParams.toString().split('&').length,
      perms,
      urlLength: authUrl.length
    });
    return authUrl;
  }

  async getToken(frob: string): Promise<{ token: string; auth: any }> {
    console.log('[RtmApi] getToken called with frob:', {
      frobLength: frob?.length,
      frobPrefix: frob?.substring(0, 8)
    });
    
    try {
      const response = await this.makeRequest<{ auth: { token: string, user: any } }>('rtm.auth.getToken', { frob });
      
      console.log('[RtmApi] getToken FULL response:', {
        hasAuth: !!response.auth,
        hasToken: !!response.auth?.token,
        hasUser: !!response.auth?.user,
        authKeys: response.auth ? Object.keys(response.auth) : [],
        userKeys: response.auth?.user ? Object.keys(response.auth.user) : [],
        tokenLength: response.auth?.token?.length,
        userId: response.auth?.user?.id,
        username: response.auth?.user?.username,
        fullname: response.auth?.user?.fullname,
        fullAuthStructure: JSON.stringify(response.auth, null, 2)
      });
      
      return {
        token: response.auth.token,
        auth: response.auth
      };
    } catch (error) {
      console.error('[RtmApi] getToken error:', {
        error: error instanceof Error ? error.message : String(error),
        frob: frob?.substring(0, 8) + '...'
      });
      throw error;
    }
  }

  async testCredentials(): Promise<{ valid: boolean; error?: string }> {
    console.log('[RtmApi] testCredentials called');
    try {
      const frob = await this.getFrob();
      console.log('[RtmApi] testCredentials: Successfully got frob');
      return { valid: true };
    } catch (error) {
      console.error('[RtmApi] testCredentials failed:', error);
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async checkToken(authToken: string): Promise<any> {
    console.log('[RtmApi] checkToken called');
    try {
      const response = await this.makeRequest('rtm.auth.checkToken', { auth_token: authToken });
      console.log('[RtmApi] checkToken response:', {
        hasAuth: !!response.auth,
        hasUser: !!response.auth?.user,
        userId: response.auth?.user?.id,
        username: response.auth?.user?.username,
        fullResponse: JSON.stringify(response, null, 2)
      });
      return response;
    } catch (error) {
      console.error('[RtmApi] checkToken error:', error);
      throw error;
    }
  }

  async createTimeline(authToken: string): Promise<string> {
    console.log('[RtmApi] createTimeline called');
    const response = await this.makeRequest<{ timeline: string }>('rtm.timelines.create', { auth_token: authToken });
    console.log('[RtmApi] createTimeline response:', { 
      timeline: response.timeline,
      responseKeys: Object.keys(response)
    });
    return response.timeline;
  }
  
  // ADDED: Missing getTasks method to satisfy rtm-mcp.ts
  async getTasks(authToken: string, list_id?: string, filter?: string): Promise<{ lists: { list: RTMList[] } }> {
    const params: Record<string, string> = { auth_token: authToken };
    if (list_id) params.list_id = list_id;
    if (filter) params.filter = filter;
    return this.makeRequest('rtm.tasks.getList', params);
  }

  // ADDED: Missing addTask method to satisfy rtm-mcp.ts
  async addTask(authToken: string, timeline: string, name: string, list_id?: string): Promise<any> {
    const params: Record<string, string> = { auth_token: authToken, timeline, name };
    if (list_id) params.list_id = list_id;
    return this.makeRequest('rtm.tasks.add', params);
  }

  formatLists(lists: any): string {
    if (!lists) return 'No lists found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    return listArray.map(list => `- ${list.name} (ID: ${list.id})${list.smart === '1' ? ' [Smart List]' : ''}`).join('\n');
  }

  formatTasks(lists: any): string {
    if (!lists) return 'No tasks found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    const tasks: string[] = [];
    let totalTasks = 0;
    listArray.forEach((list: { id: string, taskseries?: RTMTaskSeries | RTMTaskSeries[] }) => {
      if (!list.taskseries) return;
      const seriesArray = Array.isArray(list.taskseries) ? list.taskseries : [list.taskseries];
      seriesArray.forEach((series: RTMTaskSeries) => {
        if (!series.task) return;
        const taskArray = Array.isArray(series.task) ? series.task : [series.task];
        taskArray.forEach((task: RTMTask) => {
          if (task.completed) return;
          tasks.push(`- ${series.name} (List: ${list.id}, Task: ${task.id})`);
          totalTasks++;
        });
      });
    });
    return tasks.length > 0 ? tasks.join('\n') : 'No active tasks found';
  }
}