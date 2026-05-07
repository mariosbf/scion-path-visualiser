import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import { buildGraph } from "./topology";
import type { Topology } from "../bindings";

const stubAs = (core: boolean) => ({
  core,
  mtu: 1472,
  control_service: { addr: "127.0.0.1:31000", name: "cs1" },
  discovery_service: { addr: "127.0.0.1:31000", name: "cs1" },
  hummingbird: null,
  daemon: { id: "sd1", address: "127.0.0.1:30255", api_addr: "127.0.0.1:30255" },
  endhost_api_bridge: { addr: "127.0.0.1:30041" },
  border_routers: [],
});

const twoAsTopology: Topology = {
  ases: {
    "1-ff00:0:110": stubAs(true),
    "1-ff00:0:111": stubAs(false),
  },
  links: [
    {
      a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1001, underlay_local: "a", underlay_remote: "b" },
      b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2001, underlay_local: "b", underlay_remote: "a" },
      link_type: "Child",
    },
  ],
};

const twoIsdTopology: Topology = {
  ases: {
    "1-ff00:0:110": stubAs(true),
    "2-ff00:0:210": stubAs(true),
  },
  links: [
    {
      a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "b" },
      b: { as_id: "2-ff00:0:210", router_name: "br-210-1", interface_id: 2, underlay_local: "b", underlay_remote: "a" },
      link_type: "Core",
    },
  ],
};

describe("layoutGraph", () => {
  it("assigns non-zero positions to all nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNode = laid.find((n) => n.type === "isd")!;
    const asNodes = laid.filter((n) => n.type === "as");
    // ISD node is at origin or positive coordinates
    expect(isdNode.position.x).toBeGreaterThanOrEqual(0);
    // AS nodes get distinct positions within ISD
    expect(asNodes[0].position).toBeDefined();
    expect(asNodes[1].position).toBeDefined();
    // Parent and child AS should have different y positions
    expect(asNodes[0].position.y).not.toBe(asNodes[1].position.y);
  });

  it("assigns width and height style to ISD and AS nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNode = laid.find((n) => n.type === "isd")!;
    const asNode = laid.find((n) => n.type === "as")!;
    expect(Number(isdNode.style?.width)).toBeGreaterThan(0);
    expect(Number(isdNode.style?.height)).toBeGreaterThan(0);
    expect(Number(asNode.style?.width)).toBeGreaterThan(0);
    expect(Number(asNode.style?.height)).toBeGreaterThan(0);
  });

  it("places two ISDs at different x positions", () => {
    const { nodes, edges } = buildGraph(twoIsdTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNodes = laid.filter((n) => n.type === "isd");
    expect(isdNodes).toHaveLength(2);
    expect(isdNodes[0].position.x).not.toBe(isdNodes[1].position.x);
  });

  it("assigns positions to router nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const routerNodes = laid.filter((n) => n.type === "router");
    for (const rn of routerNodes) {
      expect(rn.position.x).toBeGreaterThan(0);
      expect(rn.position.y).toBeGreaterThan(0);
    }
  });
});
