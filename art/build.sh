#!/usr/bin/env bash
# Rebuild 3D assets from the Blender scripts, then compress with meshopt.
#   ./art/build.sh                  every asset
#   ./art/build.sh animals island   only these targets
# Targets: menu, sports, kitchen (procedural), animals, island, landing, kitchens
# (these four read the source FBX files in art/source/, which only exist on the
# owner's machine).
# Blender: BPY=python3.13 uses the pip `bpy` module; otherwise $BLENDER (default:
# the macOS app) runs each script headless.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(menu sports kitchen animals island landing kitchens)
if [ -n "${BPY:-}" ]; then
  run() { "$BPY" "$@"; }
else
  BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
  command -v "$BLENDER" >/dev/null || { echo "Blender not found: set BLENDER=/path/to/blender or BPY=python3.13" >&2; exit 1; }
  run() { local script=$1; shift; "$BLENDER" --background --factory-startup --python-exit-code 1 --python "$script" -- "$@"; }
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for t in "${TARGETS[@]}"; do
  case $t in
    menu) run art/menu_scene.py "$TMP/menu.glb" ;;
    sports) run art/sports.py "$TMP" ;;
    kitchen) run art/kitchen.py "$TMP/kitchen.glb" ;;
    animals) run art/animals.py "$TMP" ;;
    island) run art/island.py "$TMP/island_court.glb" ;;
    landing) run art/landing_island.py "$TMP/landing_island.glb" ;;
    kitchens) run art/kitchens.py "$TMP" ;;
    *) echo "unknown target: $t (menu, sports, kitchen, animals, island, landing, kitchens)" >&2; exit 1 ;;
  esac
done
for f in "$TMP"/*.glb; do
  extra=()
  # The landing island's hotspot anchors are empty leaf nodes, which pruning would drop.
  [ "$(basename "$f")" = landing_island.glb ] && extra=(--prune false)
  ${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4} optimize "$f" "assets/$(basename "$f")" \
    --compress meshopt --texture-compress false --simplify false --instance false \
    --join false --palette false --flatten false ${extra[@]+"${extra[@]}"}   # (bash 3: an empty array is "unbound")
done
ls -la assets
