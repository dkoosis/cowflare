# Code Review Prompts

## Usage Schedule

### Weekly Reviews (Monday morning)
- **semantic-naming-review.md** - Check naming drift and new additions
- **code-smell-analysis.md** - Identify accumulating technical debt

### Major Milestone Reviews
- Run both prompts before merging major features
- Run after significant refactoring

### Monthly Deep Dive
- Run with extended thinking on complex areas

## Quick Run Commands

```bash
# Generate current tree structure
tree -L 3 -I 'node_modules|dist|.git' > docs/tree.txt

# Run semantic review
# 1. Copy tree.txt content
# 2. Paste into Claude with semantic-naming-review.md

# Run code smell analysis  
# 1. Copy relevant source files
# 2. Paste into Claude with code-smell-analysis.md
```

## Tips for Claude

1. **Use Sonnet (no extended thinking)** for regular reviews
2. **Use Opus + extended thinking** only for complex architectural decisions
3. **Always provide the tree structure first**, then the prompt
4. **Save outputs** in `/reviews/YYYY-MM-DD-type.md` for tracking
