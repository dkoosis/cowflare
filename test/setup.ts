// Setup file to ensure vitest pool initializes properly
export default async function setup() {
  // Give vitest-pool-workers time to initialize
  await new Promise(resolve => setTimeout(resolve, 100));
}
