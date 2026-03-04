# Obsidian Plugin Submission Checklist

Use this before submitting to the [Obsidian Community Plugins](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) directory.

## Prerequisites

- [ ] **GitHub repo** – Plugin is in a public GitHub repository (you’re updating an existing one).
- [ ] **Build passes** – Run `npm run build` and fix any errors.
- [ ] **Manual test** – Install the built plugin in a vault and test core flows.

## Submission requirements (from Obsidian docs)

- [x] **fundingUrl** – Only for financial support links; use full URL (e.g. `https://patreon.com/...`). ✓ Fixed in manifest.
- [x] **minAppVersion** – Set appropriately (yours: `0.15.0`). ✓
- [x] **Description** – Short and simple (manifest + README). ✓
- [x] **Node/Electron APIs** – Only used on desktop if at all. ✓ (no Node/Electron usage in code).
- [x] **Command IDs** – Don’t include the plugin ID (yours: `start-stop-recording`, `upload-audio-file`). ✓
- [ ] **No sample/boilerplate code** – Remove any leftover template code. ✓ (none found)

## Release steps

### 1. Bump version and build

```bash
# Bump version (choose one)
npm version patch   # 1.5.5 → 1.5.6
# or
npm version minor   # 1.5.5 → 1.6.0
# or
npm version major   # 1.5.5 → 2.0.0
```

Then create the release (see step 2). Your `release-it` config will run `npm run build` before release and `verify-and-update.mjs` to sync `manifest.json` and `versions.json`.

### 2. Create a GitHub release

Either use **release-it** (creates tag + GitHub release + uploads assets):

```bash
npm run release
```

Or manually:

1. Push your commits and run `npm run build`.
2. On GitHub: **Releases** → **Draft a new release**.
3. Create a tag (e.g. `v1.5.6`) from the branch you’re releasing.
4. Upload **main.js**, **manifest.json**, and **styles.css** (and optionally **versions.json**).
5. Publish the release.

### 3. Submit for review

1. Open the [Obsidian Community Plugins](https://github.com/obsidianmd/obsidian-releases) repo (or the link from [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)).
2. Add or update your plugin in the community plugins list (as per their current submission process).
3. Submit a PR and wait for review.

### 4. Address review comments

Respond to any feedback from the Obsidian team and update the PR until it’s approved.

## Files that must be in each release

- **main.js** – Built bundle (from `npm run build`).
- **manifest.json** – Plugin metadata (version must match release).
- **styles.css** – Plugin styles.

Your `release-it` config already attaches these in the GitHub release.

## Quick pre-submission commands

```bash
npm run build          # TypeScript check + esbuild bundle
npm run release        # Interactive: bump version, build, tag, GitHub release
```
