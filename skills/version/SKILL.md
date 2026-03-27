---
name: version
description: "Version control for ClawSQL: bump versions, update version references across codebase, prepare for npm publish. Use when: (1) releasing a new version, (2) updating version numbers, (3) preparing for npm publish, (4) checking current version consistency."
metadata:
  openclaw:
    emoji: "🏷️"
    requires:
      bins: ["node", "npm"]
---

# Version Control Skill

Manage ClawSQL version numbers across the codebase and prepare for npm publishing.

## When to Use

✅ **USE this skill when:**

- Preparing a new release
- Bumping version numbers
- Ensuring version consistency across files
- Publishing to npm
- Checking version alignment between code and package.json

❌ **DON'T use this skill when:**

- Regular development work
- Bug fixes that don't require version changes
- Working on features (update version at release time)

## Version Files

The version is now defined in a single source of truth (`package.json`), which other files reference:

| File | Field/Pattern | Description |
|------|---------------|-------------|
| `package.json` | `version` | **Source of truth** - NPM package version |
| `src/config/settings.ts` | `appVersion` default | Imports version from package.json |
| `src/__tests__/config/settings.test.ts` | test expectation | Imports version from package.json |
| `src/__tests__/utils/logger.test.ts` | mock settings | Imports version from package.json |
| `src/__tests__/cli/repl.test.ts` | mock settings | Imports version from package.json |

**Note**: Do not hardcode version numbers in any file. Always import from `package.json`.

## Commands

### Check Current Version

```bash
# Check npm published version
npm view clawsql version

# Check local package.json version
node -e "console.log(require('./package.json').version)"

# Check CLI --version output
node dist/bin/clawsql.js --version

# Check banner version
node -e "const {createBanner} = require('./dist/cli/ui/components.js'); console.log(createBanner({version: 'X.Y.Z'}))"
```

### Bump Version

**Step 1: Determine next version**

```bash
# Get current npm version
CURRENT=$(npm view clawsql version)
echo "Current npm version: $CURRENT"

# Determine bump type:
# - Patch (bug fixes): 0.1.9 → 0.1.10
# - Minor (new features): 0.1.9 → 0.2.0
# - Major (breaking changes): 0.1.9 → 1.0.0
```

**Step 2: Update version reference**

Since all files import from `package.json`, you only need to update one file:

1. `package.json`:
   ```json
   "version": "X.Y.Z"
   ```

All other files (settings.ts, tests) will automatically use the new version.

**Step 3: Verify changes**

```bash
# Build
npm run build

# Run tests
npm test

# Verify version output
node dist/bin/clawsql.js --version
```

### Git Commit

```bash
# Commit version bump (only package.json needed - other files auto-sync)
git add package.json
git commit -m "bump version to X.Y.Z"
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

### Publish to NPM

```bash
# Ensure you're logged in
npm whoami

# Dry run to verify package contents
npm pack --dry-run

# Publish (use --tag for pre-releases)
npm publish              # for stable release
npm publish --tag beta   # for beta release
npm publish --tag next   # for next/canary release

# Verify publication
npm view clawsql version
```

## Version Strategy

### Semantic Versioning (SemVer)

- **MAJOR (X.0.0)**: Breaking changes, incompatible API changes
- **MINOR (0.X.0)**: New features, backwards compatible
- **PATCH (0.0.X)**: Bug fixes, backwards compatible

### When to Bump

| Change Type | Version Bump |
|-------------|--------------|
| Bug fix | PATCH |
| New feature | MINOR |
| New CLI command | MINOR |
| API endpoint added | MINOR |
| Breaking config change | MAJOR |
| Dependency update (major) | MAJOR/MINOR depending on impact |
| Documentation update | No version bump needed |
| Test updates | No version bump needed |

## Pre-release Checklist

1. [ ] All tests passing: `npm test`
2. [ ] Build successful: `npm run build`
3. [ ] Version bumped in all files
4. [ ] CHANGELOG updated (if applicable)
5. [ ] Git tag created
6. [ ] npm publish dry-run successful

## Troubleshooting

### Version Mismatch

If versions are out of sync:

```bash
# Find all version references
grep -rn "0\.[0-9]\+\.[0-9]\+" src/ --include="*.ts" --include="*.json"

# Check for hardcoded versions in app.ts
grep -n "version:" src/app.ts
```

### npm Publish Failed

Common causes:
- Not logged in: `npm login`
- Version already exists: bump version
- 2FA required: use OTP

### Git Tag Already Exists

```bash
# Delete local tag
git tag -d vX.Y.Z

# Delete remote tag
git push origin --delete vX.Y.Z

# Recreate tag
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

## Automation

For automated releases, consider using:

```bash
# Using npm version (updates package.json only)
npm version patch  # or minor, major

# Then manually update other files
```

## Related Documentation

- [npm publish docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)