#!/bin/bash

echo "🐄 Setting up Project Cowflare..."

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed. Please install Node.js first."
    exit 1
fi

# Check if wrangler is installed globally, if not it will use npx
if ! command -v wrangler &> /dev/null; then
    echo "ℹ️  Wrangler not found globally, will use npx wrangler"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .dev.vars if it doesn't exist
if [ ! -f .dev.vars ]; then
    echo "🔐 Creating .dev.vars file..."
    cat > .dev.vars << EOF
MOCK_CLIENT_ID="local-dev-client"
MOCK_CLIENT_SECRET="local-dev-secret"
EOF
    echo "✅ Created .dev.vars with mock credentials"
else
    echo "ℹ️  .dev.vars already exists, skipping..."
fi

# Create KV namespace for local development
echo "🗄️  Creating KV namespace for auth store..."
npx wrangler kv:namespace create "AUTH_STORE" --preview || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 To start the development server:"
echo "   npm start"
echo ""
echo "🔍 To test with MCP Inspector:"
echo "   npx @modelcontextprotocol/inspector@latest"
echo "   Then connect to: http://localhost:8787/sse"
echo ""
echo "📚 Check /docs/TODO.md for next steps"