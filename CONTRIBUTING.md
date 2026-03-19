# Contributing

## Development Setup

```sh
npm install
npm test     # lint + build + typecheck + vitest (all workspaces)
```

The project is an npm workspaces monorepo with two packages:

- **`packages/api`** (`styled-map-package-api`) — JavaScript API for reading, writing, and serving `.smp` files
- **`packages/cli`** (`styled-map-package`) — CLI tools (`smp download`, `smp view`, `smp mbtiles`)

## Making a Pull Request

Every PR that changes package behavior needs a **changeset** — a small markdown file that describes what changed and which semver bump it requires. CI will fail if one is missing.

### Adding a changeset

```sh
npx changeset
```

This prompts you to:

1. Select which packages are affected (both packages are versioned together, so select both if in doubt)
2. Choose a bump type — `patch` (bug fix), `minor` (new feature), or `major` (breaking change)
3. Write a short summary of the change

A file like `.changeset/purple-foxes-dance.md` is created. Commit it with your PR.

If your change doesn't affect the published packages (e.g. CI config, docs, test-only changes), you can skip the changeset by adding an empty one:

```sh
npx changeset --empty
```

## Release Process

Releases are automated via GitHub Actions using [Changesets](https://github.com/changesets/changesets).

### How it works

1. **PRs land on `main`** with changeset files in `.changeset/`
2. The **Release** workflow detects pending changesets and opens (or updates) a **"Version Packages"** PR that:
   - Bumps versions in `package.json` files
   - Updates `CHANGELOG.md` in each package
   - Removes the consumed changeset files
3. **When you're ready to release**, merge the "Version Packages" PR. This triggers the workflow again, which builds and publishes both packages to npm

You don't need to release after every merge. The "Version Packages" PR is automatically kept up-to-date as more changesets land on `main` — it accumulates all pending changes into a single version bump with a combined CHANGELOG. Just leave it open until you're ready to publish.

Both packages use **fixed versioning** — they always share the same version number.

### Pre-release mode

When preparing a major release, the repo may be in pre-release mode. In this mode versions get a `-pre.N` suffix (e.g. `5.0.0-pre.0`) and packages are published under the `pre` dist-tag.

```sh
# Enter pre-release mode (already done for v5)
npx changeset pre enter pre

# Exit pre-release mode for the final release
npx changeset pre exit
```

While in pre-release mode, the normal changeset workflow still applies — add changesets to PRs, merge, and the "Version Packages" PR will bump the pre-release number.

### Important: don't version on feature branches

Never run `npx changeset version` on a feature branch. This bumps versions and creates CHANGELOGs, which makes the Release workflow think it should publish immediately when the branch merges. Version bumping is handled automatically by the "Version Packages" PR.

### Publishing a release manually

Normally releases are fully automated. If you need to publish manually:

```sh
npx changeset version   # bump versions and update changelogs
npm run release          # build + publish all packages
```
