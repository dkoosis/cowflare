# Documentation Index

## When to Use Each Document

### 🤖 Machine Context (Claude reads first)
- **STATE.yaml** - Current session state, what we're doing now
- **STATE-RECIPE.yaml** - Step-by-step procedures (if exists)

### 🔍 Code Review
- **prompts/** - Structured prompts for periodic code reviews
- **reviews/** - Review outputs and history
- **REVIEW-GUIDE.md** - How to run periodic reviews

### 📋 Development Planning
- **ROADMAP.md** - Quality-first development phases
- **KNOWN-ISSUES.md** - Dead-ends and version problems to avoid

### 🧪 Testing Documentation
- **MCP-PROTOCOL-STANDARDS.md** - MCP protocol testing rules (WHAT standards to follow)
- **HOW-TO-TEST.md** - How to test THIS project (HOW to run tests)

### 📁 Project Structure
- **tree.txt** - Directory structure snapshot

## Quick Reference

**"How do I test this?"** → HOW-TO-TEST.md  
**"What test patterns should I use?"** → MCP-PROTOCOL-STANDARDS.md  
**"What are we working on?"** → STATE.yaml  
**"What comes next?"** → ROADMAP.md  
**"Why doesn't X work?"** → KNOWN-ISSUES.md  

## Naming Conflicts
- `MCP-PROTOCOL-STANDARDS.md` = Protocol standards (theory)
- `HOW-TO-TEST.md` = Project testing guide (practice)
