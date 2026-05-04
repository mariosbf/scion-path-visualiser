import { Transition } from "@mantine/core";
import { type ReactNode, useLayoutEffect, useState } from "react";

export function FadeIn({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => { setVisible(true); }, []);
  return (
    <Transition mounted={visible} transition="fade" duration={200}>
      {(styles) => (
        <span style={{ display: "flex", alignItems: "center", gap: 6, ...styles }}>
          {children}
        </span>
      )}
    </Transition>
  );
}
