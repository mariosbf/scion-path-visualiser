import type { Topology } from "../bindings";

let topology: Topology | null = null;

export const session = {
  setTopology: (t: Topology) => {
    topology = t;
  },
  getTopology: () => topology,
};
