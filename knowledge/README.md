# Knowledge base

Short notes on technical facts that took effort to establish and will be needed again: quirks of a tool, a format, a browser API, or this codebase. Not a design doc and not a changelog.

**Consult** before working in the area a note covers (check the list below).

**Add or update a note** when you've *verified* something reusable: by running it, inspecting the file, or reading the source. One topic per file, kebab-case name, and add it to the list below. Update an existing note instead of creating a near-duplicate.

Each note says how it was verified and when. Mark anything not verified as **Unverified** or **Proposed**. Remove or correct notes that turn out to be wrong. No secrets.

Belongs elsewhere: architecture → `docs/ARCHITECTURE.md`, workflows → `docs/ASSET_PIPELINE.md`, milestones → `docs/DEVELOPMENT_LOG.md`.

## Notes

- [fbx-source-assets.md](fbx-source-assets.md) — what the FBX models in `art/source/` contain and how their textures are linked
- [blender-headless-pipeline.md](blender-headless-pipeline.md) — Blender 5.3 CLI quirks: arguments, frame rate on FBX import, weights, glTF clips, meshopt
- [threejs-skinned-characters.md](threejs-skinned-characters.md) — cloning, culling, blending and layering skinned characters with the vendor three.js
- [island-court.md](island-court.md) — how the island's court was measured and the numbers `art/island.py` uses
