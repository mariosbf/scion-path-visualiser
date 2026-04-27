import { Outlet } from "@tanstack/react-router";

export function AppLayout() {
  return (
    <div style={{ padding: 32 }}>
      App shell — coming soon
      <Outlet />
    </div>
  );
}
