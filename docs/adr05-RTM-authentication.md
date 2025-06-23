### ADR 005: Remember The Milk (RTM) Authentication Mechanism

**Status**: Accepted

**Context**:
The `rtm-mcp-server` must communicate with the Remember The Milk API to execute tasks on behalf of a user. This requires a secure method for authenticating the user and authorizing the server to perform actions with specific permissions. We must implement the official authentication protocol mandated by RTM, which is compatible with both web-based UIs and desktop/headless clients like Claude Desktop.

**Decision**:
We will adopt the official RTM authentication flow, which uses a combination of a shared secret for signing requests and a "frob"-based token exchange for user authorization. The implementation will follow the "desktop application" flow, as it is more suitable for our architecture where the server orchestrates authentication before passing a token to a client.

The process is as follows:

**1. Request Signing (`api_sig`)**
All API requests to RTM (except for `rtm.test.echo` and `rtm.time`) must be digitally signed.

* **Process**:
    1.  Collect all API method parameters (excluding `api_sig` itself).
    2.  Sort the parameters alphabetically by their key.
    3.  Create a single string by concatenating the sorted key-value pairs (e.g., `key1value1key2value2`).
    4.  Prepend the account's shared secret to this string.
    5.  Calculate the MD5 hash of the final combined string.
    6.  This hash is the value for the `api_sig` parameter, which is appended to the request.

**2. User Authentication and Authorization Flow**
We will implement the following multi-step process to acquire an `auth_token` for a user:

* **Step 1: Get Frob**: The server initiates the process by making a signed call to `rtm.auth.getFrob` to receive a temporary `frob`. This `frob` acts as a short-lived identifier for the authentication session.

* **Step 2: Construct Auth URL**: The server constructs a unique URL to the RTM authentication service (`https://www.rememberthemilk.com/services/auth/`). This URL includes the `api_key`, desired `perms` (`read`, `write`, or `delete`), the `frob` from Step 1, and a freshly calculated `api_sig`.

* **Step 3: User Authorization**: The user is redirected to the constructed auth URL. They will be prompted to log in to RTM (if not already) and explicitly grant the application the requested permissions.

* **Step 4: Exchange Frob for Token**: After the user authorizes the application, they are instructed to return to our service. Our server then makes a final signed API call to `rtm.auth.getToken`, passing the original `frob`.

* **Step 5: Store Auth Token**: RTM returns a permanent `auth_token`. This token is the credential used for all subsequent API calls for that user. The server will store this token securely in the `AUTH_STORE` KV namespace.

**3. Token Verification**
The server must handle cases where an `auth_token` is expired or has been revoked by the user.

* **Process**: Before making API calls, or when an API call fails with an auth error, the server should validate the token by calling `rtm.auth.checkToken`.
* **Response**: If the token is invalid, the API will return a `stat="fail"` response with error code `98`. In this case, the user must be prompted to re-authenticate by starting the flow again from Step 1.

**Consequences**:

* **Pros**:
    * **Security**: Adheres to the official RTM security protocol, with request signing to prevent tampering.
    * **Compliance**: Ensures our application is a good citizen within the RTM API ecosystem.
    * **Explicit Permissions**: The user experience is clear, as users must explicitly grant the permissions our application requests.

* **Cons**:
    * **Implementation Complexity**: The multi-step flow involving the `frob` and the requirement to sign every request is more complex than a simple Bearer token system.
    * **Dependency on MD5**: The protocol requires the use of MD5 for signing, which is an older hashing algorithm. This is a constraint we must accept as part of the RTM platform.
    * **State Management**: The server must manage the state of the `frob` during the authentication process and securely persist the final `auth_token`. Our architecture using Durable Objects and KV storage is well-suited to handle this requirement.