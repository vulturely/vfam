import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import Dashboard from "./ParentLearningDashboard.svelte";
import { fixture } from "../parent-learning/test-fixture";
import { toastService } from "../services/toast.svelte";
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
it("shows only actionable notifications and ignores older approved practice versions", async () => {
	const services = fixture();
	render(Dashboard, { services, profileId: "profile" });
	expect(await screen.findByText("3 items need your attention")).toBeVisible();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("region", { name: "Requests for help" })).toBeVisible();
	expect(screen.getByText("Spell fruit")).toBeVisible();
	expect(screen.getByText("Draft")).toBeVisible();
	expect(screen.queryByText("Old words")).toBeNull();
	for (const text of [
		"Assigned homework",
		"Practice accuracy and history",
		"Next schedule window",
		"FamBud devices",
	])
		expect(screen.queryByText(text)).toBeNull();
	expect(services.robot.dashboard).not.toHaveBeenCalled();
	expect(services.timetable.get).not.toHaveBeenCalled();
});
it("shows a clean empty state", async () => {
	const services = fixture();
	vi.mocked(services.childLearning.review).mockResolvedValue([]);
	vi.mocked(services.practice.list).mockResolvedValue([]);
	render(Dashboard, { services, profileId: "profile" });
	expect(await screen.findByText("You’re all caught up.")).toBeVisible();
	expect(screen.queryByRole("region", { name: "Requests for help" })).toBeNull();
});
it("keeps previous notifications on refresh failure and permits retry", async () => {
	const services = fixture();
	render(Dashboard, { services, profileId: "profile" });
	await screen.findByText("Draft");
	vi.mocked(services.homework.list).mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Showing the last available updates.",
	);
	expect(screen.getByText("Draft")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
	toastService.clear();
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("refreshes automatically and stops polling on unmount", async () => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	const services = fixture();
	const view = render(Dashboard, { services, profileId: "profile" });
	await screen.findByText("Draft");
	await vi.advanceTimersByTimeAsync(5000);
	await waitFor(() => expect(services.childLearning.review).toHaveBeenCalledTimes(2));
	view.unmount();
	await vi.advanceTimersByTimeAsync(5000);
	expect(services.childLearning.review).toHaveBeenCalledTimes(2);
});
