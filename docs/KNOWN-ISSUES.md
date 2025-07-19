# Known Issues & Version Dependencies

## vitest-pool-workers initialization failures
**Version**: @cloudflare/vitest-pool-workers@0.1.0 with vitest@1.3.0
**Date**: 2025-01-18
**Status**: BLOCKED

### Issue
- Runtime fails to start on first run with "ERR_RUNTIME_FAILURE"
- Must run tests twice, pressing 'r' on second attempt
- Even with correct compatibility flags, initialization is flaky
- Tests not discovered despite correct file patterns

### Attempted fixes
1. Added export_commonjs_default flag - deprecated, caused more errors
2. Changed compatibility_date multiple times
3. Added setupFiles with delay
4. Specified test patterns explicitly
5. Created separate test config file

### Decision
Skip vitest-pool-workers until stable. Test running worker directly.

### Reassess when
- New version of @cloudflare/vitest-pool-workers released
- Check: `npm outdated @cloudflare/vitest-pool-workers`
- Watch: https://github.com/cloudflare/workers-sdk/releases

### Alternative approach
Test running worker with:
```bash
npm run dev
node test-mcp.mjs
```
