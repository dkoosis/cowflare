#!/bin/bash
set -e

# Check dependencies
command -v jq >/dev/null 2>&1 || { echo "❌ jq is required but not installed."; exit 1; }

echo "🧪 Running Cowflare Test Suite..."

# 1. Prepare code
echo "Preparing code..."
bash scripts/build.sh

# 2. Start worker with proper error handling
echo "Starting worker..."
npm run dev &
WORKER_PID=$!

# Wait for worker to start
echo "Waiting for worker..."
for i in {1..10}; do
  if curl -s http://localhost:8787/ >/dev/null 2>&1; then
    echo "Worker ready!"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "❌ Worker failed to start"
    kill $WORKER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# 3. Run tests
echo "🔍 Running integration tests..."
if ! bash test-mcp.sh; then
  kill $WORKER_PID 2>/dev/null || true
  exit 1
fi

echo "🔍 Running interactive tests..."
bash test-interactive.sh

# 4. Clean up
kill $WORKER_PID 2>/dev/null || true
wait $WORKER_PID 2>/dev/null || true

echo "✅ All tests passed!"
