import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { SetupWizard } from "./routes/setup";
import { AppLayout } from "./routes/app";
import { TopologyRoute } from "./routes/app/topology";
import { RouterLogsRoute } from "./routes/app/logs";
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
  beforeLoad: () => {
    if (session.getTopology()) {
      throw redirect({ to: "/app/topology" });
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
    throw redirect({ to: "/app/topology" });
  },
});

const topologyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/topology",
  component: TopologyRoute,
});

const routerLogsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/logs/$routerName",
  component: RouterLogsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  appRoute.addChildren([appIndexRoute, topologyRoute, routerLogsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
