#!/bin/bash

# Quick fix to add missing /health route to index.ts

echo "Adding /health route to index.ts..."

# Find the line with "app.get('/', (c) => {" and add health route before it
sed -i.bak '/app.get.*\/.*=> {/i\
// Health check endpoint\
app.get("/health", (c) => {\
    const { deploymentName, deploymentTime } = getDeploymentInfo();\
    return c.json({\
        status: "ok",\
        service: "rtm-mcp-server",\
        deployment: deploymentName,\
        deployed_at: deploymentTime\
    });\
});\
\
' src/index.ts

echo "✅ Added /health route"
echo ""
echo "Now deploy with: wrangler deploy"