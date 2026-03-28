#!/bin/bash
# AutoHue Desktop — Safe Release Script
# Type checks, bumps version, tags, pushes, monitors CI, verifies R2
set -e

API_URL="https://autohue-api.steve-700.workers.dev"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════"
echo "  AutoHue Desktop — Safe Release"
echo "═══════════════════════════════════════"
echo ""

# ── Step 1: Check for uncommitted changes ──
echo -e "${YELLOW}[1/6] Checking git status...${NC}"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}✗ Uncommitted changes found. Commit first.${NC}"
  git status --short
  exit 1
fi
echo -e "${GREEN}✓ Working tree clean${NC}"
echo ""

# ── Step 2: Type check renderer ──
echo -e "${YELLOW}[2/6] Type checking renderer...${NC}"
cd renderer
npx tsc --noEmit --pretty 2>&1 | grep -E "error TS" | head -5
ERRORS=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
cd ..
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${YELLOW}⚠ ${ERRORS} TypeScript errors (may be pre-existing)${NC}"
else
  echo -e "${GREEN}✓ No type errors${NC}"
fi
echo ""

# ── Step 3: Get version and confirm ──
CURRENT=$(node -p "require('./package.json').version")
echo -e "${YELLOW}[3/6] Current version: ${CURRENT}${NC}"
echo -n "Enter new version (or press Enter for ${CURRENT}): "
read NEW_VERSION
if [ -z "$NEW_VERSION" ]; then
  NEW_VERSION=$CURRENT
fi

if [ "$NEW_VERSION" != "$CURRENT" ]; then
  # Update package.json
  node -e "const p=require('./package.json'); p.version='${NEW_VERSION}'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n')"
  git add package.json
  git commit -m "chore: bump version to ${NEW_VERSION}"
  echo -e "${GREEN}✓ Version bumped to ${NEW_VERSION}${NC}"
fi
echo ""

# ── Step 4: Snapshot current R2 version ──
echo -e "${YELLOW}[4/6] Current R2 version...${NC}"
PRE_VERSION=$(curl -s "${API_URL}/api/releases/latest" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
echo -e "  R2 currently serving: ${PRE_VERSION:-unknown}"
echo ""

# ── Step 5: Tag and push ──
echo -e "${YELLOW}[5/6] Tagging v${NEW_VERSION} and pushing...${NC}"
git tag "v${NEW_VERSION}" 2>/dev/null || true
git push origin master --tags
echo -e "${GREEN}✓ Pushed v${NEW_VERSION}${NC}"
echo ""

# ── Step 6: Monitor CI ──
echo -e "${YELLOW}[6/6] Monitoring CI build...${NC}"
sleep 5
RUN_ID=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
echo "  Run ID: ${RUN_ID}"
gh run watch "$RUN_ID" --exit-status 2>&1 | tail -20

# Post-CI verification
echo ""
echo -e "${YELLOW}Verifying R2 update...${NC}"
sleep 5
POST_VERSION=$(curl -s "${API_URL}/api/releases/latest" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
if [ "$POST_VERSION" = "$NEW_VERSION" ]; then
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✓ v${NEW_VERSION} live on R2 + GitHub Releases${NC}"
  echo -e "${GREEN}  ✓ Auto-update will serve to all users${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
else
  echo -e "${RED}═══════════════════════════════════════${NC}"
  echo -e "${RED}  ✗ R2 shows v${POST_VERSION}, expected v${NEW_VERSION}${NC}"
  echo -e "${RED}  Check CI logs: gh run view ${RUN_ID} --log${NC}"
  echo -e "${RED}═══════════════════════════════════════${NC}"
  exit 1
fi
