import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ProfileTimezone from "./ProfileTimezone.svelte";
import type { TimetableService } from "../timetable/service";
afterEach(cleanup);
it("saves only profile timezone and supports cancelling a change", async () => {
	const setTimezone = vi.fn().mockResolvedValue({ timezone: "America/New_York" });
	const service = {
		get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
		setTimezone,
	} as unknown as TimetableService;
	render(ProfileTimezone, { service, profileId: "child" });
	await screen.findByLabelText("Child timezone");
	await waitFor(() => expect(screen.getByLabelText("Child timezone")).toBeEnabled());
	await fireEvent.change(screen.getByLabelText("Child timezone"), {
		target: { value: "America/New_York" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Cancel timezone change" }));
	expect(screen.getByLabelText("Child timezone")).toHaveValue("UTC");
	await fireEvent.change(screen.getByLabelText("Child timezone"), {
		target: { value: "America/New_York" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save profile timezone" }));
	expect(setTimezone).toHaveBeenCalledExactlyOnceWith("child", "America/New_York");
});
