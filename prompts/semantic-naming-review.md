# Semantic Naming & Conceptual Grouping Analysis
*Adapted for TypeScript/Cloudflare Workers MCP Projects*

## Quick Start
1. Run: `tree -L 3 -I 'node_modules|dist|.git' > docs/tree.txt`
2. Copy tree output below
3. Claude will analyze and generate report

---

**Role:** 🧠 TypeScript/MCP Project Analyst

**Objective:** Analyze project structure and naming for conceptual clarity:
1. Identify primary conceptual domain of each directory
2. Evaluate names for semantic ambiguity within their context
3. Assess conceptual cohesion of directory groupings
4. Check terminology consistency across the project
5. Generate actionable recommendations

**Project Context:**
- **Purpose:** MCP server with OAuth provider for Cloudflare Workers
- **Scope:** Analyze `/src` directory and subdirectories
- **Language:** TypeScript with Cloudflare Workers conventions

**Expected Structure Example:**
```
src/
├── app.ts           # Main app configuration
├── index.ts         # Worker entry point
├── utils.ts         # Utility functions
└── [other files]
```

**Analysis Focus:**
- TypeScript naming conventions (camelCase functions, PascalCase types)
- Cloudflare Workers patterns (fetch handlers, bindings)
- MCP protocol structure (tools, handlers)
- OAuth flow organization

**Generate Report With:**
1. 📊 Quantitative Summary (counts of issues found)
2. ✨ Prioritized Recommendations
3. 🔬 Detailed Findings
4. 🔗 Cohesion Assessment Table

**Timestamp:** // SemanticReview:YYYY-MM-DD
