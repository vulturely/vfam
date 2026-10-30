import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import LearningProfiles from "./LearningProfiles.svelte";
import type { Runtime } from "../runtime/registry.svelte";

const profiles = [
	{
		id: "first",
		familyId: "family",
		displayName: "Jamie",
		ageBand: "primary" as const,
		grade: "Grade 2",
		guardianAccountIds: ["parent", "other"],
		createdAt: "now",
	},
	{
		id: "second",
		familyId: "family",
		displayName: "Riley",
		ageBand: "primary" as const,
		grade: "Grade 3",
		guardianAccountIds: ["parent"],
		createdAt: "now",
	},
];

function setup(family = true) {
	const learning = {
		listProfiles: vi.fn(async () => profiles),
		listEligibleGuardians: vi.fn(async () => [
			{ accountId: "other", displayName: "Other parent" },
			{ accountId: "new", displayName: "New parent" },
		]),
		addGuardian: vi.fn(async () => ({
			...profiles[0],
			guardianAccountIds: ["parent", "other", "new"],
		})),
		removeGuardian: vi.fn(async () => profiles[0]),
		getSchool: vi.fn(async () => ({ name: "", address: "", email: "", phones: [], teachers: [] })),
		saveSchool: vi.fn(),
	};
	const runtime = {
		state: { identity: { id: "parent", role: "manager" } },
		services: {
			family: { getMyFamily: vi.fn(async () => (family ? { id: "family" } : null)) },
			learning,
			timetable: { get: vi.fn(async () => ({ timezone: "UTC", windows: [] })) },
			auth: {
				getChildPinAccess: vi.fn(async () => ({ enabled: true, loginId: "jamie" })),
			},
			voice: { policy: vi.fn(async () => ({ enabled: false })) },
		},
		router: { navigate: vi.fn() },
	} as unknown as Runtime;
	render(LearningProfiles, {
		props: { setup: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	return { runtime, learning };
}

afterEach(cleanup);

it("switches children and shares or removes guardian access", async () => {
	const { learning } = setup();
	expect(await screen.findByText("Jamie")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	expect(screen.getByText("Riley")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Previous child" }));
	await fireEvent.change(screen.getByLabelText("Share with a parent"), {
		target: { value: "new" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Add guardian" }));
	await waitFor(() => expect(learning.addGuardian).toHaveBeenCalledWith("first", "new"));
	expect(await screen.findByRole("status")).toHaveTextContent("Guardian access updated.");
	await fireEvent.click(screen.getAllByRole("button", { name: "Remove guardian" })[0]);
	await waitFor(() => expect(learning.removeGuardian).toHaveBeenCalledWith("first", "parent"));
});

it("supports keyboard navigation between learning tabs", async () => {
	setup();
	await screen.findByText("Jamie");
	const setting = screen.getByRole("tab", { name: "Setting" });
	await fireEvent.keyDown(setting, { key: "ArrowRight" });
	expect(screen.getByRole("tab", { name: "Assignment" })).toHaveFocus();
	await fireEvent.keyDown(setting, { key: "Home" });
	await fireEvent.keyDown(setting, { key: "End" });
	await fireEvent.keyDown(setting, { key: "x" });
});

it("opens family management when no family exists", async () => {
	const { runtime } = setup(false);
	await fireEvent.click(await screen.findByRole("button", { name: "Open family" }));
	expect(runtime.router.navigate).toHaveBeenCalledWith("family:manage");
});
