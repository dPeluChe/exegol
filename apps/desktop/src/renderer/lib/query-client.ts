import { QueryClient } from "@tanstack/react-query";

/** The main window's client, also read outside React (close-target reads cached providers) */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});
