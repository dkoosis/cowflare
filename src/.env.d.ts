/**
 * Type declaration for non-standard module imports.
 *
 * This file tells the TypeScript compiler how to handle imports for file types
 * that it doesn't understand natively, like '.txt'. This is a common
 * pattern when using build tools like Vite or Wrangler, which can import
 * assets as raw strings.
 *
 * By declaring a module for '*.txt', we're telling TypeScript that
 * any import matching this pattern will have a default export of type `string`.
 * This allows the rest of our codebase to type-check correctly without any
 * compiler errors for these special imports.
 */
declare module '*.txt' {
  const content: string;
  export default content;
}