# Lessons Learned & Environmental Quirks
*Track mistakes and quirks to avoid repetition*

## Off-Track Patterns

### 1. Tool Configuration Rabbit Holes
**Example:** vitest-pool-workers setup (2025-01-18)
**Pattern:** Spending hours on config when tool is broken
**Prevention:** Timebox config attempts (30 min), check GitHub issues first

### 2. Over-Engineering Before Baseline
**Example:** [TO BE FILLED]
**Pattern:** Adding features before tests work
**Prevention:** Follow ROADMAP.md phases strictly

## Environmental Quirks

### Cloudflare Workers
- [ ] No localStorage/sessionStorage in artifacts
- [ ] Compatibility flags can conflict
- [ ] Some npm packages incompatible

### MCP/Agents SDK
- [ ] Types don't always match runtime
- [ ] Documentation gaps in agents/mcp

### Development Tools
- [ ] vitest-pool-workers@0.1.0 broken
- [ ] tree command needs -I flags for clean output

## Quick Checks Before Starting
1. Is this tool version stable?
2. Do we have working examples?
3. Is there a simpler approach?
4. Are we following the quality-first roadmap?

---
*Update this whenever we waste >30 minutes on something preventable*
