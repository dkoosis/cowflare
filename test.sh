#!/bin/bash
# Run tests twice to work around vitest initialization issue
echo "Starting tests..."
npm test -- --run --reporter=silent 2>/dev/null
echo "Running tests..."
npm test -- --run
