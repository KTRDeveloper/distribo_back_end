#!/bin/bash

# Development restart helper script
# Kills existing dev server and starts a new one

echo "Stopping existing dev server..."
pkill -f "tsx src/server.ts" || true

echo "Starting dev server..."
npm run dev
