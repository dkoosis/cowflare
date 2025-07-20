#!/bin/bash
# Run biome on just our source files
echo "Checking source files only..."
npx biome check src test --apply
echo ""
echo "Summary:"
echo "✓ Checked: src/**/*.ts and test/**/*.ts"
echo "✗ Ignored: node_modules, .wrangler, *.d.ts, generated files"
