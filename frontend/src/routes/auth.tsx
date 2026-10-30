import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  beforeLoad: ({ location }) => {
    // Keep callback query parameters and fragments on legacy OAuth return URLs.
    throw redirect({ to: "/", search: true, hash: location.hash, replace: true });
  },
});
