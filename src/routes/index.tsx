import { createFileRoute, redirect } from "@tanstack/react-router";

// Landing → redirects into the app. The gate route handles auth.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
});
