import crypto from 'crypto';

export class RtmApi {
  private apiKey: string;
  private sharedSecret: string;
  private baseUrl = 'https://api.rememberthemilk.com/services/rest/';

  constructor(apiKey: string, sharedSecret: string) {
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
  }

  private generateSignature(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
    return crypto
      .createHash('md5')
      .update(this.sharedSecret + paramString)
      .digest('hex');
  }

  async makeRequest(method: string, params: Record<string, string> = {}): Promise<any> {
    const allParams = {
      ...params,
      api_key: this.apiKey,
      method,
      format: 'json'
    };

    allParams.api_sig = this.generateSignature(allParams);

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

  getAuthUrl(frob: string, perms: 'read' | 'write' | 'delete' = 'delete'): string {
    const params = {
      api_key: this.apiKey,
      frob,
      perms
    };

    const signature = this.generateSignature(params);
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

  formatLists(lists: any[]): string {
    if (!Array.isArray(lists)) {
      lists = [lists];
    }

    return lists.map(list => 
      `- ${list.name} (ID: ${list.id})${list.smart === '1' ? ' [Smart List]' : ''}`
    ).join('\n');
  }

  formatTasks(lists: any[]): string {
    if (!Array.isArray(lists)) {
      lists = [lists];
    }

    const tasks: string[] = [];
    
    lists.forEach(list => {
      if (list.taskseries) {
        const seriesArray = Array.isArray(list.taskseries) ? list.taskseries : [list.taskseries];
        
        seriesArray.forEach(series => {
          const taskArray = Array.isArray(series.task) ? series.task : [series.task];
          
          taskArray.forEach(task => {
            const completed = task.completed !== '';
            const priority = series.task.priority === 'N' ? '' : ` [P${series.task.priority}]`;
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