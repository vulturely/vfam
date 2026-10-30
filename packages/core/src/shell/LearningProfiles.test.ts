import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import type { LearningProfile, ProfileDraft } from "../learning/types";
import TestLearningProvider from "./TestLearningProvider.svelte";

const profile: LearningProfile = {
	id: "profile-1",
	familyId: "family-1",
	displayName: "Jamie",
	ageBand: "primary",
	grade: "Grade 2",
	guardianAccountIds: ["parent"],
	createdAt: "2026-10-14T00:00:00Z",
};
function fixture() {
	const family = {
		getMyFamily: vi.fn(async (): Promise<{ id: string } | null> => ({
			id: "family-1",
		})),
	};
	const learning = {
		getSchool: vi.fn(async () => ({
			name: "",
			address: "",
			email: "",
			phones: [],
			teachers: [],
		})),
		listEligibleGuardians: vi.fn(async () => [
			{ accountId: "parent", displayName: "Alex" },
			{ accountId: "adult-member", displayName: "Morgan" },
		]),
		listProfiles: vi.fn(async () => [profile]),
		createProfile: vi.fn(async (draft: ProfileDraft) => ({
			...profile,
			...draft,
			id: "profile-2",
		})),
		addGuardian: vi.fn(async () => ({
			...profile,
			guardianAccountIds: ["adult-member", "parent"],
		})),
		removeGuardian: vi.fn(async () => profile),
	};
	const runtime = {
		services: {
			auth: {
				getChildPinAccess: vi.fn(async () => ({ enabled: false, loginId: "" })),
			},
			voice: { policy: vi.fn(async () => ({ enabled: false })) },
			robot: { dashboard: vi.fn(async () => ({ devices: [], commands: [] })) },
			childLearning: { review: vi.fn(async () => []) },
			timetable: { get: vi.fn(async () => ({ timezone: "UTC", windows: [] })) },
			family,
			learning,
			homework: {
				previewEmail: vi.fn(),
				importEmail: vi.fn(),
				list: vi.fn(async () => []),
				upload: vi.fn(async () => {}),
				download: vi.fn(async () => new Blob()),
				delete: vi.fn(async () => {}),
			},
		},
		state: { identity: { id: "parent", role: "manager" } },
		router: { navigate: vi.fn() },
	} as unknown as Runtime;
	return { runtime, family, learning };
}
afterEach(cleanup);
describe("parent learning profiles", () => {
	it("only shows the selected child's settings without creation or a profile list", async () => {
		const f = fixture();
		render(TestLearningProvider, { props: { runtime: f.runtime } });
		await screen.findByText("Jamie", { exact: true });
		await fireEvent.click(screen.getByRole("tab", { name: "Setting", exact: true }));
		expect(screen.queryByRole("heading", { name: "Selected: Jamie" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "Add a child profile" })).toBeNull();
		expect(screen.queryByRole("list", { name: "Learning profiles" })).toBeNull();
		expect(
			screen.queryByText("Only profiles shared with you as a guardian appear here."),
		).toBeNull();
		expect(screen.queryByLabelText("Child's name")).toBeNull();
		expect(screen.queryByText("Child mode", { exact: true })).toBeNull();
		expect(screen.queryByRole("button", { name: "Start child mode" })).toBeNull();
		expect(f.learning.createProfile).not.toHaveBeenCalled();
	});
	it("shares and revokes access without removing the last guardian", async () => {
		const f = fixture();
		render(TestLearningProvider, { props: { runtime: f.runtime } });
		await screen.findByText("Jamie", { exact: true });
		await fireEvent.click(screen.getByRole("tab", { name: "Setting", exact: true }));
		screen.getByText("Guardian access").closest("details")!.open = true;
		expect(
			(
				screen.getByRole("button", {
					name: "Remove guardian",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		screen.getByText("Guardian access").closest("details")!.open = true;
		await fireEvent.change(screen.getByLabelText("Share with a parent"), {
			target: { value: "adult-member" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Add guardian" }));
		expect(await screen.findByText("2 guardian(s) can manage this profile.")).toBeTruthy();
		const list = screen.getByRole("list", { name: "Profile guardians" });
		const row = within(list).getByText("Morgan").closest("li")!;
		await fireEvent.click(within(row).getByRole("button", { name: "Remove guardian" }));
		expect(await screen.findByText("Guardian access removed.")).toBeTruthy();
		expect(f.learning.removeGuardian).toHaveBeenCalledWith("profile-1", "adult-member");
	});
	it("keeps the profile unchanged when sharing is denied", async () => {
		const f = fixture();
		f.learning.addGuardian.mockRejectedValue(new Error("Parent must belong to your family."));
		render(TestLearningProvider, { props: { runtime: f.runtime } });
		await screen.findByText("Jamie", { exact: true });
		await fireEvent.click(screen.getByRole("tab", { name: "Setting", exact: true }));
		screen.getByText("Guardian access").closest("details")!.open = true;
		await fireEvent.change(screen.getByLabelText("Share with a parent"), {
			target: { value: "adult-member" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Add guardian" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Parent must belong to your family.",
		);
		expect(screen.getByText("1 guardian(s) can manage this profile.")).toBeTruthy();
	});
	it("requires a family before profile creation", async () => {
		const f = fixture();
		f.family.getMyFamily.mockResolvedValue(null);
		render(TestLearningProvider, { props: { runtime: f.runtime } });
		await fireEvent.click(await screen.findByRole("button", { name: "Open family" }));
		expect(f.runtime.router.navigate).toHaveBeenCalledWith("family:manage");
		expect(f.learning.listProfiles).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Create learning profile" })).toBeNull();
	});
});

it("switches children with the header arrows and keeps tabs keyboard accessible", async () => {
	const f = fixture();
	f.learning.listProfiles.mockResolvedValue([
		profile,
		{ ...profile, id: "profile-2", displayName: "Taylor" },
	]);
	render(TestLearningProvider, { props: { runtime: f.runtime } });
	await screen.findByText("Jamie", { exact: true });
	expect(screen.getByRole("tab", { name: "Assignment", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	expect(screen.getByRole("button", { name: "Previous child" })).toBeDisabled();
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	await screen.findByText("Taylor", { exact: true });
	expect(screen.getByRole("button", { name: "Next child" })).toBeDisabled();
	await waitFor(() => expect(f.runtime.services.homework.list).toHaveBeenCalledWith("profile-2"));
	await fireEvent.keyDown(screen.getByRole("tab", { name: "Assignment", exact: true }), {
		key: "ArrowRight",
	});
	expect(screen.getByRole("tab", { name: "Time Table", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await waitFor(() => expect(f.runtime.services.timetable.get).toHaveBeenCalledWith("profile-2"));
	await fireEvent.click(screen.getByRole("button", { name: "Previous child" }));
	await screen.findByText("Jamie", { exact: true });
	expect(screen.getByRole("tab", { name: "Time Table", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
});

it("switches the compact Homework bar between uploads, saved history, and attempts", async () => {
	const f = fixture();
	render(TestLearningProvider, { props: { runtime: f.runtime } });
	await screen.findByText("Jamie", { exact: true });
	expect(screen.getByRole("button", { name: "Homework", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await fireEvent.click(screen.getByRole("button", { name: "History", exact: true }));
	await screen.findByRole("heading", { name: "Homework history" });
	expect(screen.queryByLabelText("Homework title")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Attempts", exact: true }));
	expect(screen.getByRole("region", { name: "Child attempts" })).toBeVisible();
	expect(screen.queryByRole("heading", { name: "Homework history" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Homework", exact: true }));
	expect(screen.getByRole("searchbox", { name: "Search homework" })).toBeVisible();
	expect(screen.queryByRole("region", { name: "Child attempts" })).toBeNull();
});
