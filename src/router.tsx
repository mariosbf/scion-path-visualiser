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
import { ServiceLogsRoute } from "./routes/app/logs";
import { commands } from "./bindings";

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
  beforeLoad: async () => {
    const result = await commands.getTopology();
    if (result.status === "ok") {
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

const serviceLogsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/logs/$serviceName",
  component: ServiceLogsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  appRoute.addChildren([appIndexRoute, topologyRoute, serviceLogsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
