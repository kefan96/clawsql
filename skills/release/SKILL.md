---
name: release
description: "Release ClawSQL: bump version, commit, tag, push to GitHub, npm, and Docker Hub. Use when: (1) releasing a new version, (2) publishing to npm/Docker, (3) creating git tags, (4) full release workflow."
metadata:
  openclaw:
    emoji: "🚀"
    requires:
      bins: ["git", "node", "npm", "docker"]
---

# Release Skill

Complete release workflow for ClawSQL: version bump, git commit/tag, GitHub push, npm publish, Docker Hub push.

## When to Use

✅ **USE this skill when:**

- Performing a full release
- Publishing new version to npm
- Pushing Docker images
- Creating git release tags
- End-to-end release process

❌ **DON'T use this skill when:**

- Regular development work
- Only bumping version (use `/version` skill)
- CI/CD automated releases

## Pre-release Checklist

Before releasing, verify:

1. All tests pass: `npm test`
2. Build successful: `npm run build`
3. Version bumped in `package.json` (source of truth)
4. No pending changes that need to be in this release

## Release Workflow

### Step 1: Version Bump

```bash
# Check current npm version
CURRENT=$(npm view clawsql version)
echo "Current npm version: $CURRENT"

# Determine next version (patch/minor/major)
# - Patch (bug fixes): 0.2.0 → 0.2.1
# - Minor (new features): 0.2.0 → 0.3.0
# - Major (breaking changes): 0.2.0 → 1.0.0

# Update package.json (this is the ONLY file to update - others auto-sync)
# Edit package.json: "version": "X.Y.Z"
```

### Step 2: Build and Test

```bash
# Build TypeScript
npm run build

# Run all tests
npm test

# Verify CLI works
node dist/bin/clawsql.js --version
```

### Step 3: Git Commit and Tag

```bash
# Stage all changes
git add package.json src/ docs/ skills/ docker/ # etc.

# Create commit
git commit -m "X.Y.Z: brief description of changes"

# Create annotated tag
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

### Step 4: Push to GitHub

```bash
# Push commit and tag
git push origin master
git push origin vX.Y.Z
```

### Step 5: Publish to npm

```bash
# Verify login
npm whoami

# Publish
npm publish

# For pre-release versions:
npm publish --tag beta    # beta release
npm publish --tag next    # canary/next release

# Verify publication
npm view clawsql version
```

### Step 6: Push to Docker Hub

```bash
# Build Docker image (Node.js version)
docker build -f docker/Dockerfile.node -t kefan96/clawsql:X.Y.Z -t kefan96/clawsql:latest .

# Push to Docker Hub
docker push kefan96/clawsql:X.Y.Z
docker push kefan96/clawsql:latest

# Verify image
docker pull kefan96/clawsql:latest
docker run --rm kefan96/clawsql:latest node dist/bin/clawsql.js --version
```

## Quick Release Script

For a complete release from start to finish:

```bash
VERSION="0.2.1"  # Set your target version

# 1. Update package.json version
# (manual edit or: npm version patch/minor/major)

# 2. Build and test
npm run build && npm test

# 3. Commit and tag
git add -A
git commit -m "$VERSION: release summary"
git tag -a "v$VERSION" -m "Release $VERSION"

# 4. Push to GitHub
git push origin master && git push origin "v$VERSION"

# 5. Publish to npm
npm publish

# 6. Push to Docker Hub
docker build -f docker/Dockerfile.node -t kefan96/clawsql:$VERSION -t kefan96/clawsql:latest .
docker push kefan96/clawsql:$VERSION && docker push kefan96/clawsql:latest
```

## Docker Image Details

- **Registry**: `kefan96/clawsql`
- **Dockerfile**: `docker/Dockerfile.node`
- **Base image**: `node:20-alpine`
- **Tags**: version tag + `latest`

## Troubleshooting

### npm Publish Failed

Common issues:
- Not logged in: `npm login`
- Version already exists: bump version higher
- 2FA required: use OTP with `npm publish --otp=<code>`

### Docker Push Failed

Common issues:
- Not logged in: `docker login`
- Image name wrong: verify `kefan96/clawsql` namespace
- Permission denied: check Docker Hub account permissions

### Git Tag Already Exists

```bash
# Delete local tag
git tag -d vX.Y.Z

# Delete remote tag
git push origin --delete vX.Y.Z

# Recreate tag
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin vX.Y.Z
```

### Tests Failing

Do not release if tests fail:
- Fix the failing tests first
- Run `npm test` until all pass
- Consider using `npm run test:coverage` for detailed analysis

## Post-release Verification

After completing release:

```bash
# Verify npm package
npm info clawsql version

# Verify Docker image
docker pull kefan96/clawsql:latest

# Verify GitHub tag
git ls-remote --tags origin | grep vX.Y.Z

# Test fresh install
npm install -g clawsql@latest
clawsql --version
```

## Related Skills

- [Version Control](../version/SKILL.md) - Version bumping details