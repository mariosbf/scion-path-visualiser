import { createTheme, NavLink } from "@mantine/core";

export const theme = createTheme({
  components: {
    NavLink: NavLink.extend({
      vars: (theme) => ({
        root: {
          "--nl-bg": theme.colors.dark[4],
          "--nl-color": "var(--mantine-color-white)",
          "--nl-hover": theme.colors.dark[5],
          "--nl-hover-color": "var(--mantine-color-white)",
        },
        children: {},
      }),
    }),
  },
});
