### ADR-009: Modular Authentication Strategy

**Status:** Proposed
**Date:** 2025-06-22

#### Context

The immediate requirement is to implement authentication for the Remember The Milk (RTM) API. However, future integrations with other service providers, such as Spektrix and Powerhouse Arts (which uses Ungerboeck), are anticipated.

An analysis of these providers reveals three fundamentally different authentication mechanisms:

1.  **Remember The Milk (RTM):** A unique, user-involved flow. It requires redirecting the user to the RTM website to authorize the application, receiving a temporary `frob`, and exchanging that `frob` for a long-lived `auth_token` that is used in subsequent API calls.
2.  **Spektrix:** A stateless, per-request signing model. Every API request must be individually signed using an HMAC-SHA1 algorithm, incorporating a secret key, the request method, URI, date, and a hash of the body. There is no concept of a persistent token.
3.  **Ungerboeck (Powerhouse Arts):** A standard server-to-server flow for obtaining a short-lived JWT Bearer Token. It requires a POST request with a Client ID and Secret to a token endpoint. The resulting `accessToken` must be cached and refreshed upon expiration.

A monolithic implementation focused only on RTM would be difficult and costly to refactor to support these disparate future requirements. We need an architecture that supports multiple authentication schemes in a clean, extensible, and maintainable way.

#### Decision

We will adopt a modular **"Auth Strategy"** design pattern. This pattern will abstract the specific logic of each authentication provider behind a common interface.

1.  **Define a Common Interface:** We will define a generic `AuthStrategy` interface in TypeScript that all provider-specific implementations must adhere to.

    ```typescript
    interface AuthStrategy {
      /**
       * Executes an authenticated request to the provider's API.
       * The implementation is responsible for handling all aspects of authentication,
       * such as adding tokens, signing the request, or refreshing credentials.
       *
       * @param url The target API endpoint.
       * @param options The standard fetch RequestInit options.
       * @returns A Promise resolving to the Response.
       */
      makeRequest(url: string, options: RequestInit): Promise<Response>;
    }
    ```

2.  **Create Concrete Implementations:** For each provider, we will create a dedicated class that implements the `AuthStrategy` interface.

      * **`RtmStrategy`:** Will manage the stored `auth_token` and implement the `api_sig` signing logic for each call made via `makeRequest`. It will also contain the logic for the initial user-facing `frob` flow.
      * **`SpektrixStrategy`:** Its `makeRequest` method will generate the required HMAC-SHA1 signature for every individual request, as per the Spektrix documentation.
      * **`UngerboeckStrategy`:** Its `makeRequest` method will manage the lifecycle of the JWT. It will check a cache for a valid token; if the token is missing or expired, it will fetch a new one before proceeding with the API call.

3.  **Use a Factory:** The main application logic will use a factory function or dependency injection to select and instantiate the correct strategy based on configuration. This decouples the core application from any specific authentication implementation.

#### Consequences

**Positive:**

  * **Extensibility:** Adding a new authentication provider becomes a straightforward task of creating a new class that implements the `AuthStrategy` interface, with no changes required to the core application logic.
  * **Modularity & Isolation:** The complexity of each authentication scheme is contained entirely within its own module, making the code easier to understand, maintain, and debug.
  * **Testability:** Each authentication strategy can be unit-tested in isolation.
  * **Clean Code:** Core application logic is simplified and is not cluttered with provider-specific authentication details.

**Negative:**

  * **Increased Upfront Complexity:** This pattern requires more upfront design and implementation (defining an interface, creating specific classes) compared to a single, hardcoded solution for RTM.
  * **Abstraction Overhead:** It introduces a layer of abstraction that may require a small learning curve for developers new to the codebase.