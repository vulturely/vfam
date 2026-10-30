import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import TimetableEditor from "./TimetableEditor.svelte";
import type { TimetableService } from "../timetable/service";
import type { HomeworkService } from "../homework/service";
import { Timetable, type CalendarEntry } from "../api/protocol";
afterEach(cleanup);
function setup(fail = false) {
	const current = new Timetable({
		timezone: "America/Chicago",
		windows: [{ day: 6, start: 1380, end: 120, kind: "study" }],
	});
	const service = {
		get: vi.fn().mockResolvedValue(current),
		saveCalendar: vi.fn(
			async (_id: string, entries: CalendarEntry[]) => new Timetable({ ...current, entries }),
		),
	} as unknown as TimetableService;
	if (fail) vi.mocked(service.get).mockRejectedValueOnce(new Error("offline"));
	render(TimetableEditor, {
		service,
		profileId: "child",
		signIn: vi.fn(),
		homework: {
			list: vi.fn().mockResolvedValue([{ homework: { id: "math", title: "Fractions" } }]),
		} as unknown as HomeworkService,
	});
	return service;
}
it("opens a monthly calendar without timezone editing and schedules a linked test", async () => {
	const service = setup();
	await screen.findByRole("button", { name: "Add calendar activity" });
	await screen.findByRole("group", { name: /\d{4}/ });
	expect(screen.queryByLabelText("Child timezone")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Add calendar activity" }));
	await screen.findByLabelText("Calendar activity");
	await fireEvent.change(screen.getByLabelText("Calendar activity"), {
		target: { value: "test" },
	});
	await screen.findByRole("option", { name: "Fractions" });
	await fireEvent.change(screen.getByLabelText("Scheduled homework"), {
		target: { value: "math" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save calendar activity" }));
	await screen.findByText("Calendar saved.");
	expect(service.saveCalendar).toHaveBeenCalledWith("child", [
		expect.objectContaining({
			kind: "test",
			homeworkId: "math",
			title: "Fractions",
			start: 960,
			end: 1020,
		}),
	]);
	await fireEvent.click(screen.getByRole("button", { name: "Day view" }));
	expect(screen.getByLabelText("Hourly schedule")).toBeVisible();
	expect(screen.getByRole("button", { name: /Fractions, 16:00 to 17:00/ })).toBeVisible();
});
it("shows all 24 hours and supports a midnight end", async () => {
	const service = setup();
	await screen.findByRole("group", { name: /\d{4}/ });
	await fireEvent.click(screen.getByRole("button", { name: "Day view" }));
	expect(screen.getAllByRole("button", { name: /Add activity at/ })).toHaveLength(24);
	await fireEvent.click(screen.getByRole("button", { name: "Add activity at 23:00" }));
	await screen.findByLabelText("Activity start");
	expect(screen.getByLabelText("Activity end")).toHaveValue("00:00");
	await fireEvent.click(screen.getByRole("button", { name: "Save calendar activity" }));
	await screen.findByText("Calendar saved.");
	expect(service.saveCalendar).toHaveBeenCalledWith("child", [
		expect.objectContaining({ start: 1380, end: 0 }),
	]);
});
it("can retry a failed calendar load without exposing broken navigation", async () => {
	setup(true);
	await screen.findAllByRole("alert").then((items) => items.at(-1));
	expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
	await fireEvent.click(screen.getByRole("button", { name: "Refresh calendar" }));
	expect(await screen.findByRole("group", { name: /\d{4}/ })).toBeVisible();
});

it("keeps a failed save visible inside the phone activity editor", async () => {
	const service = setup();
	await screen.findByRole("group", { name: /\d{4}/ });
	vi.mocked(service.saveCalendar).mockRejectedValueOnce(new Error("Could not save activity."));
	await fireEvent.click(screen.getByRole("button", { name: "Add calendar activity" }));
	await fireEvent.click(await screen.findByRole("button", { name: "Save calendar activity" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Could not save activity.",
	);
	expect(screen.getByRole("button", { name: "Save calendar activity" })).toBeEnabled();
});

it("validates required homework and time ranges and opens weekly rules", async () => {
	setup();
	await screen.findByRole("group", { name: /\d{4}/ });
	await fireEvent.click(screen.getByRole("button", { name: "Add calendar activity" }));
	await fireEvent.change(screen.getByLabelText("Calendar activity"), {
		target: { value: "test" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save calendar activity" }).closest("form")!,
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose homework for this activity.",
	);
	await fireEvent.input(screen.getByLabelText("Activity end"), { target: { value: "16:00" } });
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save calendar activity" }).closest("form")!,
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose different start and end times",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Cancel activity" }));
	await fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
	await fireEvent.click(screen.getByRole("button", { name: "Next month" }));
	await fireEvent.click(screen.getByRole("button", { name: "Today" }));
	await fireEvent.click(screen.getByRole("button", { name: "Weekly rules and override" }));
	expect(screen.getByText("Weekly rules and override", { exact: true })).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Close weekly rules" }));
});

it("creates, edits, and deletes a calendar activity", async () => {
	const service = setup();
	await screen.findByRole("group", { name: /\d{4}/ });
	await fireEvent.click(screen.getByRole("button", { name: "Add calendar activity" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save calendar activity" }));
	await screen.findByText("Calendar saved.");
	await fireEvent.click(screen.getByRole("button", { name: "Day view" }));
	await fireEvent.click(screen.getByRole("button", { name: /Study, 16:00 to 17:00/ }));
	await fireEvent.click(screen.getByRole("button", { name: "Delete calendar activity" }));
	await fireEvent.click(screen.getByRole("button", { name: "Delete activity", exact: true }));
	await screen.findByText("Activity removed.");
	expect(service.saveCalendar).toHaveBeenLastCalledWith("child", []);
});
