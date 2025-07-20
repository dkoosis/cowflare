#!/bin/bash
# Generate review artifacts for Claude analysis

echo "🔍 Generating code review artifacts..."

# Generate tree structure
echo "📁 Creating directory tree..."
tree -L 3 -I 'node_modules|dist|.git|coverage' > docs/tree.txt

# Create review file with timestamp
DATE=$(date +%Y-%m-%d)
REVIEW_FILE="reviews/${DATE}-review-prep.md"

echo "📝 Preparing review file: $REVIEW_FILE"

cat > "$REVIEW_FILE" << EOF
# Code Review Preparation
Generated: $(date)

## Directory Structure
\`\`\`
$(cat docs/tree.txt)
\`\`\`

## Source Files to Review
EOF

# List TypeScript files
echo "" >> "$REVIEW_FILE"
echo "### TypeScript Files:" >> "$REVIEW_FILE"
find src -name "*.ts" -type f | while read -r file; do
    echo "- $file ($(wc -l < "$file") lines)" >> "$REVIEW_FILE"
done

echo "" >> "$REVIEW_FILE"
echo "## Review Checklist" >> "$REVIEW_FILE"
echo "- [ ] Run semantic naming analysis" >> "$REVIEW_FILE"
echo "- [ ] Run code smell analysis" >> "$REVIEW_FILE"
echo "- [ ] Update STATE.yaml with findings" >> "$REVIEW_FILE"
echo "- [ ] Create issues for critical findings" >> "$REVIEW_FILE"

echo "✅ Review preparation complete!"
echo "📋 Next steps:"
echo "1. Open $REVIEW_FILE"
echo "2. Copy content to Claude with appropriate prompt from /prompts"
echo "3. Save Claude's output to reviews/${DATE}-[semantic|smells].md"
