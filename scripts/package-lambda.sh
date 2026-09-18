#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="$repo_dir/dist/lambda"

rm -rf "$artifact_dir"
mkdir -p "$artifact_dir"

cp "$repo_dir/package.json" "$repo_dir/package-lock.json" "$artifact_dir/"
cp -R "$repo_dir/src" "$artifact_dir/src"
mkdir -p "$artifact_dir/cornerstone-package"
cp -R "$repo_dir/cornerstone-package/src" "$artifact_dir/cornerstone-package/src"

npm_cache_dir="${TMPDIR:-/tmp}/be-platform-npm-cache"
mkdir -p "$npm_cache_dir"
npm_config_cache="$npm_cache_dir" npm ci --omit=dev --ignore-scripts --prefix "$artifact_dir"

(
  cd "$artifact_dir"
  zip -qr "$repo_dir/dist/be-platform-lambda.zip" .
)

printf '%s\n' "$repo_dir/dist/be-platform-lambda.zip"
