#!/bin/bash
set -e

cd "$(dirname "$0")/frontend"

echo "📦 Building dmux..."
cargo tauri build 2>&1 | tail -5

echo "🚀 Installing to /Applications..."
rm -rf /Applications/dmux.app
cp -r src-tauri/target/release/bundle/macos/dmux.app /Applications/

echo "✅ Done! Launch dmux from Spotlight or Launchpad."
