import { Affix, SegmentedControl } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/app/topology")({
  component: TopologyRoute,
});
import { useState } from "react";
import { PathSearchView } from "../../components/PathSearchView";
import { TopologyView } from "../../components/TopologyView";
import useTopology from "../../hooks/useTopology";

type Mode = "default" | "path-search";

export function TopologyRoute() {
  const navigate = useNavigate();
  const topologyRes = useTopology();
  const [mode, setMode] = useState<Mode>("default");

  if (topologyRes?.status === "error") {
    navigate({ to: "/setup" });
  }

  if (topologyRes === undefined || topologyRes.status === "error") {
    return null;
  }

  const topology = topologyRes.data;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {mode === "default" ? (
        <TopologyView topology={topology} />
      ) : (
        <PathSearchView topology={topology} />
      )}

      <Affix position={{ bottom: 20, right: 20 }}>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          data={[
            { value: "default", label: "Topology" },
            { value: "path-search", label: "Paths" },
          ]}
        />
      </Affix>
    </div>
  );
}
