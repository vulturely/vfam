import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import TimetableEditor from "./WeeklySchedule.svelte";
import { Timetable } from "../api/protocol";
import type { TimetableService } from "../timetable/service";
afterEach(cleanup);
function setup(windows = [{ day: 6, start: 1380, end: 120, kind: "study" }]) {
	const service = {
		get: vi.fn(
			async () =>
				new Timetable({
					timezone: "America/Chicago",
					windows,
				}),
		),
		save: vi.fn(async (_p: string, t: Timetable) => t),
		override: vi.fn(
			async () =>
				new Timetable({
					timezone: "UTC",
					overrideUntil: "2026-10-20T00:00:00Z",
				}),
		),
		policy: vi.fn(),
		setTimezone: vi.fn(),
		saveCalendar: vi.fn(),
	};
	const signIn = vi.fn(async () => {});
	render(TimetableEditor, {
		service: service as TimetableService,
		profileId: "profile",
		signIn,
	});
	return { service, signIn };
}
it("lists windows as cards and saves each add, edit and delete straight away", async () => {
	const { service } = setup();
	const add = await screen.findByRole("button", { name: "Add window" });
	await waitFor(() => expect(add).not.toBeDisabled());
	expect(screen.queryByRole("button", { name: "Save timetable" })).toBeNull();
	expect(screen.getByRole("button", { name: "Edit Sunday Study 23:00–02:00" })).toBeVisible();
	expect(screen.queryByLabelText("Child timezone (IANA name)")).toBeNull();

	await fireEvent.click(add);
	const dialog = await screen.findByRole("dialog", { name: "Add window" });
	await fireEvent.click(within(dialog).getByRole("radio", { name: "Monday" }));
	expect(within(dialog).getByRole("radio", { name: "Monday" })).toBeChecked();
	const activity = within(dialog).getByRole("combobox", { name: "Activity" });
	expect(activity).toHaveValue("study");
	await fireEvent.change(activity, { target: { value: "break" } });
	expect(activity).toHaveValue("break");
	await fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "9:00" } });
	await fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
	expect(within(dialog).getByRole("alert")).toHaveTextContent("Use HH:MM times");
	expect(service.save).not.toHaveBeenCalled();
	await fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "17:00" } });
	await fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "17:30" } });
	await fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(service.save).toHaveBeenLastCalledWith(
		"profile",
		expect.objectContaining({
			timezone: "America/Chicago",
			windows: [
				expect.objectContaining({ day: 6, start: 1380, end: 120, kind: "study" }),
				expect.objectContaining({ day: 0, start: 1020, end: 1050, kind: "break" }),
			],
		}),
	);
	expect(screen.getByText(/Timetable saved/)).toBeVisible();
	expect(screen.getAllByRole("listitem").map((card) => card.textContent)).toEqual([
		expect.stringContaining("Monday"),
		expect.stringContaining("Sunday"),
	]);

	service.save.mockRejectedValueOnce(new Error("Server unavailable"));
	await fireEvent.click(screen.getByRole("button", { name: "Edit Monday Break 17:00–17:30" }));
	const edit = await screen.findByRole("dialog", { name: "Edit window" });
	expect(within(edit).getByLabelText("Start")).toHaveValue("17:00");
	await fireEvent.input(within(edit).getByLabelText("End"), { target: { value: "18:00" } });
	await fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
	expect(await within(edit).findByRole("alert")).toHaveTextContent("Server unavailable");
	await fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
	await screen.findByRole("button", { name: "Edit Monday Break 17:00–18:00" });

	await fireEvent.click(screen.getByRole("button", { name: "Delete Monday Break 17:00–18:00" }));
	await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
	await fireEvent.click(screen.getByRole("button", { name: "Delete Sunday Study 23:00–02:00" }));
	expect(await screen.findByText(/No weekly windows/)).toBeVisible();
	expect(service.save).toHaveBeenLastCalledWith(
		"profile",
		expect.objectContaining({ windows: [] }),
	);
});
it("submits bounded override fields, reports errors, and provides fresh authentication", async () => {
	const { service, signIn } = setup();
	const grant = await screen.findByRole("button", { name: "Grant override" });
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Add window" })).not.toBeDisabled(),
	);
	expect(grant).toBeDisabled();
	await fireEvent.input(screen.getByLabelText("Override reason"), {
		target: { value: "finish lesson" },
	});
	service.override.mockRejectedValueOnce(new Error("Fresh guardian sign-in required"));
	await fireEvent.click(grant);
	await screen.findByRole("alert");
	expect(service.override).toHaveBeenCalledWith("profile", 15, "finish lesson");
	await fireEvent.click(screen.getByRole("button", { name: "Fresh guardian sign-in" }));
	expect(signIn).toHaveBeenCalledOnce();
	await fireEvent.click(grant);
	await screen.findByText(/Temporary override granted and audited/);
});
it("rejects malformed stored clock values before calling the service", async () => {
	// 25:00 cannot come from the editor; stored data is still checked before saving.
	const { service } = setup([
		{ day: 0, start: 1500, end: 1520, kind: "study" },
		{ day: 1, start: 600, end: 660, kind: "study" },
	]);
	const remove = await screen.findByRole("button", { name: "Delete Tuesday Study 10:00–11:00" });
	await waitFor(() => expect(remove).not.toBeDisabled());
	await fireEvent.click(remove);
	await screen.findByRole("alert");
	expect(service.save).not.toHaveBeenCalled();
});

it("surfaces fresh sign-in failures without leaving controls disabled", async () => {
	const { signIn } = setup();
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Add window" })).not.toBeDisabled(),
	);
	signIn.mockRejectedValueOnce(new Error("provider unavailable"));
	await fireEvent.click(screen.getByRole("button", { name: "Fresh guardian sign-in" }));
	await screen.findByText("Could not start guardian sign-in. Please try again.");
	expect(screen.getByRole("button", { name: "Add window" })).not.toBeDisabled();
});

it("offers compact icon actions and enforces override duration bounds", async () => {
	setup();
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Add window" })).not.toBeDisabled(),
	);
	const duration = screen.getByLabelText("Override minutes (1–60)");
	expect(duration).toHaveAttribute("min", "1");
	expect(duration).toHaveAttribute("max", "60");
	await fireEvent.input(duration, { target: { value: "61" } });
	expect(duration).toBeInvalid();
	await fireEvent.input(duration, { target: { value: "20" } });
	expect(duration).toBeValid();
	expect(screen.getByRole("button", { name: "Add window" })).toHaveTextContent("");
});
