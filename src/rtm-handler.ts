/**
 * @file rtm-handler.ts
 * @description Manages the OAuth-like authentication flow with the Remember The Milk API.
 */

import { Context } from 'hono';
import { getSession, createSession } from './workers-oauth-utils'; // Assumes the utility file from the demo exists
import { makeRTMRequest, calculateRtmSignature } from './rtm-api';
import type { Env } from './types';

/**
 * Handles the initial login request.
 * 1. Gets a temporary "frob" from the RTM API.
 * 2. Stores the frob in a new session.
 * 3. Builds a signed RTM auth URL.
 * 4. Redirects the user to RTM to authorize the application.
 */
async function login(c: Context<{ Bindings: Env }>) {
  const frobResponse = await makeRTMRequest(c.env, 'rtm.auth.getFrob');
  const frob = frobResponse?.frob;

  if (!frob) {
    return c.text('Could not retrieve Frob from RTM API.', 500);
  }

  const session = await createSession(c.env.SESSION_KV, c.env.OAUTH_SESSION_SECRET);
  session.set('rtm_frob', frob);

  const authParams = {
    api_key: c.env.RTM_API_KEY,
    perms: 'write',
    frob: frob,
  };

  const apiSig = calculateRtmSignature(authParams, c.env.RTM_SHARED_SECRET);
  const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams({ ...authParams, api_sig: apiSig })}`;

  // Set the session cookie and redirect the user
  const headers = {
    'Set-Cookie': await session.commit(),
    Location: authUrl,
  };

  return new Response(null, { status: 302, headers });
}

/**
 * Handles the callback from RTM after the user grants authorization.
 * 1. Retrieves the frob from the user's session.
 * 2. Exchanges the authorized frob for a permanent authentication token.
 * 3. Stores the permanent token in the session, removing the temporary frob.
 * 4. Redirects the user to the application's home page.
 */
async function callback(c: Context<{ Bindings: Env }>) {
  const session = await getSession(c.req.raw, c.env.SESSION_KV, c.env.OAUTH_SESSION_SECRET);
  if (!session) {
    return c.text('Invalid session. Please try logging in again.', 401);
  }

  const frob = session.get('rtm_frob');
  if (!frob) {
    return c.text('No frob found in session. Please try logging in again.', 400);
  }

  try {
    const tokenResponse = await makeRTMRequest(c.env, 'rtm.auth.getToken', { frob });
    const authToken = tokenResponse?.auth?.token;

    if (!authToken) {
      throw new Error('Authentication failed. A token was not received from RTM.');
    }

    session.set('rtm_auth_token', authToken);
    session.unset('rtm_frob');

    const headers = {
      'Set-Cookie': await session.commit(),
      Location: '/',
    };
    return new Response('Login Successful! Redirecting...', { status: 302, headers });

  } catch (error: any) {
    return c.text(`Error authenticating with RTM: ${error.message}`, 500);
  }
}

/**
 * Handles the logout request by destroying the current session.
 */
async function logout(c: Context<{ Bindings: Env }>) {
  const session = await getSession(c.req.raw, c.env.SESSION_KV, c.env.OAUTH_SESSION_SECRET);
  if (session) {
    await session.destroy();
  }
  return c.redirect('/');
}

export const rtm = { login, callback, logout };