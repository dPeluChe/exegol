import { useAppStore } from "../stores/app";

/** The Dashboard on the view that shows the Commander: the combined one if that is where the person is */
export function showCommander(): void {
  const app = useAppStore.getState();
  const combined = app.dashboardMode === "combined";
  app.openDashboard();
  app.setDashboardMode(combined ? "combined" : "commander");
}
