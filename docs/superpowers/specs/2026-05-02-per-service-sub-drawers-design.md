# Per-Service Sub-Drawers Design

**Date:** 2026-05-02  
**Status:** Approved

## Problem

The AS details pane currently uses two drawers: `detail` (AS overview) and `services` (flat list of all services with log links). This gives no per-service detail view and requires an intermediate screen to reach log navigation.

## Goal

Replace the intermediate services drawer with direct per-service sub-drawers. Clicking a service button in the AS detail drawer opens a sub-drawer showing that service's fields and a "View Logs" button.

## Drawer Stack Shape

`useDrawersStack` registers four IDs:

```
["detail", "service-control", "service-daemon", "service-hbird"]
```

Four `<Drawer>` elements inside `<DrawerStack>`:

| ID | Content | When rendered |
|----|---------|---------------|
| `detail` | Existing AS/router/ISD/edge details | Always |
| `service-control` | Control Service sub-drawer | Always (only opened for AS nodes) |
| `service-daemon` | SCION Daemon sub-drawer | Always (only opened for AS nodes) |
| `service-hbird` | Hummingbird sub-drawer | Always registered; only opened when `hbird_info !== null` |

The existing `"services"` drawer and `ServicesPanel` component are deleted.

## `AsDetails` Changes

The single "View Services" button is replaced with one button per service:

- **Control Service** — always shown, label = `node.control_service.name`, opens `"service-control"`
- **SCION Daemon** — always shown, label = `node.daemon_info.id`, opens `"service-daemon"`
- **Hummingbird** — shown only when `node.hbird_info !== null`, label = `node.hbird_info.id`, opens `"service-hbird"`

`AsDetails` prop changes: `onViewServices: () => void` → `onViewService: (id: "service-control" | "service-daemon" | "service-hbird") => void`.

## Per-Service Sub-Drawer Content

A shared `ServiceDrawerContent` component accepts:

```ts
interface ServiceDrawerProps {
  name: string;
  fields: { label: string; value: string | number }[];
  logsServiceName: string;
}
```

It renders `InfoItem` rows for each field, then a "View Logs" `Button` navigating to `/app/logs/$serviceName`.

Field mapping per service:

| Service | `name` | `fields` | `logsServiceName` |
|---------|--------|----------|-------------------|
| Control Service | `node.control_service.name` | `addr` | `node.control_service.name` |
| SCION Daemon | `node.daemon_info.id` | _(none)_ | `node.daemon_info.id` |
| Hummingbird | `node.hbird_info.id` | `addr`, `min_bandwidth`, `max_bandwidth`, `reservation_duration` | `node.hbird_info.id` |

Drawer titles follow pattern `"<Service Type> — <name/id>"`.

## Files Changed

- `src/components/TopologyView.tsx` — only file touched:
  - Update `useDrawersStack` IDs
  - Add `ServiceDrawerContent` component
  - Replace `ServicesPanel` with three `<Drawer>` elements using `ServiceDrawerContent`
  - Update `AsDetails` prop signature and button rendering
  - Update `DetailsPanel` to pass `onViewService` instead of `onViewServices`
  - Delete `ServicesPanel`

## Out of Scope

- Discovery Service has no `id`/log stream — not included as a sub-drawer entry.
- Router sub-drawers (routers already have their own detail view with a "View Logs" button).
