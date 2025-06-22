# AI CLI

A handy CLI for developing demos.

## Generating lockfiles

Each demo should contain it's own package-lock.json so that installing dependencies in CI is faster (in Workers Builds, this reduces install time by ~80%).

Note: We should still use the root package-lock.json for actual development of this repo. If we find that there are conflicts, we should consider switching to pnpm.

### Commands:

```sh
# generate missing lockfiles
pnpm aicli generate-npm-lockfiles

# lint lockfiles to ensure they're all up to date
pnpm aicli lint-npm-lockfiles
```
