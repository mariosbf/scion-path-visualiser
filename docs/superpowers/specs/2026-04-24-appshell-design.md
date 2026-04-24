# AppShell Design

**Date:** 2026-04-24  
**Status:** Approved

## Overview

Add a Mantine 9 `AppShell` with a collapsible icon+label sidebar to the SCION path visualiser. No top header. Default dark theme, user-configurable light/dark.

## Architecture

`App.tsx` is the layout root. It owns `colorScheme` state (default `"dark"`) passed to `MantineProvider`, and a `useDisclosure` hook for sidebar expanded/collapsed state.

```
App.tsx
├── MantineProvider (colorScheme state)
│   └── AppShell (navbar width: 220px expanded, 60px collapsed)
│       ├── AppShell.Navbar
│       │   ├── NavHeader (logo + toggle button)
│       │   ├── NavItem × 2
│       │   └── ThemeToggle (bottom of sidebar)
│       └── AppShell.Main
│           └── placeholder content
```

## Components

### NavHeader (`src/components/NavHeader.tsx`)

Top of the sidebar. App name left-aligned, `IconLayoutSidebar` (tabler) toggle button right-aligned. When collapsed, the app name is hidden and only the icon remains.

### NavItem (`src/components/NavItem.tsx`)

Single nav entry: tabler icon on the left, text label on the right. Label hidden when sidebar is collapsed. Hover effect: subtle background highlight using Mantine's dark-5 / gray-1 color tokens depending on theme.

**Placeholder items:**
- "Projects" — `IconFolderOpen`
- "Settings" — `IconSettings`

### Theme Toggle

Button pinned to the bottom of the sidebar. Uses `IconSun` / `IconMoon` (tabler) to reflect current scheme. Flips `colorScheme` between `"light"` and `"dark"`. Icon-only when collapsed.

## Sidebar Behaviour

| State | Width | App name | Nav labels | Theme label |
|-------|-------|----------|------------|-------------|
| Expanded | 220px | Visible | Visible | Visible |
| Collapsed | 60px | Hidden | Hidden | Hidden |

Collapse is toggled by the `IconLayoutSidebar` button in `NavHeader`.

## Theme

- Default: `"dark"`
- `colorScheme` stored in React state in `App.tsx`, passed as `defaultColorScheme` (or `colorScheme`) to `MantineProvider`
- No persistence in v1 (resets to dark on reload)

## File Changes

| File | Action |
|------|--------|
| `src/App.tsx` | Rewrite — AppShell layout, colorScheme state |
| `src/App.css` | Trim — remove layout rules superseded by Mantine |
| `src/components/NavHeader.tsx` | New |
| `src/components/NavItem.tsx` | New |

## Out of Scope

- Routing (no React Router in v1)
- Persisted theme preference
- Active/selected nav item state
- Icon-only tooltip on collapsed items
