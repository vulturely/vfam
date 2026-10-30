import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ParentHome from "./ParentHome.svelte";
import type { Runtime } from "../runtime/registry.svelte";

function setup() {
	const services = {
		family: {
			getMyFamily: vi.fn().mockResolvedValue({ id: "family" }),
			listMembers: vi.fn().mockResolvedValue([{ role: "admin" }, { role: "member" }]),
		},
		tasks: {
			listTasks: vi.fn().mockResolvedValue([
				{ status: "todo", endAt: "2000-01-01T00:00:00Z" },
				{ status: "in_progress", endAt: null },
				{ status: "completed", endAt: "2000-01-01T00:00:00Z" },
				{ status: "cancelled", endAt: "2000-01-01T00:00:00Z" },
			]),
		},
		learning: { listProfiles: vi.fn().mockResolvedValue([{ id: "child" }]) },
	};
	const navigate = vi.fn();
	const runtime = { services, router: { navigate } } as unknown as Runtime;
	render(ParentHome, { context: new Map([["vulture:runtime", runtime]]) });
	return { services, navigate };
}
afterEach(cleanup);
it("summarizes actual household data and opens the matching workspace", async () => {
	const { navigate } = setup();
	await screen.findByText("1 completed · 1 overdue");
	const tasks = screen.getByRole("button", { name: /Family tasks/ });
	expect(within(tasks).getByText("2")).toBeVisible();
	const learning = screen.getByRole("button", { name: /Children’s learning/ });
	expect(within(learning).getByText("1")).toBeVisible();
	const family = screen.getByRole("button", { name: /Your family/ });
	expect(within(family).getByText("2")).toBeVisible();
	await fireEvent.click(tasks);
	expect(navigate).toHaveBeenLastCalledWith("family:manage", { tab: "tasks" });
	await fireEvent.click(learning);
	expect(navigate).toHaveBeenLastCalledWith("learning:profiles", {});
	await fireEvent.click(family);
	expect(navigate).toHaveBeenLastCalledWith("family:manage", { tab: "manage" });
});
it("keeps successful stats when one source fails and can refresh", async () => {
	const { services } = setup();
	await screen.findByText("1 completed · 1 overdue");
	services.tasks.listTasks.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Refresh household stats" }));
	await screen.findByText("Some stats are unavailable. Refresh to try again.");
	expect(within(screen.getByRole("button", { name: /Family tasks/ })).getByText("—")).toBeVisible();
	expect(within(screen.getByRole("button", { name: /Your family/ })).getByText("2")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Refresh household stats" }));
	await screen.findByText("1 completed · 1 overdue");
});
it("shows an empty-family state without querying family-scoped data", async () => {
	const { services } = setup();
	await screen.findByText("1 completed · 1 overdue");
	services.family.getMyFamily.mockResolvedValueOnce(null);
	services.tasks.listTasks.mockClear();
	await fireEvent.click(screen.getByRole("button", { name: "Refresh household stats" }));
	await waitFor(() => expect(screen.getByText(/Create or join your family/)).toBeVisible());
	expect(services.tasks.listTasks).not.toHaveBeenCalled();
	expect(within(screen.getByRole("button", { name: /Family tasks/ })).getByText("0")).toBeVisible();
});

it("starts new families in onboarding and keeps setup available for existing families", async () => {
	const { services, navigate } = setup();
	await screen.findByText("1 completed · 1 overdue");
	await fireEvent.click(screen.getByRole("button", { name: "Family setup", exact: true }));
	expect(navigate).toHaveBeenLastCalledWith("family:setup");
	services.family.getMyFamily.mockResolvedValueOnce(null as unknown as { id: string });
	await fireEvent.click(screen.getByRole("button", { name: "Refresh household stats" }));
	await waitFor(() => expect(navigate).toHaveBeenLastCalledWith("family:setup"));
});
