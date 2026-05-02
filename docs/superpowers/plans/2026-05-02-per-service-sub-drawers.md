# Per-Service Sub-Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "services" drawer with individual sub-drawers per SCION service, each showing service fields and a "View Logs" button.

**Architecture:** All changes are in `src/components/TopologyView.tsx`. A new shared `ServiceDrawerContent` component renders fields + log navigation. `AsDetails` gets per-service buttons instead of a single "View Services" button. The `DrawerStack` gains three new drawer IDs (`service-control`, `service-daemon`, `service-hbird`); the old `services` drawer and `ServicesPanel` are deleted.

**Tech Stack:** React 19, TypeScript, Mantine `DrawerStack` / `useDrawersStack`, TanStack Router `useNavigate`

---

### Task 1: Add `ServiceDrawerContent` component

**Files:**
- Modify: `src/components/TopologyView.tsx`

- [ ] **Step 1: Add `ServiceDrawerContent` after the `RouterDetails` function (around line 220)**

  Insert this block between `RouterDetails` and `IsdDetails`:

  ```tsx
  interface ServiceDrawerProps {
    fields: { label: string; value: string | number }[];
    logsServiceName: string;
  }

  function ServiceDrawerContent({ fields, logsServiceName }: ServiceDrawerProps) {
    const navigate = useNavigate();
    return (
      <Stack gap="sm">
        {fields.map((f) => (
          <InfoItem key={f.label} label={f.label} value={f.value} />
        ))}
        <Button
          variant="light"
          leftSection={<IconFileText size={14} />}
          onClick={() =>
            navigate({
              to: "/app/logs/$serviceName",
              params: { serviceName: logsServiceName },
            })
          }
        >
          View Logs
        </Button>
      </Stack>
    );
  }
  ```

- [ ] **Step 2: Type-check**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/TopologyView.tsx
  git commit -m "refactor(topology): add ServiceDrawerContent component"
  ```

---

### Task 2: Update prop signatures and drawer IDs

**Files:**
- Modify: `src/components/TopologyView.tsx`

- [ ] **Step 1: Add `ServiceDrawerId` type alias above `AsDetails`**

  Insert before the `AsDetails` function definition:

  ```tsx
  type ServiceDrawerId = "service-control" | "service-daemon" | "service-hbird";
  ```

- [ ] **Step 2: Replace `AsDetails` with updated version**

  Replace the entire `AsDetails` function with:

  ```tsx
  function AsDetails({
    node,
    onViewService,
  }: {
    node: AsNodeData;
    onViewService: (id: ServiceDrawerId) => void;
  }) {
    return (
      <Stack gap="sm">
        {node.core && <Badge color="orange">Core</Badge>}
        <InfoItem label="AS" value={node.asId} />
        <InfoItem
          label="Control Service"
          values={[node.control_service.name, node.control_service.addr]}
        />
        <InfoItem
          label="Discovery Service"
          values={[node.discovery_service.name, node.discovery_service.addr]}
        />
        {node.mtu !== null && <InfoItem label="MTU" value={node.mtu} />}
        {node.hbird_info && (
          <>
            <InfoItem
              label="Hummingbird - Redemption API"
              values={[node.hbird_info.id, node.hbird_info.addr]}
            />
            <InfoItem
              label="Hummingbird - Min Bandwidth"
              value={node.hbird_info.min_bandwidth}
            />
            <InfoItem
              label="Hummingbird - Max Bandwidth"
              value={node.hbird_info.max_bandwidth}
            />
            <InfoItem
              label="Hummingbird - Reservation Duration"
              value={node.hbird_info.reservation_duration}
            />
          </>
        )}
        <Button variant="light" onClick={() => onViewService("service-control")}>
          {node.control_service.name}
        </Button>
        <Button variant="light" onClick={() => onViewService("service-daemon")}>
          {node.daemon_info.id}
        </Button>
        {node.hbird_info && (
          <Button variant="light" onClick={() => onViewService("service-hbird")}>
            {node.hbird_info.id}
          </Button>
        )}
      </Stack>
    );
  }
  ```

- [ ] **Step 3: Replace `DetailsPanel` with updated version**

  Replace the entire `DetailsPanel` function with:

  ```tsx
  function DetailsPanel({
    element,
    onViewService,
  }: {
    element: TopologyNode | TopologyEdge;
    onViewService?: (id: ServiceDrawerId) => void;
  }) {
    if (element.type === "router") {
      const node = element as TopologyNode;
      return <RouterDetails node={node.data as RouterNodeData} />;
    } else if (element.type === "isd") {
      const node = element as TopologyNode;
      return <IsdDetails node={node.data as IsdNodeData} />;
    } else if (element.type === "as") {
      const node = element as TopologyNode;
      return (
        <AsDetails
          node={node.data as AsNodeData}
          onViewService={onViewService!}
        />
      );
    } else {
      const edge = element as TopologyEdge;
      return <EdgeDetails edge={edge} />;
    }
  }
  ```

- [ ] **Step 4: Update `useDrawersStack` call in `TopologyView`**

  Replace:
  ```tsx
  const drawersStack = useDrawersStack(["detail", "services"]);
  ```
  With:
  ```tsx
  const drawersStack = useDrawersStack(["detail", "service-control", "service-daemon", "service-hbird"]);
  ```

- [ ] **Step 5: Update `DetailsPanel` usage in `TopologyView` JSX**

  Replace:
  ```tsx
  <DetailsPanel
    element={selected}
    onViewServices={() => drawersStack.open("services")}
  />
  ```
  With:
  ```tsx
  <DetailsPanel
    element={selected}
    onViewService={(id) => drawersStack.open(id)}
  />
  ```

- [ ] **Step 6: Type-check**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/TopologyView.tsx
  git commit -m "refactor(topology): rename onViewServices → onViewService, update AsDetails buttons"
  ```

---

### Task 3: Add per-service drawers, remove `ServicesPanel` and old services drawer

**Files:**
- Modify: `src/components/TopologyView.tsx`

- [ ] **Step 1: Remove the old `services` drawer element from `DrawerStack` JSX**

  Delete this block from `TopologyView`'s return value (currently the second `<Drawer>` after the `detail` drawer):

  ```tsx
  <Drawer
    {...drawersStack.register("services")}
    position="right"
    size="md"
    title={
      selectedAsNode
        ? `Services — ${(selectedAsNode.data as AsNodeData).asId}`
        : "Services"
    }
    styles={{ body: { paddingTop: 8 } }}
  >
    {selectedAsNode && (
      <ServicesPanel node={selectedAsNode.data as AsNodeData} />
    )}
  </Drawer>
  ```

- [ ] **Step 2: Add three per-service drawers inside `DrawerStack`, after the `detail` drawer**

  Insert after the closing `</Drawer>` of the `detail` drawer:

  ```tsx
  <Drawer
    {...drawersStack.register("service-control")}
    position="right"
    size="md"
    title={
      selectedAsNode
        ? `Control Service — ${(selectedAsNode.data as AsNodeData).control_service.name}`
        : "Control Service"
    }
    styles={{ body: { paddingTop: 8 } }}
  >
    {selectedAsNode && (
      <ServiceDrawerContent
        fields={[
          {
            label: "Address",
            value: (selectedAsNode.data as AsNodeData).control_service.addr,
          },
        ]}
        logsServiceName={(selectedAsNode.data as AsNodeData).control_service.name}
      />
    )}
  </Drawer>

  <Drawer
    {...drawersStack.register("service-daemon")}
    position="right"
    size="md"
    title={
      selectedAsNode
        ? `SCION Daemon — ${(selectedAsNode.data as AsNodeData).daemon_info.id}`
        : "SCION Daemon"
    }
    styles={{ body: { paddingTop: 8 } }}
  >
    {selectedAsNode && (
      <ServiceDrawerContent
        fields={[]}
        logsServiceName={(selectedAsNode.data as AsNodeData).daemon_info.id}
      />
    )}
  </Drawer>

  <Drawer
    {...drawersStack.register("service-hbird")}
    position="right"
    size="md"
    title={
      selectedAsNode && (selectedAsNode.data as AsNodeData).hbird_info
        ? `Hummingbird — ${(selectedAsNode.data as AsNodeData).hbird_info!.id}`
        : "Hummingbird"
    }
    styles={{ body: { paddingTop: 8 } }}
  >
    {selectedAsNode && (selectedAsNode.data as AsNodeData).hbird_info && (
      <ServiceDrawerContent
        fields={[
          {
            label: "Address",
            value: (selectedAsNode.data as AsNodeData).hbird_info!.addr,
          },
          {
            label: "Min Bandwidth",
            value: (selectedAsNode.data as AsNodeData).hbird_info!.min_bandwidth,
          },
          {
            label: "Max Bandwidth",
            value: (selectedAsNode.data as AsNodeData).hbird_info!.max_bandwidth,
          },
          {
            label: "Reservation Duration",
            value: (selectedAsNode.data as AsNodeData).hbird_info!.reservation_duration,
          },
        ]}
        logsServiceName={(selectedAsNode.data as AsNodeData).hbird_info!.id}
      />
    )}
  </Drawer>
  ```

- [ ] **Step 3: Delete `ServicesPanel` component**

  Remove the entire `ServicesPanel` function (currently around lines 230–278):

  ```tsx
  function ServicesPanel({ node }: { node: AsNodeData }) {
    // ... entire function body
  }
  ```

- [ ] **Step 4: Type-check**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 5: Smoke-test in dev app**

  Run: `npm run tauri dev`

  Verify:
  - Click an AS node → detail drawer opens
  - Buttons for Control Service, SCION Daemon (and Hummingbird if present) appear in the detail drawer
  - Click each button → correct sub-drawer slides in on top of detail drawer
  - Each sub-drawer shows correct fields and a "View Logs" button
  - "View Logs" navigates to the correct log route
  - Close sub-drawer → detail drawer remains open
  - Click pane → all drawers close

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/TopologyView.tsx
  git commit -m "feat(topology): replace services drawer with per-service sub-drawers"
  ```
