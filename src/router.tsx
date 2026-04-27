import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { SetupWizard } from "./routes/setup";
import { AppLayout } from "./routes/app";
import { session } from "./lib/session";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/setup" });
  },
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  // Redirect to app if a topology is already loaded in this session
  beforeLoad: () => {
    if (session.getTopology()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // TODO(Task 5): remove `as any` once topologyRoute is registered in the route tree
      throw redirect({ to: "/app/topology" as any });
    }
  },
  component: SetupWizard,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: AppLayout,
});

const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // TODO(Task 5): remove `as any` once topologyRoute is registered in the route tree
    throw redirect({ to: "/app/topology" as any });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  appRoute.addChildren([appIndexRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
