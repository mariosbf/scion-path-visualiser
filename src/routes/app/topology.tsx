import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { session } from "../../lib/session";
import { TopologyView } from "../../components/TopologyView";

export function TopologyRoute() {
  const navigate = useNavigate();
  const topology = session.getTopology();

  useEffect(() => {
    if (!topology) {
      navigate({ to: "/setup" });
    }
  }, [topology, navigate]);

  if (!topology) return null;

  return <TopologyView topology={topology} />;
}
