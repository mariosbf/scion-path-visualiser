import { describe, it, expect } from "vitest";
import { buildGraph } from "./topology";
import type { Topology } from "../bindings";

const tinyTopology: Topology = {
  ases: {
    "1-ff00:0:110": { core: true, mtu: 1472 },
    "1-ff00:0:111": { core: false, mtu: 1472 },
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

  it("creates one router node per unique (as_id, router_name) pair", () => {
    const { nodes } = buildGraph(tinyTopology);
    const routerNodes = nodes.filter((n) => n.type === "router");
    expect(routerNodes).toHaveLength(2);
    expect(routerNodes[0].parentId).toMatch(/^as-/);
  });

  it("creates edges connecting router nodes with link type", () => {
    const { edges } = buildGraph(tinyTopology);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("router-1-ff00:0:110-br1-ff00_0_110-1");
    expect(edges[0].target).toBe("router-1-ff00:0:111-br1-ff00_0_111-1");
    expect(edges[0].data?.linkType).toBe("Child");
  });

  it("deduplicates router nodes appearing in multiple links", () => {
    const multiLink: Topology = {
      ases: {
        "1-ff00:0:110": { core: true, mtu: 1472 },
        "1-ff00:0:111": { core: false, mtu: 1472 },
        "1-ff00:0:112": { core: false, mtu: 1472 },
      },
      links: [
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "b" },
          b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2, underlay_local: "b", underlay_remote: "a" },
          link_type: "Child",
        },
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "c" },
          b: { as_id: "1-ff00:0:112", router_name: "br-112-1", interface_id: 3, underlay_local: "c", underlay_remote: "a" },
          link_type: "Child",
        },
      ],
    };
    const { nodes } = buildGraph(multiLink);
    const routerIds = nodes.filter((n) => n.type === "router").map((n) => n.id);
    expect(new Set(routerIds).size).toBe(routerIds.length);
    expect(routerIds.filter((id) => id.includes("br-110-1"))).toHaveLength(1);
  });
});
