# Periodic Code Review Guide

## Recommended Schedule

### 📅 Weekly (Monday morning)
Best for active development:
1. **Semantic Naming Review** - Catch naming drift early
2. **Code Smell Analysis** - Prevent debt accumulation

### 📅 Biweekly  
For stable phases:
- Alternate between semantic and smell analysis

### 📅 On-Demand
Always run before:
- Major feature merges
- Release candidates
- After refactoring sprints

## Setup Instructions

1. **Make script executable:**
   ```bash
   chmod +x scripts/prepare-review.sh
   ```

2. **Run review prep:**
   ```bash
   npm run review:prep
   # or
   ./scripts/prepare-review.sh
   ```

3. **Use with Claude:**
   - Open generated file in `/reviews/YYYY-MM-DD-review-prep.md`
   - Copy content to Claude
   - Add appropriate prompt from `/prompts/`
   - Save output back to `/reviews/`

## Why These Prompts Work Well

1. **Structured Output**: Both generate markdown reports with clear sections
2. **Quantitative Metrics**: Track trends over time
3. **Actionable**: Specific recommendations, not just problems
4. **Contextual**: Adapted for TypeScript/Workers/MCP

## Optimization Tips

1. **Batch Reviews**: Run both analyses in one Claude session
2. **Track Metrics**: Create a spreadsheet of smell counts over time
3. **Focus Areas**: Use "Focus Smells" parameter on problem areas
4. **Compare Reports**: Diff previous reports to see improvements

## Example Workflow

```bash
# Monday morning ritual
npm run review:prep
# Copy to Claude with semantic-naming-review.md
# Save as: reviews/2025-01-20-semantic.md
# Copy to Claude with code-smell-analysis.md  
# Save as: reviews/2025-01-20-smells.md

# Update tracking
echo "## 2025-01-20" >> reviews/METRICS.md
echo "- Ambiguous names: 3" >> reviews/METRICS.md
echo "- Type safety issues: 2" >> reviews/METRICS.md
echo "- Fixed since last week: 5" >> reviews/METRICS.md
```
