import { describe, it, expect } from "vitest";
import { resolveSelectedInfo } from "./useTopologyCanvas";
import type { Topology } from "../bindings";
import type { TopologyCanvasItem } from "./useTopologyCanvas";

const stubRouter = {
  name: "br-110-1",
  internal_addr: "127.0.0.1:30042",
  interfaces: {
    1001: {
      isd_as: "1-ff00:0:111",
      link_to: "Child" as const,
      mtu: 1472,
      underlay_local: "127.0.0.1:50000",
      underlay_remote: "127.0.0.2:50000",
    },
  },
  status: null,
};

const stubTopology: Topology = {
  ases: {
    "1-ff00:0:110": {
      core: true,
      mtu: 1472,
      control_service: { addr: "127.0.0.1:31000", name: "cs1", status: null },
      discovery_service: { addr: "127.0.0.1:31000", name: "cs1" },
      hummingbird: null,
      daemon: { id: "sd1", address: "127.0.0.1:30255", api_addr: "127.0.0.1:30255", status: null },
      endhost_api_bridge: { addr: "127.0.0.1:30041" },
      border_routers: [stubRouter],
    },
    "1-ff00:0:111": {
      core: false,
      mtu: 1472,
      control_service: { addr: "127.0.0.2:31000", name: "cs2", status: null },
      discovery_service: { addr: "127.0.0.2:31000", name: "cs2" },
      hummingbird: null,
      daemon: { id: "sd2", address: "127.0.0.2:30255", api_addr: "127.0.0.2:30255", status: null },
      endhost_api_bridge: { addr: "127.0.0.2:30041" },
      border_routers: [],
    },
  },
  links: [],
};

describe("resolveSelectedInfo", () => {
  it("returns undefined for no selection", () => {
    expect(resolveSelectedInfo(undefined, stubTopology)).toBeUndefined();
  });

  it("resolves isd selection to ases in that ISD", () => {
    const selected: TopologyCanvasItem = {
      type: "isd",
      data: { label: "ISD 1", isd: "1" },
    };
    const result = resolveSelectedInfo(selected, stubTopology);
    expect(result?.type).toBe("isd");
    if (result?.type === "isd") {
      expect(result.data.isd).toBe("1");
      expect(result.data.ases).toHaveLength(2);
    }
  });

  it("resolves as selection to AsInfo", () => {
    const selected: TopologyCanvasItem = {
      type: "as",
      data: { label: "ff00:0:110", asId: "1-ff00:0:110", core: true },
    };
    const result = resolveSelectedInfo(selected, stubTopology);
    expect(result?.type).toBe("as");
    if (result?.type === "as") {
      expect(result.asId).toBe("1-ff00:0:110");
      expect(result.data.core).toBe(true);
    }
  });

  it("returns undefined for unknown AS", () => {
    const selected: TopologyCanvasItem = {
      type: "as",
      data: { label: "x", asId: "99-ff00:0:999", core: false },
    };
    expect(resolveSelectedInfo(selected, stubTopology)).toBeUndefined();
  });

  it("resolves border-router selection to BorderRouterInfo by interfaceId", () => {
    const selected: TopologyCanvasItem = {
      type: "border-router",
      data: { label: "1001", asId: "1-ff00:0:110", interfaceId: 1001 },
    };
    const result = resolveSelectedInfo(selected, stubTopology);
    expect(result?.type).toBe("border-router");
    if (result?.type === "border-router") {
      expect(result.data.name).toBe("br-110-1");
      expect(result.asId).toBe("1-ff00:0:110");
      expect(result.interfaceId).toBe(1001);
    }
  });

  it("returns undefined for border-router with unknown interfaceId", () => {
    const selected: TopologyCanvasItem = {
      type: "border-router",
      data: { label: "99", asId: "1-ff00:0:110", interfaceId: 9999 },
    };
    expect(resolveSelectedInfo(selected, stubTopology)).toBeUndefined();
  });

  it("passes link through directly", () => {
    const link = {
      a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1001, underlay_local: "a", underlay_remote: "b" },
      b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2001, underlay_local: "b", underlay_remote: "a" },
      link_type: "Child" as const,
    };
    const selected: TopologyCanvasItem = { type: "link", data: link };
    const result = resolveSelectedInfo(selected, stubTopology);
    expect(result?.type).toBe("link");
    if (result?.type === "link") {
      expect(result.data).toBe(link);
    }
  });
});
