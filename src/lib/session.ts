import type { Topology } from "../bindings";

let topology: Topology | null = null;
let folder: string | null = null;

export const session = {
  setTopology: (t: Topology) => {
    topology = t;
  },
  getTopology: () => topology,
  setFolder: (f: string) => {
    folder = f;
  },
  getFolder: () => folder,
};
