import { useEffect, useState } from "react";
import { commands, Result, Topology } from "../bindings";
import { listen } from "@tauri-apps/api/event";

export default function useTopology() {
  const [topology, setTopology] = useState<Result<Topology, string>>();

  useEffect(() => {
    commands.getTopology().then(setTopology);
  }, []);

  useEffect(() => {
    const unlisten = listen<Topology>("status-update", (e) => {
      console.log("Received topology update:", e.payload);
      setTopology({
        status: "ok",
        data: e.payload,
      });
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return topology;
}
