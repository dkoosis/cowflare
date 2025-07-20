#!/bin/bash
set -e

echo "🔍 Preparing Cowflare MCP Server..."

# Type check
echo "📝 Type checking..."
npm run type-check

# Generate CF types
echo "🏗️ Generating Cloudflare types..."
npm run cf-typegen

# Format and lint (optional)
if command -v biome >/dev/null 2>&1; then
  echo "✨ Formatting code..."
  npm run format
  npm run lint:fix
else
  echo "⚠️ Biome not installed, skipping formatting"
fi

echo "✅ Code preparation complete!"
