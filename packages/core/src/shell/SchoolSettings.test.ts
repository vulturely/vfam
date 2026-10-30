import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import SchoolSettings from "./SchoolSettings.svelte";
import type { LearningService } from "../learning/service";
import type { SchoolDetails } from "../learning/types";
import { toastService } from "../services/toast.svelte";
afterEach(cleanup);
function setup() {
	const value: SchoolDetails = {
		name: "Oak School",
		address: "10 School Road",
		email: "office@example.org",
		phones: ["+1 555 123 4567"],
		teachers: [
			{
				name: "Ms Jones",
				role: "Classroom",
				email: "jones@example.org",
				phone: "555 111 2222",
			},
		],
	};
	const service = {
		getSchool: vi.fn(async () => value),
		saveSchool: vi.fn(async (_id: string, school: SchoolDetails) => school),
	};
	render(SchoolSettings, {
		service: service as unknown as LearningService,
		profileId: "child-1",
	});
	return { service, value };
}
const schoolForm = () => within(screen.getByRole("form", { name: "School information" }));
const teacherForm = (index: number) =>
	within(screen.getByRole("form", { name: `Teacher ${index}` }));
it("saves school and teachers independently while preserving the other pending edits", async () => {
	const { service, value } = setup();
	await screen.findByLabelText("School name");
	await fireEvent.input(screen.getByLabelText("School name"), {
		target: { value: "New School" },
	});
	await fireEvent.input(screen.getByLabelText("Teacher 1 name"), {
		target: { value: "Updated teacher" },
	});
	await fireEvent.click(schoolForm().getByRole("button", { name: "Save", exact: true }));
	await screen.findByText("School details saved.");
	expect(service.saveSchool).toHaveBeenLastCalledWith(
		"child-1",
		expect.objectContaining({ name: "New School", teachers: value.teachers }),
	);
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("Updated teacher");
	expect(teacherForm(1).getByRole("button", { name: "Save", exact: true })).toBeEnabled();
	await fireEvent.input(screen.getByLabelText("School name"), {
		target: { value: "Unsaved School" },
	});
	await fireEvent.click(teacherForm(1).getByRole("button", { name: "Save", exact: true }));
	await screen.findByText("Teacher contact saved.");
	expect(service.saveSchool).toHaveBeenLastCalledWith(
		"child-1",
		expect.objectContaining({
			name: "New School",
			teachers: [expect.objectContaining({ name: "Updated teacher" })],
		}),
	);
	expect(screen.getByLabelText("School name")).toHaveValue("Unsaved School");
	await fireEvent.click(schoolForm().getByRole("button", { name: "Cancel", exact: true }));
	expect(screen.getByLabelText("School name")).toHaveValue("New School");
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("Updated teacher");
});
it("saves only the selected teacher and cancels additions and pending removals independently", async () => {
	const { service } = setup();
	await screen.findByLabelText("School name");
	await fireEvent.click(screen.getByRole("button", { name: "Add teacher" }));
	await fireEvent.input(screen.getByLabelText("Teacher 2 name"), {
		target: { value: "Music teacher" },
	});
	await fireEvent.input(screen.getByLabelText("Teacher 1 name"), {
		target: { value: "Unsaved change" },
	});
	await fireEvent.click(teacherForm(2).getByRole("button", { name: "Save", exact: true }));
	await screen.findByText("Teacher contact saved.");
	expect(service.saveSchool).toHaveBeenLastCalledWith(
		"child-1",
		expect.objectContaining({
			teachers: [
				expect.objectContaining({ name: "Ms Jones" }),
				expect.objectContaining({ name: "Music teacher" }),
			],
		}),
	);
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("Unsaved change");
	await fireEvent.click(teacherForm(1).getByRole("button", { name: "Cancel", exact: true }));
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("Ms Jones");
	await fireEvent.click(screen.getByRole("button", { name: "Remove teacher 1" }));
	await fireEvent.click(teacherForm(1).getByRole("button", { name: "Cancel", exact: true }));
	expect(screen.getByLabelText("Teacher 1 name")).toBeEnabled();
	await fireEvent.click(screen.getByRole("button", { name: "Add teacher" }));
	await fireEvent.click(teacherForm(3).getByRole("button", { name: "Cancel", exact: true }));
	expect(screen.queryByLabelText("Teacher 3 name")).toBeNull();
});
it("retains unsaved teacher details on failure and retries without saving school edits", async () => {
	const { service } = setup();
	await screen.findByLabelText("School name");
	service.saveSchool.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.input(screen.getByLabelText("School name"), {
		target: { value: "Unsaved School" },
	});
	await fireEvent.input(screen.getByLabelText("Teacher 1 name"), {
		target: { value: "New teacher" },
	});
	await fireEvent.click(teacherForm(1).getByRole("button", { name: "Save", exact: true }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Your changes are still here",
	);
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("New teacher");
	await fireEvent.click(teacherForm(1).getByRole("button", { name: "Save", exact: true }));
	toastService.clear();
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.getByLabelText("School name")).toHaveValue("Unsaved School");
});

it("saves and cancels each phone independently without saving other pending edits", async () => {
	const { service, value } = setup();
	await screen.findByLabelText("School name");
	await fireEvent.input(screen.getByLabelText("School name"), {
		target: { value: "Unsaved school" },
	});
	await fireEvent.input(screen.getByLabelText("Teacher 1 name"), {
		target: { value: "Unsaved teacher" },
	});
	await fireEvent.input(screen.getByLabelText("School phone 1"), {
		target: { value: "555 000 1111" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Add school phone" }));
	await fireEvent.input(screen.getByLabelText("School phone 2"), {
		target: { value: "+44 20 1234 5678" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save school phone 2" }));
	await screen.findByText("Phone number saved.");
	expect(service.saveSchool).toHaveBeenLastCalledWith(
		"child-1",
		expect.objectContaining({
			name: "Oak School",
			phones: [...value.phones, "+44 20 1234 5678"],
			teachers: value.teachers,
		}),
	);
	expect(screen.getByLabelText("School phone 1")).toHaveValue("555 000 1111");
	expect(screen.getByLabelText("School name")).toHaveValue("Unsaved school");
	expect(screen.getByLabelText("Teacher 1 name")).toHaveValue("Unsaved teacher");
	await fireEvent.click(screen.getByRole("button", { name: "Cancel school phone 1" }));
	expect(screen.getByLabelText("School phone 1")).toHaveValue(value.phones[0]);
	await fireEvent.click(screen.getByRole("button", { name: "Remove school phone 1" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save school phone 1" }));
	await waitFor(() => expect(service.saveSchool).toHaveBeenCalledTimes(2));
	expect(service.saveSchool).toHaveBeenLastCalledWith(
		"child-1",
		expect.objectContaining({ phones: ["+44 20 1234 5678"] }),
	);
});
it("rejects empty phone saves and cancels a new phone row", async () => {
	const { service } = setup();
	await screen.findByLabelText("School name");
	await fireEvent.click(screen.getByRole("button", { name: "Add school phone" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save school phone 2" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Enter a phone number",
	);
	expect(service.saveSchool).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Cancel school phone 2" }));
	expect(screen.queryByLabelText("School phone 2")).toBeNull();
});
