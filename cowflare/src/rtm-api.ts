// File: cowflare/src/rtm-api.ts
/**
 * @file rtm-api.ts
 * @description This file contains helper functions for interacting with the Remember The Milk (RTM) API.
 */

import MD5 from "crypto-js/md5";

/**
 * Generates an API method signature required for authenticated RTM API calls.
 * The signature is an MD5 hash of the shared secret followed by a string
 * of alphabetically sorted key-value pairs of the request parameters.
 * @param {Record<string, string>} params - The parameters for the API call.
 * @param {string} secret - The RTM shared secret.
 * @returns {string} The generated MD5 signature.
 */
export function generateApiSig(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(key => key + params[key]).join('');
  return MD5(secret + paramString).toString();
}

/**
 * Makes a request to the RTM REST API endpoint.
 * It automatically handles API signature generation for authenticated methods.
 * @param {string} method - The RTM API method to call (e.g., 'rtm.tasks.getList').
 * @param {Record<string, string>} params - The parameters for the API call.
 * @param {string} apiKey - The RTM API key.
 * @param {string} sharedSecret - The RTM shared secret.
 * @returns {Promise<any>} A promise that resolves with the response data from the RTM API.
 * @throws {Error} Throws an error if the RTM API returns a 'fail' status.
 */
export async function makeRTMRequest(
  method: string, 
  params: Record<string, string>, 
  apiKey: string,
  sharedSecret: string
): Promise<any> {
  // Combine all parameters for the request.
  const allParams = {
    ...params,
    api_key: apiKey,
    method,
    format: 'json'
  };
  
  // Some RTM methods do not require a signature.
  const unsignedMethods = ['rtm.test.echo', 'rtm.time.parse'];
  if (!unsignedMethods.includes(method)) {
    allParams.api_sig = generateApiSig(allParams, sharedSecret);
  }
  
  const url = `https://api.rememberthemilk.com/services/rest/?${new URLSearchParams(allParams)}`;
  const response = await fetch(url);
  const data = await response.json();
  
  // The RTM API uses a `stat` field in its response to indicate success or failure.
  if (data.rsp.stat === 'fail') {
    throw new Error(`RTM API Error: ${data.rsp.err.msg} (code: ${data.rsp.err.code})`);
  }
  
  return data.rsp;
}