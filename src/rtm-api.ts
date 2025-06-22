export class RtmApi {
  private apiKey: string;
  private sharedSecret: string;
  private baseUrl = 'https://api.rememberthemilk.com/services/rest/';

  constructor(apiKey: string, sharedSecret: string) {
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
  }

  private async generateSignature(params: Record<string, string>): Promise<string> {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
    const message = this.sharedSecret + paramString;
    
    // Use Web Crypto API for Cloudflare Workers
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async makeRequest(method: string, params: Record<string, string> = {}): Promise<any> {
    const allParams = {
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

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.rsp.stat !== 'ok') {
      throw new Error(`RTM API Error: ${data.rsp.err.msg} (${data.rsp.err.code})`);
    }

    return data.rsp;
  }

  async getFrob(): Promise<string> {
    const response = await this.makeRequest('rtm.auth.getFrob');
    return response.frob;
  }

  async getAuthUrl(frob: string, perms: 'read' | 'write' | 'delete' = 'delete'): Promise<string> {
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

    return url.toString();
  }

  async getToken(frob: string): Promise<string> {
    const response = await this.makeRequest('rtm.auth.getToken', { frob });
    return response.auth.token;
  }

  async createTimeline(authToken: string): Promise<string> {
    const response = await this.makeRequest('rtm.timelines.create', {
      auth_token: authToken
    });
    return response.timeline;
  }

  formatLists(lists: any): string {
    if (!lists) return 'No lists found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    
    return listArray.map(list => 
      `- ${list.name} (ID: ${list.id})${list.smart === '1' ? ' [Smart List]' : ''}`
    ).join('\n');
  }

  formatTasks(lists: any): string {
    if (!lists) return 'No tasks found';
    const listArray = Array.isArray(lists) ? lists : [lists];
    
    const tasks: string[] = [];
    
    listArray.forEach(list => {
      if (list.taskseries) {
        const seriesArray = Array.isArray(list.taskseries) ? list.taskseries : [list.taskseries];
        
        seriesArray.forEach(series => {
          const taskArray = Array.isArray(series.task) ? series.task : [series.task];
          
          taskArray.forEach(task => {
            const completed = task.completed !== '';
            const priority = task.priority === 'N' ? '' : ` [P${task.priority}]`;
            const due = task.due ? ` (Due: ${task.due})` : '';
            const status = completed ? ' ✓' : '';
            
            tasks.push(`- ${series.name}${priority}${due}${status} (List: ${list.id}, Series: ${series.id}, Task: ${task.id})`);
          });
        });
      }
    });

    return tasks.length > 0 ? tasks.join('\n') : 'No tasks found';
  }
}