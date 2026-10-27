#!/usr/bin/env bash
# Rebuild every 3D asset from the Blender scripts, then compress with meshopt.
# Needs: Python with the `bpy` module (pip install bpy) and Node (npx).
#   BPY=python3.13 ./art/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BPY=${BPY:-python3}
TMP=$(mktemp -d)
"$BPY" art/menu_scene.py "$TMP/menu.glb"
"$BPY" art/sports.py "$TMP"
"$BPY" art/kitchen.py "$TMP/kitchen.glb"
for f in "$TMP"/*.glb; do
  ${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4} optimize "$f" "assets/$(basename "$f")" \
    --compress meshopt --texture-compress false --simplify false --instance false \
    --join false --palette false --flatten false
done
ls -la assets
