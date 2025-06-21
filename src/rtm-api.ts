// rtm-api.ts - RTM API types and request handler

export interface RTMApiResponse {
  rsp: {
    stat: 'ok' | 'fail';
    [key: string]: any;
  };
}

export interface RTMAuthResponse {
  auth: {
    token: string;
    user: {
      id: string;
      username: string;
      fullname: string;
    };
  };
}

export interface RTMTimelineResponse {
  timeline: string;
}

export interface RTMList {
  id: string;
  name: string;
  deleted: string;
  locked: string;
  archived: string;
  position: string;
  smart: string;
  sort_order?: string;
  filter?: string;
}

export interface RTMTask {
  id: string;
  created: string;
  modified: string;
  name: string;
  source: string;
  url?: string;
  location_id?: string;
  tags?: string[];
  participants?: any[];
  notes?: any[];
  task: {
    id: string;
    due?: string;
    has_due_time: string;
    added: string;
    completed?: string;
    deleted?: string;
    priority: string;
    postponed: string;
    estimate?: string;
  };
}

export interface RTMUserSettings {
  timezone: string;
  dateformat: string;
  timeformat: string;
  defaultlist: string;
  language: string;
}

export interface RTMTag {
  name: string;
}

export interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  SERVER_URL: string;
  AUTH_STORE: KVNamespace;
}

// RTM API request handler
export async function makeRTMRequest(
  method: string, 
  params: Record<string, string>, 
  apiKey: string, 
  sharedSecret: string
): Promise<any> {
  const allParams: Record<string, string> = {
    method,
    api_key: apiKey,
    format: 'json',
    ...params
  };

  // Generate signature
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map(key => `${key}${allParams[key]}`).join('');
  const signatureBase = sharedSecret + paramString;
  
  const encoder = new TextEncoder();
  const signatureData = encoder.encode(signatureBase);
  const hashBuffer = await crypto.subtle.digest('MD5', signatureData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  allParams.api_sig = apiSig;

  // Make request
  const url = new URL('https://api.rememberthemilk.com/services/rest/');
  Object.entries(allParams).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const responseData = await response.json() as RTMApiResponse;
  
  if (responseData.rsp.stat !== 'ok') {
    throw new Error(`RTM API Error: ${responseData.rsp.err.msg} (code: ${responseData.rsp.err.code})`);
  }

  return responseData.rsp;
}