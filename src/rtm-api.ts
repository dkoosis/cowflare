// File: src/rtm-api.ts
import type { RTMResponse, RTMTask, RTMTaskSeries } from './types';

export class RtmApi {
  private apiKey: string;
  private sharedSecret: string;
  private baseUrl = 'https://api.rememberthemilk.com/services/rest/';

  constructor(apiKey: string, sharedSecret: string) {
    console.log('[RtmApi] Constructor called', {
      hasApiKey: !!apiKey,
      hasSharedSecret: !!sharedSecret
    });
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
  }

  private async generateSignature(params: Record<string, string>): Promise<string> {
    console.log('[RtmApi] generateSignature called with params:', Object.keys(params));
    
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
    const message = this.sharedSecret + paramString;
    
    console.log('[RtmApi] Signature message length:', message.length);
    
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

    console.log('[RtmApi] Making request to:', url.pathname + url.search.replace(/auth_token=[^&]+/, 'auth_token=[REDACTED]'));

    try {
      const response = await fetch(url.toString());
      const data = (await response.json()) as RTMResponse<T>;

      console.log('[RtmApi] Response status:', response.status);
      console.log('[RtmApi] Response data:', {
        stat: data.rsp?.stat,
        hasData: !!data.rsp,
        error: data.rsp?.err
      });

      if (data.rsp.stat !== 'ok') {
        console.error('[RtmApi] RTM API Error:', data.rsp.err);
        throw new Error(`RTM API Error: ${data.rsp.err?.msg} (${data.rsp.err?.code})`);
      }

      return data.rsp;
    } catch (error) {
      console.error('[RtmApi] Request failed:', error);
      throw error;
    }
  }

  async getFrob(): Promise<string> {
    console.log('[RtmApi] getFrob called');
    const response = await this.makeRequest<{ frob: string }>('rtm.auth.getFrob');
    console.log('[RtmApi] getFrob response:', { frob: response.frob });
    return response.frob;
  }

  async getAuthUrl(frob: string, perms: 'read' | 'write' | 'delete' = 'delete'): Promise<string> {
    console.log('[RtmApi] getAuthUrl called:', { frob, perms });
    
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
    console.log('[RtmApi] Generated auth URL:', authUrl.replace(frob, '[FROB]'));
    return authUrl;
  }

  async getToken(frob: string): Promise<string> {
    console.log('[RtmApi] getToken called with frob');
    const response = await this.makeRequest<{ auth: { token: string, user: any } }>('rtm.auth.getToken', { frob });
    console.log('[RtmApi] getToken response:', {
      hasToken: !!response.auth?.token,
      user: response.auth?.user
    });
    return response.auth.token;
  }

  async createTimeline(authToken: string): Promise<string> {
    console.log('[RtmApi] createTimeline called');
    const response = await this.makeRequest<{ timeline: string }>('rtm.timelines.create', {
      auth_token: authToken
    });
    console.log('[RtmApi] createTimeline response:', { timeline: response.timeline });
    return response.timeline;
  }

  formatLists(lists: any): string {
    console.log('[RtmApi] formatLists called:', {
      hasLists: !!lists,
      isArray: Array.isArray(lists)
    });
    
    if (!lists) return 'No lists found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    
    console.log('[RtmApi] Formatting', listArray.length, 'lists');
    
    return listArray.map(list => 
      `- ${list.name} (ID: ${list.id})${list.smart === '1' ? ' [Smart List]' : ''}`
    ).join('\n');
  }

  formatTasks(lists: any): string {
    console.log('[RtmApi] formatTasks called:', {
      hasLists: !!lists,
      isArray: Array.isArray(lists)
    });
    
    if (!lists) return 'No tasks found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    
    const tasks: string[] = [];
    let totalTasks = 0;
    
    listArray.forEach((list: { id: string, taskseries?: RTMTaskSeries | RTMTaskSeries[] }) => {
      if (list.taskseries) {
        const seriesArray = Array.isArray(list.taskseries) ? list.taskseries : [list.taskseries];
        
        seriesArray.forEach((series: RTMTaskSeries) => {
          const taskArray = Array.isArray(series.task) ? series.task : [series.task];
          
          taskArray.forEach((task: RTMTask) => {
            totalTasks++;
            const completed = task.completed !== undefined && task.completed !== '';
            const priority = task.priority === 'N' ? '' : ` [P${task.priority}]`;
            const due = task.due ? ` (Due: ${task.due})` : '';
            const status = completed ? ' ✓' : '';
            
            tasks.push(`- ${series.name}${priority}${due}${status} (List: ${list.id}, Series: ${series.id}, Task: ${task.id})`);
          });
        });
      }
    });

    console.log('[RtmApi] Formatted', totalTasks, 'tasks');
    return tasks.length > 0 ? tasks.join('\n') : 'No tasks found';
  }
}