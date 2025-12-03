# Contributing to Philadelphia Crime Dashboard + Route Safety Diary

Thank you for your interest in contributing! This document provides guidelines for contributing code, documentation, and other improvements to the project.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Code Style Guidelines](#code-style-guidelines)
5. [Testing Requirements](#testing-requirements)
6. [Pull Request Process](#pull-request-process)
7. [Branch Naming Conventions](#branch-naming-conventions)
8. [Commit Message Guidelines](#commit-message-guidelines)
9. [Documentation Standards](#documentation-standards)
10. [Feature Flag Pattern](#feature-flag-pattern)
11. [Performance Guidelines](#performance-guidelines)
12. [Accessibility Requirements](#accessibility-requirements)
13. [Release Process](#release-process)

---

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- **Be respectful:** Treat all contributors with respect and courtesy
- **Be constructive:** Provide helpful feedback and suggestions
- **Be inclusive:** Welcome contributors of all backgrounds and skill levels
- **Be professional:** Keep discussions focused on the project

Violations can be reported to the project maintainers.

---

## Getting Started

### Prerequisites

- Node.js 20+ (we test on v22.18.0)
- npm 10+
- Git
- A code editor (VS Code recommended)

### Initial Setup

1. **Fork the repository** on GitHub
2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/engagement-project.git
   cd engagement-project
   ```
3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/engagement-project.git
   ```
4. **Install dependencies:**
   ```bash
   npm install
   ```
5. **Create a feature branch:**
   ```bash
   git checkout -b feat/your-feature-name
   ```
6. **Start development server:**
   ```bash
   npm run dev
   ```

---

## Development Workflow

### 1. Sync with Upstream

Before starting work, sync your fork:

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

### 2. Create Feature Branch

```bash
git checkout -b feat/your-feature-name
```

See [Branch Naming Conventions](#branch-naming-conventions) for naming rules.

### 3. Make Changes

- Write code following [Code Style Guidelines](#code-style-guidelines)
- Add tests for new features
- Update documentation as needed

### 4. Test Locally

```bash
npm test                  # Run all tests
npm run build             # Verify build succeeds
npm run preview           # Test production build
```

### 5. Commit Changes

```bash
git add .
git commit -m "feat(diary): add safety trend chart"
```

See [Commit Message Guidelines](#commit-message-guidelines).

### 6. Push and Create PR

```bash
git push origin feat/your-feature-name
```

Then create a pull request on GitHub.

---

## Code Style Guidelines

### JavaScript

**Style:** ES6+ with vanilla JavaScript (no JSX, no TypeScript)

**Key Rules:**
- Use `const` for immutable bindings, `let` for mutable (never `var`)
- Prefer arrow functions for callbacks
- Use template literals for string interpolation
- Use destructuring where appropriate
- Avoid jQuery or other DOM manipulation libraries (use native APIs)

**Example:**
```javascript
// ✅ Good
const fetchSegments = async (bbox) => {
  const response = await fetch(`/api/segments?bbox=${bbox}`)
  const { segments } = await response.json()
  return segments
}

// ❌ Bad
var fetchSegments = function(bbox) {
  return fetch('/api/segments?bbox=' + bbox).then(function(response) {
    return response.json().then(function(data) {
      return data.segments
    })
  })
}
```

### Formatting

We use **Prettier** with these settings:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
```

**Format code before committing:**
```bash
npm run format
```

### Linting

We use **ESLint** for code quality:

```bash
npm run lint        # Check for errors
npm run lint:fix    # Auto-fix issues
```

**Key Rules:**
- No unused variables
- No console.log in production code (use console.warn/error only)
- Prefer strict equality (===) over loose (==)
- No implicit globals

---

## Testing Requirements

### Unit Tests

**Framework:** Jest
**Location:** `src/**/*.test.js` (co-located with source files)

**Example:**
```javascript
// src/utils/decay.test.js
import { weightFor } from './decay.js'

describe('weightFor', () => {
  it('calculates exponential decay correctly', () => {
    const now = Date.now()
    const sample21DaysAgo = now - (21 * 86400000)
    const weight = weightFor(sample21DaysAgo, now, 21)
    expect(weight).toBeCloseTo(0.5, 2)
  })

  it('returns 1.0 for current timestamp', () => {
    const now = Date.now()
    expect(weightFor(now, now, 21)).toBe(1.0)
  })
})
```

**Run unit tests:**
```bash
npm run test:unit
npm run test:unit:watch   # Watch mode for TDD
```

### Integration Tests

**Framework:** Mocha + Supertest
**Location:** `test/integration/**/*.test.js`

**Example:**
```javascript
// test/integration/api.test.js
import request from 'supertest'
import app from '../../src/app.js'

describe('POST /api/v1/diary/ratings', () => {
  it('should accept valid rating', async () => {
    const res = await request(app)
      .post('/api/v1/diary/ratings')
      .send({
        segment_id: 'seg_001',
        rating: 4,
        tags: ['well-lit', 'busy']
      })
      .expect(201)

    expect(res.body).toHaveProperty('rating_id')
  })

  it('should reject invalid rating', async () => {
    await request(app)
      .post('/api/v1/diary/ratings')
      .send({ segment_id: 'seg_001', rating: 7 })
      .expect(400)
  })
})
```

### End-to-End Tests

**Framework:** Playwright
**Location:** `test/e2e/**/*.spec.js`

**Example:**
```javascript
// test/e2e/hover-card.spec.js
import { test, expect } from '@playwright/test'

test('hover card displays correct content', async ({ page }) => {
  await page.goto('http://localhost:5173')

  // Wait for map to load
  await page.waitForSelector('.maplibregl-canvas')

  // Hover over a segment
  await page.hover('[data-segment-id="seg_001"]')

  // Verify hover card appears
  const card = page.locator('.hover-card')
  await expect(card).toBeVisible()
  await expect(card.locator('h3')).toContainText('Market St')
  await expect(card.locator('.rating')).toContainText('★')
})
```

### Coverage Requirements

- **Target:** 80% line coverage for all source files
- **Check coverage:**
  ```bash
  npm run test:coverage
  ```
- **Coverage report:** Generated in `coverage/lcov-report/index.html`

### Pre-Commit Checks

All tests must pass before committing:

```bash
npm run precommit   # Runs lint + format + test
```

---

## Pull Request Process

### 1. PR Title Format

Use conventional commit format:

```
<type>(<scope>): <description>

Examples:
feat(diary): add safety trend chart
fix(map): correct segment opacity calculation
docs(readme): update installation instructions
```

### 2. PR Description Template

```markdown
## Description
Brief summary of changes.

## Related Issue
Fixes #123

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to break)
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added to complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests pass locally
- [ ] Coverage maintained or improved
```

### 3. Review Process

1. **Automated checks:** CI pipeline must pass (lint, test, build)
2. **Code review:** At least one maintainer approval required
3. **Testing:** Reviewer verifies functionality in local environment
4. **Documentation:** Reviewer checks docs are updated
5. **Merge:** Maintainer merges using "Squash and merge"

### 4. After Merge

- Delete feature branch (both local and remote)
- Update local main:
  ```bash
  git checkout main
  git pull upstream main
  git push origin main
  ```

---

## Branch Naming Conventions

### Format

```
<type>/<short-description>

Examples:
feat/diary-trend-chart
fix/segment-opacity-bug
docs/api-specification
refactor/decay-calculation
test/simulator-e2e
chore/upgrade-dependencies
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, no logic change)
- **refactor:** Code refactoring (no feature change)
- **perf:** Performance improvements
- **test:** Adding or updating tests
- **chore:** Build process, dependencies, tooling

### Rules

- Use lowercase with hyphens (no underscores or camelCase)
- Keep description short (< 30 chars)
- Use present tense ("add feature" not "added feature")

---

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Examples

**Feature:**
```
feat(diary): add alternative route overlay

Implement U5 functionality with:
- Green dashed line for alt route
- Benefit summary card showing distance delta and safety gain
- Toggle button to show/hide overlay

Closes #45
```

**Bug Fix:**
```
fix(map): correct segment opacity for low confidence

Changed formula from n_eff / 5 to n_eff / 10 to match spec.
Segments with n_eff < 5 now have opacity < 0.7 as intended.

Fixes #67
```

**Documentation:**
```
docs(api): add M2 specification documents

Created 5 detailed spec docs for Agent-I implementation:
- DIARY_SPEC_M2.md
- CHARTS_SPEC_M2.md
- API_BACKEND_DIARY_M2.md
- SQL_SCHEMA_DIARY_M2.md
- TEST_PLAN_M2.md
```

### Rules

- **Type:** Required (feat, fix, docs, style, refactor, perf, test, chore)
- **Scope:** Optional (diary, map, charts, api, db, docs)
- **Subject:** Required, imperative mood ("add" not "adds" or "added"), lowercase, no period
- **Body:** Optional, explain *what* and *why* (not *how*)
- **Footer:** Optional, reference issues ("Fixes #123", "Closes #45")

---

## Documentation Standards

### Code Comments

**Use comments to explain *why*, not *what*:**

```javascript
// ✅ Good: Explains reasoning
// Use 21-day half-life to balance recent data with historical context
const HALF_LIFE_DAYS = 21

// ❌ Bad: States the obvious
// Set HALF_LIFE_DAYS to 21
const HALF_LIFE_DAYS = 21
```

**Document complex algorithms:**

```javascript
/**
 * Calculates time-decayed weight for a rating using exponential decay.
 *
 * Formula: 2^(-days_ago / half_life)
 * - Recent ratings (0 days ago) → weight = 1.0
 * - Ratings at 1 half-life → weight = 0.5
 * - Ratings at 2 half-lives → weight = 0.25
 *
 * @param {number} sampleTimestamp - Unix timestamp of rating submission
 * @param {number} nowTimestamp - Current Unix timestamp
 * @param {number} halfLifeDays - Half-life in days (default 21)
 * @returns {number} Weight value [0, 1]
 */
export function weightFor(sampleTimestamp, nowTimestamp, halfLifeDays = 21) {
  const dtDays = Math.max(0, (nowTimestamp - sampleTimestamp) / 86400000)
  return Math.pow(2, -dtDays / halfLifeDays)
}
```

### Markdown Documentation

**All docs must:**
- Have a top-level H1 heading
- Include a table of contents for docs > 200 lines
- Use code blocks with language hints (```javascript, ```sql, ```bash)
- Link to related documents
- Include examples where applicable

**File locations:**
- User guides → `docs/`
- API specs → `docs/`
- Audit reports → `logs/`
- README → project root

---

## Feature Flag Pattern

**All new features must be feature-flagged** during development to allow safe iteration without affecting production.

### Implementation

**1. Add flag to config:**
```javascript
// src/config.js
export const FEATURES = {
  DIARY: import.meta.env.VITE_FEATURE_DIARY === '1',
  CHARTS: import.meta.env.VITE_FEATURE_CHARTS === '1',
}
```

**2. Set flag in environment:**
```bash
# .env.local
VITE_FEATURE_DIARY=1
VITE_FEATURE_CHARTS=0
```

**3. Guard feature code:**
```javascript
// src/main.js
import { FEATURES } from './config.js'

if (FEATURES.DIARY) {
  const { initDiary } = await import('./routes_diary/index.js')
  initDiary(map)
}
```

**4. Conditional UI:**
```javascript
// src/ui/panel.js
if (FEATURES.DIARY) {
  const diaryTab = document.createElement('button')
  diaryTab.textContent = 'Route Safety'
  diaryTab.onclick = () => showDiary()
  tabContainer.appendChild(diaryTab)
}
```

### Rules

- **Never commit with flags enabled** unless feature is ready for production
- **Remove flags** after feature is stable and merged to main
- **Document flags** in README under "Feature Flags" section

---

## Performance Guidelines

### Map Rendering

- **Target:** Map refresh <5 seconds for 95% of operations
- **Clustering:** Enable for >10,000 points
- **Bbox filtering:** Always constrain queries to viewport
- **Debounce:** Use 300ms debounce for map move events

**Example:**
```javascript
let moveTimeout = null
map.on('move', () => {
  clearTimeout(moveTimeout)
  moveTimeout = setTimeout(() => {
    updateMapData(map.getBounds())
  }, 300)
})
```

### API Calls

- **Cache:** Use in-memory cache for static data (segments, routes)
- **Batch:** Combine multiple requests where possible
- **Abort:** Cancel pending requests on new user action

**Example:**
```javascript
let abortController = null

async function fetchSegments(bbox) {
  // Cancel previous request
  if (abortController) abortController.abort()

  abortController = new AbortController()
  const response = await fetch(`/api/segments?bbox=${bbox}`, {
    signal: abortController.signal
  })
  return response.json()
}
```

### Bundle Size

- **Target:** Keep main bundle <200 KB gzipped
- **Code splitting:** Use dynamic imports for large features
- **Tree shaking:** Avoid importing entire libraries (use named imports)

**Check bundle size:**
```bash
npm run build
# Inspect dist/ with vite-plugin-visualizer
```

---

## Accessibility Requirements

**All UI must meet WCAG 2.1 AA standards.**

### Keyboard Navigation

- All interactive elements must be keyboard accessible (Tab, Enter, Space, Escape)
- Focus indicators must be visible (2px solid ring, 2px offset)
- Tab order must be logical

### Screen Readers

- Use semantic HTML (`<button>`, `<nav>`, `<main>`, etc.)
- Add ARIA labels where semantic HTML is insufficient
- Ensure dynamic content changes are announced (aria-live)

**Example:**
```javascript
const button = document.createElement('button')
button.textContent = 'Show alternative route'
button.setAttribute('aria-label', 'Show alternative route on map')
button.setAttribute('aria-pressed', 'false')

button.addEventListener('click', () => {
  const isPressed = button.getAttribute('aria-pressed') === 'true'
  button.setAttribute('aria-pressed', String(!isPressed))
  button.textContent = isPressed ? 'Show alternative route' : 'Hide alternative route'
})
```

### Color Contrast

- Text: Minimum 4.5:1 contrast ratio (WCAG AA)
- Graphics: Minimum 3:1 contrast ratio
- Do not rely on color alone (use icons, text, patterns)

**Check with tools:**
- Chrome DevTools Lighthouse
- WAVE browser extension
- axe DevTools

### Testing

- Test with keyboard only (no mouse)
- Test with screen reader (NVDA on Windows, VoiceOver on macOS)
- Test with browser zoom at 200%
- Test with color blindness simulators

---

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR:** Breaking changes (e.g., v1.0.0 → v2.0.0)
- **MINOR:** New features (e.g., v1.0.0 → v1.1.0)
- **PATCH:** Bug fixes (e.g., v1.0.0 → v1.0.1)

### Release Steps

1. **Update version:**
   ```bash
   npm version minor   # Or major/patch
   ```

2. **Update CHANGELOG.md:**
   ```markdown
   ## [1.1.0] - 2025-11-11
   ### Added
   - Route Safety Diary feature (U0-U7)
   - Alternative route overlay with benefit summary

   ### Fixed
   - Segment opacity calculation for low confidence
   ```

3. **Create release branch:**
   ```bash
   git checkout -b release/v1.1.0
   git push origin release/v1.1.0
   ```

4. **Merge to main:**
   - Create PR from release branch to main
   - Wait for CI to pass
   - Get approval from maintainers
   - Merge using "Create a merge commit"

5. **Tag release:**
   ```bash
   git checkout main
   git pull
   git tag -a v1.1.0 -m "Release v1.1.0: Route Safety Diary M1"
   git push origin v1.1.0
   ```

6. **Deploy:**
   - Automated deployment triggered by tag push
   - Or manual: `npm run deploy`

7. **Announce:**
   - Create GitHub Release with changelog
   - Notify contributors in Discussions

---

## Questions?

- **Slack:** #engagement-project (internal)
- **GitHub Discussions:** [Project Discussions](https://github.com/ORIGINAL_OWNER/engagement-project/discussions)
- **Email:** maintainer@example.com

---

**Thank you for contributing!** 🎉

Your contributions help make safer, more informed communities.
