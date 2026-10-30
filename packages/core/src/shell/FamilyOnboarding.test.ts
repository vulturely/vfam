import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { toastService } from "../services/toast.svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import Provider from "./TestFamilyOnboardingProvider.svelte";
vi.mock("./ResourceSettings.svelte", () => ({ default: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function setup(
	existing = false,
	loadError = "",
	initialProfiles: import("../learning/types").LearningProfile[] = [],
) {
	const family = {
		id: "family-1",
		name: "Morgan family",
		description: "",
		createdAt: "",
	};
	const getMyFamily = vi.fn().mockResolvedValue(existing ? family : null);
	if (loadError) getMyFamily.mockRejectedValueOnce(new Error(loadError));
	const createFamily = vi.fn().mockResolvedValue(family);
	const createProfile = vi.fn().mockResolvedValue({
		id: "child-1",
		displayName: "Jamie",
		familyId: family.id,
		ageBand: "primary",
		grade: "",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
	});
	const runtime = {
		state: { familyId: null, identity: { id: "parent", name: "Alex Morgan" } },
		services: {
			timetable: {
				get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
				setTimezone: vi.fn().mockResolvedValue({ timezone: "UTC" }),
			},
			family: {
				getMyFamily,
				createFamily,
				getFamilyAvatar: vi.fn().mockResolvedValue(null),
				setFamilyAvatar: vi.fn().mockResolvedValue(undefined),
				getAvatar: vi.fn().mockResolvedValue(null),
			},
			learning: {
				listProfiles: vi.fn().mockResolvedValue(initialProfiles),
				createProfile,
				updateProgression: vi.fn().mockResolvedValue({
					id: "child-1",
					displayName: "Jamie",
					familyId: "family-1",
					ageBand: "primary",
					grade: "Grade 3",
					createdAt: "2026-01-01T00:00:00Z",
					guardianAccountIds: ["parent"],
				}),
			},
			auth: {
				getParentPinAccess: vi.fn().mockResolvedValue({ enabled: false }),
				getChildPinAccess: vi.fn().mockResolvedValue({ enabled: false, loginId: "" }),
			},
		},
		router: { navigate: vi.fn() },
	} as unknown as Runtime;
	render(Provider, { runtime });
	return { runtime, getMyFamily, createFamily, createProfile };
}
it("keeps setup focused on a single step and saves the family before adding children", async () => {
	const { createFamily, runtime } = setup();
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	expect(screen.getByRole("heading", { name: "Your profile" })).toBeVisible();
	expect(screen.queryByLabelText("Family name")).toBeNull();
	expect(screen.getByRole("button", { name: "3 Children" })).toBeDisabled();
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Enter a family name",
	);
	expect(createFamily).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("Family name"), {
		target: { value: " Morgan family " },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByRole("heading", { name: "Add your children" });
	expect(createFamily).toHaveBeenCalledWith("Morgan family");
	expect(runtime.state.familyId).toBe("family-1");
});
it("opens a blank child form by default, then opens settings for the saved child", async () => {
	const { createProfile } = setup(true);
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	expect(screen.getByLabelText("Child's name")).toHaveValue("");
	expect(screen.getByLabelText("Date of birth")).toHaveValue("");
	await fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "Jamie" },
	});
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: `${new Date().getUTCFullYear() - 7}-01-01` },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Add child", exact: true }).closest("form")!,
	);
	await screen.findByLabelText("Six-digit PIN");
	expect(createProfile).toHaveBeenCalledWith({
		familyId: "family-1",
		displayName: "Jamie",
		ageBand: "primary",
		grade: "",
		progression: {
			dateOfBirth: `${new Date().getUTCFullYear() - 7}-01-01`,
			autoGrade: false,
			schoolYearMonth: 9,
			schoolYearDay: 1,
			country: "",
			region: "",
		},
	});
	expect(screen.getByLabelText("Child's name")).toHaveValue("Jamie");
	expect(document.querySelector("details.personal")).not.toHaveAttribute("open");
	await fireEvent.click(screen.getByText("Personal", { exact: true }));
	expect(screen.getByLabelText("Date of birth")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: /Jamie/ }));
	expect(screen.queryByLabelText("Six-digit PIN")).toBeNull();
});
it("keeps optional services collapsed and can finish without configuring them", async () => {
	const { runtime } = setup(true);
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "4 Services" }));
	expect(screen.getByText("Connect family services").closest("details")).not.toHaveAttribute(
		"open",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
	expect(runtime.router.navigate).toHaveBeenCalledWith("home:parent");
});
it("keeps the current step and reports a failed family save", async () => {
	const { createFamily } = setup();
	createFamily.mockRejectedValue(new Error("Please reconnect"));
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await fireEvent.input(screen.getByLabelText("Family name"), {
		target: { value: "Morgans" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Please reconnect",
	);
	expect(screen.getByLabelText("Family name")).toHaveValue("Morgans");
	expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});

it("can retry a failed initial load without presenting a broken setup", async () => {
	setup(false, "Connection lost");
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Connection lost",
	);
	expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
	await fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	toastService.clear();
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});
it("preserves a failed child draft and can leave optional creation without blocking finish", async () => {
	const { createProfile } = setup(true);
	createProfile.mockRejectedValue(new Error("Please reconnect"));
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "Jamie" },
	});
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: `${new Date().getUTCFullYear() - 7}-01-01` },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Add child", exact: true }).closest("form")!,
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Please reconnect",
	);
	expect(screen.getByLabelText("Child's name")).toHaveValue("Jamie");
	await fireEvent.click(screen.getByRole("button", { name: "4 Services" }));
	expect(screen.getByRole("button", { name: "Finish setup" })).toBeEnabled();
});

it("uses exit/forward on the first stage and back/forward on subsequent stages", async () => {
	const { runtime } = setup(true);
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	const exit = screen.getByRole("button", { name: "Exit setup" });
	expect(screen.queryByRole("button", { name: "Back", exact: true })).toBeNull();
	await fireEvent.click(exit);
	expect(runtime.router.navigate).toHaveBeenCalledWith("home:parent");
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	expect(screen.queryByRole("button", { name: "Exit setup" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Back", exact: true }));
	expect(screen.getByRole("heading", { name: "Your profile" })).toBeVisible();
	expect(screen.getByRole("button", { name: "Exit setup" })).toBeVisible();
});

it("shows only the family picture and visible name field on the family stage", async () => {
	setup(true);
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	expect(screen.getByRole("img", { name: "Default family picture" })).toBeVisible();
	expect(screen.getByLabelText("Family name")).toHaveValue("Morgan family");
	expect(screen.getByLabelText("Upload family picture")).toBeTruthy();
	expect(screen.queryByLabelText("About your family")).toBeNull();
	expect(screen.queryByLabelText("Relative's account ID")).toBeNull();
	expect(screen.queryByText("More family settings")).toBeNull();
});
it("previews a new family picture and creates the family before uploading it", async () => {
	const { runtime, createFamily } = setup();
	const makeUrl = vi.fn().mockReturnValue("blob:family-preview");
	vi.stubGlobal("URL", { createObjectURL: makeUrl, revokeObjectURL: vi.fn() });
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	const picture = new File(["photo"], "family.png", { type: "image/png" });
	Object.defineProperty(picture, "arrayBuffer", {
		value: async () => new Uint8Array([1, 2, 3]).buffer,
	});
	await fireEvent.change(screen.getByLabelText("Upload family picture"), {
		target: { files: [picture] },
	});
	expect(screen.getByRole("img", { name: "Family preview" })).toHaveAttribute(
		"src",
		"blob:family-preview",
	);
	expect(runtime.services.family.setFamilyAvatar).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("Family name"), {
		target: { value: "Morgans" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByRole("heading", { name: "Add your children" });
	expect(createFamily).toHaveBeenCalledWith("Morgans");
	expect(runtime.services.family.setFamilyAvatar).toHaveBeenCalledWith(
		new Uint8Array([1, 2, 3]),
		"image/png",
	);
});

it("lets parents choose an automatic school calendar and later switch back to manual", async () => {
	const { createProfile, runtime } = setup(true);
	createProfile.mockImplementationOnce(async (input: import("../learning/types").ProfileDraft) => ({
		...input,
		id: "child-1",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
	}));
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "Jamie" },
	});
	const dob = `${new Date().getUTCFullYear() - 7}-01-01`;
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: dob },
	});
	await fireEvent.click(screen.getByText("Grade and school calendar"));
	expect(screen.getByLabelText("Grade updates")).toHaveValue("false");
	await fireEvent.input(screen.getByLabelText("Grade or learning stage (optional)"), {
		target: { value: "Grade 2" },
	});
	await fireEvent.change(screen.getByLabelText("Grade updates"), {
		target: { value: "true" },
	});
	await fireEvent.input(screen.getByLabelText("Country"), {
		target: { value: "Nepal" },
	});
	await fireEvent.input(screen.getByLabelText("State or region"), {
		target: { value: "Bagmati" },
	});
	await fireEvent.change(screen.getByLabelText("School-year start month"), {
		target: { value: "4" },
	});
	await fireEvent.input(screen.getByLabelText("Day"), {
		target: { value: "15" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Add child", exact: true }).closest("form")!,
	);
	await screen.findByLabelText("Six-digit PIN");
	expect(createProfile).toHaveBeenCalledWith(
		expect.objectContaining({
			progression: {
				dateOfBirth: dob,
				autoGrade: true,
				schoolYearMonth: 4,
				schoolYearDay: 15,
				country: "Nepal",
				region: "Bagmati",
			},
		}),
	);
	await fireEvent.click(screen.getByText("Grade and school calendar"));
	expect(screen.getByLabelText("Grade updates")).toHaveValue("true");
	await fireEvent.change(screen.getByLabelText("Grade updates"), {
		target: { value: "false" },
	});
	await fireEvent.input(screen.getByLabelText("Grade or learning stage (optional)"), {
		target: { value: "Grade 3" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save school calendar" }).closest("form")!,
	);
	await screen.findByText("School calendar saved.");
	expect(runtime.services.learning.updateProgression).toHaveBeenCalledWith("child-1", "Grade 3", {
		dateOfBirth: dob,
		autoGrade: false,
		schoolYearMonth: 4,
		schoolYearDay: 15,
		country: "Nepal",
		region: "Bagmati",
	});
});
it("searches and selects guardians, cancels without saving, and saves checked parents", async () => {
	const { runtime } = setup(true);
	const child = {
		id: "child-1",
		displayName: "Jamie",
		familyId: "family-1",
		ageBand: "primary" as const,
		grade: "",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
	};
	vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([child]);
	runtime.services.learning.listEligibleGuardians = vi.fn().mockResolvedValue([
		{ accountId: "alex", displayName: "Alex" },
		{ accountId: "sam", displayName: "Sam" },
	]);
	const addGuardian = vi.fn().mockImplementation(async (_id, accountId) => ({
		...child,
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent", accountId],
	}));
	runtime.services.learning.addGuardian = addGuardian;
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await fireEvent.click(screen.getByText("Guardian access", { exact: true }));
	await fireEvent.focus(screen.getByRole("textbox", { name: "Guardian user ID" }));
	await screen.findByRole("checkbox", { name: "Alex" });
	expect(screen.queryByRole("button", { name: "Save guardians" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Cancel adding guardians" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Add guardian", exact: true })).toBeNull();
	expect(document.querySelector(".guardian-access")).toBeVisible();
	expect(document.querySelector(".child-settings details.school-calendar")).not.toBeNull();
	expect(document.querySelector("details.pin-accordion")).not.toBeNull();
	await fireEvent.input(screen.getByRole("searchbox", { name: "Search guardians" }), {
		target: { value: "sam" },
	});
	expect(screen.queryByRole("checkbox", { name: "Alex" })).toBeNull();
	await fireEvent.click(screen.getByRole("checkbox", { name: "Sam" }));
	await fireEvent.click(screen.getByRole("button", { name: "Cancel adding guardians" }));
	expect(addGuardian).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Save guardians" })).toBeNull();
	expect(screen.getByRole("textbox", { name: "Guardian user ID" })).toBeVisible();
	await fireEvent.focus(screen.getByRole("textbox", { name: "Guardian user ID" }));
	await fireEvent.click(await screen.findByRole("checkbox", { name: "Alex" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save guardians" }));
	await waitFor(() => expect(addGuardian).toHaveBeenCalledWith("child-1", "alex"));
	await waitFor(() => expect(screen.queryByRole("searchbox")).toBeNull());
	const input = screen.getByRole("textbox", { name: "Guardian user ID" });
	await fireEvent.input(input, { target: { value: "manual-user" } });
	await fireEvent.keyDown(input, { key: "Enter" });
	expect(screen.getByText("manual-user")).toBeVisible();
	expect(input).toHaveValue("");
	await fireEvent.click(screen.getByRole("button", { name: "Save guardians" }));
	await waitFor(() => expect(addGuardian).toHaveBeenCalledWith("child-1", "manual-user"));
});
it("edits a saved child name without saving unrelated calendar drafts", async () => {
	const { runtime } = setup(true);
	const profile = {
		id: "child-1",
		familyId: "family-1",
		displayName: "Jamie",
		ageBand: "primary" as const,
		grade: "Grade 2",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
	};
	vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([profile]);
	const update = vi
		.mocked(runtime.services.learning.updateProgression)
		.mockResolvedValue({ ...profile, displayName: "Jamie Morgan" });
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await fireEvent.click(screen.getByText("Personal", { exact: true }));
	await fireEvent.click(screen.getByText("Grade and school calendar"));
	await fireEvent.input(screen.getByLabelText("Grade or learning stage (optional)"), {
		target: { value: "Unsubmitted stage" },
	});
	const input = screen.getByLabelText("Child's name");
	expect(input).not.toHaveAttribute("readonly");
	await fireEvent.input(input, { target: { value: " Jamie Morgan " } });
	await fireEvent.blur(input);
	expect(update).not.toHaveBeenCalled();
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save personal changes" }).closest("form")!,
	);
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith("child-1", "Grade 2", undefined, "Jamie Morgan"),
	);
	await screen.findByRole("button", { name: /Jamie Morgan/ });
	expect(screen.getByLabelText("Grade or learning stage (optional)")).toHaveValue(
		"Unsubmitted stage",
	);
	expect(input).toHaveValue("Jamie Morgan");
});
it("shows Personal actions for either edit, cancels both fields, and saves DOB explicitly", async () => {
	const { runtime } = setup(true);
	const dateOfBirth = `${new Date().getUTCFullYear() - 7}-01-01`;
	const progression = {
		dateOfBirth,
		autoGrade: false,
		schoolYearMonth: 9,
		schoolYearDay: 1,
		country: "",
		region: "",
	};
	const profile = {
		id: "child-1",
		familyId: "family-1",
		displayName: "Jamie",
		ageBand: "primary" as const,
		grade: "Grade 2",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
		progression,
	};
	vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([profile]);
	const update = vi
		.mocked(runtime.services.learning.updateProgression)
		.mockImplementation(async (_id, _grade, policy, displayName) => ({
			...profile,
			displayName: displayName ?? profile.displayName,
			progression: policy,
		}));
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await fireEvent.click(screen.getByText("Personal", { exact: true }));
	expect(screen.getByText("Personal")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Save personal changes" })).toBeNull();
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "Draft name" },
	});
	const newDob = `${new Date().getUTCFullYear() - 7}-02-01`;
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: newDob },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Cancel personal changes" }));
	expect(screen.getByLabelText("Child's name")).toHaveValue("Jamie");
	expect(screen.getByLabelText("Date of birth")).toHaveValue(dateOfBirth);
	expect(update).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Save personal changes" })).toBeNull();
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: newDob },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save personal changes" }).closest("form")!,
	);
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(
			"child-1",
			"Grade 2",
			{ ...progression, dateOfBirth: newDob },
			"Jamie",
		),
	);
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Save personal changes" })).toBeNull(),
	);
	expect(screen.getByLabelText("Date of birth")).toHaveValue(newDob);
});
it("moves between child profiles and preserves an unfinished new-child draft", async () => {
	const { runtime, createProfile } = setup(true);
	vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([
		{
			id: "older-1",
			familyId: "family-1",
			displayName: "Jamie",
			ageBand: "primary",
			grade: "Grade 2",
			createdAt: "2026-01-01T00:00:00Z",
			guardianAccountIds: ["parent"],
		},
		{
			id: "older-2",
			familyId: "family-1",
			displayName: "Taylor",
			ageBand: "preteen",
			grade: "Grade 5",
			createdAt: "2026-01-01T00:00:00Z",
			guardianAccountIds: ["parent"],
		},
	]);
	createProfile.mockImplementation(async (input) => ({
		...input,
		id: "new-child",
		createdAt: "2026-01-01T00:00:00Z",
		guardianAccountIds: ["parent"],
	}));
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	expect(screen.getByRole("button", { name: "Previous child" })).toBeDisabled();
	expect(screen.queryByRole("button", { name: /Taylor/ })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	await screen.findByRole("button", { name: /Taylor/ });
	await fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
	await waitFor(() => expect(screen.getByLabelText("Child's name")).toHaveValue(""));
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "New sibling" },
	});
	const dob = `${new Date().getUTCFullYear() - 7}-01-01`;
	await fireEvent.input(screen.getByLabelText("Date of birth"), {
		target: { value: dob },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Previous child" }));
	const previous = await screen.findByRole("button", { name: /Taylor/ });
	expect(previous).toHaveAttribute("aria-expanded", "false");
	await fireEvent.click(previous);
	expect(document.querySelector("details.personal")).not.toHaveAttribute("open");
	await waitFor(() => expect(screen.getByLabelText("Child's name")).toHaveValue("Taylor"));
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	await waitFor(() => expect(screen.getByLabelText("Child's name")).toHaveValue("New sibling"));
	expect(screen.getByLabelText("Date of birth")).toHaveValue(dob);
	await fireEvent.submit(
		screen.getByRole("button", { name: "Add child", exact: true }).closest("form")!,
	);
	await screen.findByRole("button", { name: /New sibling/ });
	expect(screen.getByText("3 of 3")).toBeVisible();
});
it("remembers each child's card and section expansion state independently", async () => {
	const { runtime } = setup(true);
	vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue(
		["Jamie", "Taylor", "Riley"].map((displayName, index) => ({
			id: `child-${index}`,
			familyId: "family-1",
			displayName,
			ageBand: "primary" as const,
			grade: "",
			createdAt: "2026-01-01T00:00:00Z",
			guardianAccountIds: ["parent"],
		})),
	);
	await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "3 Children" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await fireEvent.click(screen.getByText("Personal", { exact: true }));
	await fireEvent.click(screen.getByText("Profile PIN", { exact: true }));
	await fireEvent.click(screen.getByText("Guardian access", { exact: true }));
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	expect(await screen.findByRole("button", { name: /Taylor/ })).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Riley/ }));
	await fireEvent.click(screen.getByText("Grade and school calendar", { exact: true }));
	await fireEvent.click(screen.getByRole("button", { name: "Previous child" }));
	expect(await screen.findByRole("button", { name: /Taylor/ })).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Previous child" }));
	expect(await screen.findByRole("button", { name: /Jamie/ })).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	for (const selector of ["details.personal", "details.pin-accordion", "details.guardian-access"])
		expect(document.querySelector(selector)).toHaveAttribute("open");
	expect(document.querySelector("details.school-calendar")).not.toHaveAttribute("open");
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	await fireEvent.click(screen.getByRole("button", { name: "Next child" }));
	expect(await screen.findByRole("button", { name: /Riley/ })).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	expect(document.querySelector("details.school-calendar")).toHaveAttribute("open");
	expect(document.querySelector("details.personal")).not.toHaveAttribute("open");
});

it("validates personal edits, saves school progression, and adds guardian chips", async () => {
	const profile = {
		id: "child-1",
		displayName: "Jamie",
		familyId: "family-1",
		ageBand: "primary" as const,
		grade: "Grade 2",
		guardianAccountIds: ["parent", "other"],
		createdAt: "2026-01-01T00:00:00Z",
		progression: {
			dateOfBirth: `${new Date().getUTCFullYear() - 7}-01-01`,
			autoGrade: false,
			schoolYearMonth: 9,
			schoolYearDay: 1,
			country: "",
			region: "",
		},
	};
	const { runtime } = setup(true, "", [profile]);
	runtime.services.learning.listEligibleGuardians = vi.fn(async () => [
		{ accountId: "new-parent", displayName: "New parent" },
		{ accountId: "another", displayName: "Another parent" },
		{ accountId: "third", displayName: "Third parent" },
		{ accountId: "fourth", displayName: "Fourth parent" },
	]);
	runtime.services.learning.addGuardian = vi.fn(async () => ({
		...profile,
		guardianAccountIds: ["parent", "other", "new-parent"],
	}));
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(await screen.findByRole("button", { name: "3 Children" }));
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await fireEvent.click(screen.getByText("Personal", { exact: true }));
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "bad\u0001name" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save personal changes" }).closest("form")!,
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Enter a child name with 1–80 characters",
	);
	await fireEvent.input(screen.getByLabelText("Child's name"), {
		target: { value: "Updated Jamie" },
	});
	await fireEvent.submit(
		screen.getByRole("button", { name: "Save personal changes" }).closest("form")!,
	);
	await waitFor(() =>
		expect(runtime.services.learning.updateProgression).toHaveBeenCalledWith(
			"child-1",
			"Grade 2",
			expect.objectContaining({ dateOfBirth: profile.progression.dateOfBirth }),
			"Updated Jamie",
		),
	);
	await fireEvent.click(screen.getByText("Grade and school calendar", { exact: true }));
	await fireEvent.click(screen.getByRole("button", { name: "Save school calendar" }));
	expect(await screen.findByRole("status")).toHaveTextContent("School calendar saved.");
	await fireEvent.click(screen.getByText("Guardian access", { exact: true }));
	await fireEvent.click(screen.getByLabelText("Guardian user ID"));
	await fireEvent.input(screen.getByRole("searchbox", { name: "Search guardians" }), {
		target: { value: "new" },
	});
	await fireEvent.click(screen.getByRole("checkbox", { name: "New parent" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save guardians" }));
	await waitFor(() =>
		expect(runtime.services.learning.addGuardian).toHaveBeenCalledWith("child-1", "new-parent"),
	);
});

it("renames an existing family without recreating it", async () => {
	const { runtime, createFamily } = setup(true);
	runtime.services.family.renameFamily = vi.fn(async (name: string) => ({
		id: "family-1",
		name,
		description: "",
		createdAt: "",
	}));
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "2 Your family" }));
	await fireEvent.input(screen.getByLabelText("Family name"), {
		target: { value: "Updated family" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByRole("heading", { name: "Add your children" });
	expect(runtime.services.family.renameFamily).toHaveBeenCalledWith("Updated family");
	expect(createFamily).not.toHaveBeenCalled();
});

it("rejects non-image profile and family photos while tolerating optional avatar failures", async () => {
	const { runtime } = setup(true);
	runtime.services.family.getAvatar = vi.fn().mockRejectedValue(new Error("offline"));
	runtime.services.family.getFamilyAvatar = vi.fn().mockRejectedValue(new Error("offline"));
	runtime.services.family.setAvatar = vi.fn();
	await waitFor(() => expect(screen.queryByText("Loading your family…")).toBeNull());
	const profileInput = document.querySelector('input[type="file"]')!;
	await fireEvent.change(profileInput, {
		target: { files: [new File(["text"], "note.txt", { type: "text/plain" })] },
	});
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose an image file.",
	);
	expect(runtime.services.family.setAvatar).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "2 Your family" }));
	await fireEvent.change(screen.getByLabelText("Upload family picture"), {
		target: { files: [new File(["text"], "note.txt", { type: "text/plain" })] },
	});
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose an image file.",
	);
	expect(runtime.services.family.setFamilyAvatar).not.toHaveBeenCalled();
});
