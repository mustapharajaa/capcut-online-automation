#!/bin/bash

echo ""
echo "========================================"
echo "  CapCut Automation Setup (Linux/VPS)"
echo "========================================"
echo ""

echo "Installing Node.js dependencies..."
npm install

echo ""
echo "Running automated setup..."
node setup.js

echo ""
echo "Setup complete! You can now run:"
echo "  npm start"
echo ""
