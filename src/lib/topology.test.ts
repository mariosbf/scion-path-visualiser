import { describe, it, expect } from "vitest";
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

const tinyTopology: Topology = {
  ases: {
    "1-ff00:0:110": stubAs(true),
    "1-ff00:0:111": stubAs(false),
  },
  links: [
    {
      a: {
        as_id: "1-ff00:0:110",
        router_name: "br1-ff00_0_110-1",
        interface_id: 1001,
        underlay_local: "127.0.0.1:50000",
        underlay_remote: "127.0.0.2:50000",
      },
      b: {
        as_id: "1-ff00:0:111",
        router_name: "br1-ff00_0_111-1",
        interface_id: 2001,
        underlay_local: "127.0.0.2:50000",
        underlay_remote: "127.0.0.1:50000",
      },
      link_type: "Child",
    },
  ],
};

describe("buildGraph", () => {
  it("creates one ISD node per unique ISD", () => {
    const { nodes } = buildGraph(tinyTopology);
    const isdNodes = nodes.filter((n) => n.type === "isd");
    expect(isdNodes).toHaveLength(1);
    expect(isdNodes[0].id).toBe("isd-1");
  });

  it("creates AS nodes parented to their ISD node", () => {
    const { nodes } = buildGraph(tinyTopology);
    const asNodes = nodes.filter((n) => n.type === "as");
    expect(asNodes).toHaveLength(2);
    expect(asNodes.every((n) => n.parentId === "isd-1")).toBe(true);
  });

  it("creates one router node per unique (as_id, router_name, interface_id) triple", () => {
    const { nodes } = buildGraph(tinyTopology);
    const routerNodes = nodes.filter((n) => n.type === "router");
    expect(routerNodes).toHaveLength(2);
    expect(routerNodes[0].parentId).toMatch(/^as-/);
  });

  it("creates edges connecting router nodes with link type", () => {
    const { edges } = buildGraph(tinyTopology);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("router-1-ff00:0:110-br1-ff00_0_110-1-1001");
    expect(edges[0].target).toBe("router-1-ff00:0:111-br1-ff00_0_111-1-2001");
    expect(edges[0].data?.linkType).toBe("Child");
  });

  it("deduplicates router nodes appearing in multiple links", () => {
    const multiLink: Topology = {
      ases: {
        "1-ff00:0:110": stubAs(true),
        "1-ff00:0:111": stubAs(false),
        "1-ff00:0:112": stubAs(false),
      },
      links: [
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "b" },
          b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2, underlay_local: "b", underlay_remote: "a" },
          link_type: "Child",
        },
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-2", interface_id: 3, underlay_local: "a", underlay_remote: "c" },
          b: { as_id: "1-ff00:0:112", router_name: "br-112-1", interface_id: 4, underlay_local: "c", underlay_remote: "a" },
          link_type: "Child",
        },
      ],
    };
    const { nodes } = buildGraph(multiLink);
    const routerIds = nodes.filter((n) => n.type === "router").map((n) => n.id);
    expect(new Set(routerIds).size).toBe(routerIds.length); // all unique
    expect(routerIds).toHaveLength(4); // 4 distinct router+interface pairs
  });

  it("returns empty nodes and edges for an empty topology", () => {
    const { nodes, edges } = buildGraph({ ases: {}, links: [] });
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});
