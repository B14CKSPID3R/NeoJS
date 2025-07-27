#!/bin/bash

set -euo pipefail

PLUGINS_DIR="plugins"
OUTPUT_DIR="src/main/resources"

declare -A plugins=(
  ["JSEndpoints"]="JSEndpoints/jsendpoints.js"
  ["JSParameters"]="JSParams/jsparams.js"
  ["JSRequests"]="JSRequest/jsrequests.js"
)

for plugin in "${!plugins[@]}"; do
  echo "Installing dependencies for ${plugin}..."
  (
    cd "${PLUGINS_DIR}/${plugin}" || exit 1
    npm install --silent
  )
done

for plugin in "${!plugins[@]}"; do
  input_file="${PLUGINS_DIR}/${plugin}/${plugin}.js"
  output_file="${OUTPUT_DIR}/${plugins[$plugin]}"
  
  echo "Building ${plugin}..."
  esbuild "${input_file}" \
    --bundle \
    --platform=node \
    --minify \
    --outfile="${output_file}"
done

echo "Build completed successfully."