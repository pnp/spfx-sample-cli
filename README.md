# @pnp/spfx-sample

Fetch a single SPFx sample from `pnp/sp-dev-fx-webparts` and `pnp/sp-dev-fx-extensions` **without cloning the entire repo**.

This CLI supports two download strategies:

- **Git (recommended):** partial clone + sparse checkout (fast + best for contributors)
- **API (tokenless fallback):** downloads only the sample files via GitHub APIs (no git required)


## Requirements

- **Node.js:** >= 18
- **Git (for `--method git` / default `auto` when git is installed):** Git >= 2.25 (for sparse checkout cone mode)

## Install / Run

Run without installing:

```bash
npx @pnp/spfx-sample get react-hello-world
```

Or install globally:

```bash
npm i -g @pnp/spfx-sample
spfx-sample get react-hello-world
```

## Basic usage

```bash
spfx-sample get <sample-folder> [options]
```

Examples:

```bash
# Fetch a sample into ./react-hello-world (default)
spfx-sample get react-hello-world

# You can also include "samples/" prefix
spfx-sample get samples/react-hello-world

# Pick a branch/tag/commit
spfx-sample get react-hello-world --ref main

# Choose destination
spfx-sample get react-hello-world --dest ./my-sample

# Overwrite existing destination
spfx-sample get react-hello-world --force

# Download a sample from a different repo
spfx-sample get jquery-application-toastr --repo sp-dev-fx-extensions
spfx-sample get BasicCard-CardComposition --repo sp-dev-fx-aces
```

Defaults (unless overridden):

- `--owner pnp`
- `--repo sp-dev-fx-webparts`
- `--ref main`


## Methods: `--method auto|git|api`

### `--method auto` (default)

- Uses **git** if git is available
- Otherwise falls back to **api**

```bash
spfx-sample get react-hello-world --method auto
```

### `--method git`

Uses **partial clone + sparse checkout** to fetch only the selected sample content.

```bash
spfx-sample get react-hello-world --method git
```

### `--method api`

Tokenless fallback (no git required). Downloads only the files under the sample folder.

```bash
spfx-sample get react-hello-world --method api
```

Note: GitHub’s anonymous API has rate limits (typically 60 requests/hour per IP). If you hit rate limits, use the git method.

---

## Modes (git only): `--mode extract|repo`

### `--mode extract` (default)

- Fetches the sample
- Writes only the sample contents to `--dest`
- No `.git` folder

```bash
spfx-sample get react-hello-world --mode extract
```

### `--mode repo` (contributor mode)

- Creates a sparse git working copy in `--dest`
- Leaves `.git` intact so you can branch/commit/PR
- Sample is located at: `dest/samples/<sample-folder>`

```bash
spfx-sample get react-hello-world --mode repo --method git --dest ./work
cd ./work
git checkout -b my-change
```

> `--mode repo` requires `--method git` (API mode cannot create a git repo).

## Local development

### Install dependencies

```bash
npm ci
```

### Build

```bash
npm run build
```

### Run locally

```bash
node dist/cli.js --help
node dist/cli.js get react-hello-world
```

## Test locally without publishing

### Option A: Run via `npx` from the local folder (fastest loop)

```bash
npm run build
npx --no-install . --help
npx --no-install . get react-hello-world
```

### Option B: Link globally (tests global CLI behavior)

```bash
npm run build
npm link
spfx-sample --help
spfx-sample get react-hello-world
```

Unlink later:

```bash
npm unlink -g @pnp/spfx-sample
```

### Option C: Test the real “published artifact” via `npm pack` (closest to publishing)

```bash
npm run build
npm pack
```

This creates a `.tgz` file. In a clean folder:

```bash
mkdir ../spfx-sample-test
cd ../spfx-sample-test
npm init -y
npm i ../path/to/<the-tgz-file>.tgz
npx spfx-sample --help
npx spfx-sample get react-hello-world
```

## Contributing / Commit conventions

This repo uses **semantic-release**, which determines version bumps from **Conventional Commits**.

Use commit messages like:

- `feat(cli): add --method api fallback` → **minor**
- `fix(git): handle sparse checkout edge case` → **patch**
- `feat!: change default command behavior` → **major**
- Include `BREAKING CHANGE:` in the commit body to force a major bump

If you don’t use `feat:`/`fix:` (or another release-triggering type), **no release will be published**.


## Publishing (semantic-release)

Publishing happens automatically from `main`:

1. Merge PR(s) into `main`
2. GitHub Actions runs the Release workflow
3. `semantic-release`:
   - calculates next version from commits
   - updates `CHANGELOG.md`
   - creates a GitHub Release + tag
   - publishes to npm as `@pnp/spfx-sample`

### Notes

- Do **not** manually edit `version` for releases. semantic-release controls it.
- Scoped packages must be published as public — this repo uses `publishConfig.access = "public"`.

### Dry run (no publish)

To see what semantic-release *would* do:

```bash
npm run release:dry
```

## Repo / Package names

- GitHub repo: `pnp/spfx-sample-cli`
- npm package: `@pnp/spfx-sample`
- CLI command: `spfx-sample`
