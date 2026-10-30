import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import { createMemoryTaskStorage, createTaskService } from "../tasks/service";
import TestFamilyProvider from "./TestFamilyProvider.svelte";
import { cleanup } from "@testing-library/svelte";
import { toastService } from "../services/toast.svelte";

/** Runtime with an empty/no family so the mount effect settles cleanly. */
function makeRuntime(): Runtime {
	return {
		config: {} as Runtime["config"],
		bus: {} as Runtime["bus"],
		router: {
			current: { screen: "family:manage", params: {} },
			navigate: vi.fn(),
		},
		state: {
			identity: {
				id: "acct-1",
				name: "Parent",
				role: "manager",
				familyId: "fam-1",
				deviceId: "dev-1",
				createdAt: "2026-01-01T00:00:00Z",
			},
			familyId: "fam-1",
		},
		hasIdentity: true,
		screens: new Map(),
		navItems: [],
		services: {
			family: {
				getMyFamily: vi.fn(async () => ({
					id: "fam-1",
					name: "Smith family",
					description: "",
					createdAt: "2026-01-01T00:00:00Z",
				})),
				listMembers: vi.fn(async () => [
					{
						id: "member-1",
						familyId: "fam-1",
						accountId: "kid-1",
						role: "member",
						createdAt: "2026-01-01T00:00:00Z",
					},
				]),
				getFamilyAvatar: vi.fn(async () => null),
			},
			learning: { listProfiles: vi.fn(async () => []) },
			tasks: createTaskService(createMemoryTaskStorage()),
		} as unknown as Runtime["services"],
		theme: { mode: "light", toggle: vi.fn() },
		canAccessScreen: vi.fn(() => true),
		homeScreenForCurrentRole: vi.fn(() => "home:parent"),
		logout: vi.fn(),
		restoreSession: vi.fn(async () => {}),
		completeOnboarding: vi.fn(),
	} as unknown as Runtime;
}

describe("FamilyScreen tabs", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("renders the Tasks, Chart, and Manage tabs", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });
		expect(await screen.findByRole("tab", { name: /Tasks/ })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /Chart/ })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /Manage/ })).toBeTruthy();
	});

	it("supports keyboard navigation with one focusable tab and an associated panel", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });
		const tasks = await screen.findByRole("tab", { name: "Tasks" });
		expect(tasks).toHaveAttribute("tabindex", "0");
		await fireEvent.keyDown(tasks, { key: "ArrowRight" });
		const chart = screen.getByRole("tab", { name: "Chart" });
		expect(chart).toHaveFocus();
		expect(chart).toHaveAttribute("aria-selected", "true");
		expect(tasks).toHaveAttribute("tabindex", "-1");
		expect(screen.getByRole("tabpanel", { name: "Chart" })).toBeVisible();
		await fireEvent.keyDown(chart, { key: "End" });
		expect(screen.getByRole("tab", { name: "Manage" })).toHaveFocus();
		await fireEvent.keyDown(screen.getByRole("tab", { name: "Manage" }), {
			key: "ArrowRight",
		});
		expect(tasks).toHaveFocus();
	});

	it("switches to the Chart tab and shows its content", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });
		const chart = await screen.findByRole("tab", { name: /Chart/ });
		fireEvent.click(chart);
		expect(await screen.findByText("kid-1")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Family tree" })).toBeNull();
	});

	it("includes guardian-visible child profiles in the chart alongside account members", async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([
			{
				id: "child-1",
				familyId: "fam-1",
				displayName: "Evan",
				ageBand: "primary",
				grade: "Grade 2",
				guardianAccountIds: ["acct-1"],
				createdAt: "",
			},
		]);
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("tab", { name: "Chart" }));
		expect(await screen.findByText("Evan")).toBeVisible();
		expect(screen.getByText("Grade 2")).toBeVisible();
		expect(screen.getByText("Child")).toBeVisible();
		expect(runtime.services.learning.listProfiles).toHaveBeenCalledWith("fam-1");
	});
	it("keeps relatives visible and offers retry if child profiles fail to load", async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.services.learning.listProfiles).mockRejectedValue(new Error("offline"));
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("tab", { name: "Chart" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Could not load child profiles",
		);
		expect(screen.getByText("kid-1")).toBeVisible();
		vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([]);
		await fireEvent.click(screen.getByRole("button", { name: "Retry child profiles" }));
		await waitFor(() => expect(runtime.services.learning.listProfiles).toHaveBeenCalledTimes(2));
		toastService.clear();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	});

	it("switches to the Manage tab and shows the add-relative control", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });
		const manage = await screen.findByRole("tab", { name: /Manage/ });
		fireEvent.click(manage);
		expect(await screen.findByRole("button", { name: "Add relative" })).toBeTruthy();
	});

	it("assigns tasks to child profiles without offering them as account reviewers", async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.services.learning.listProfiles).mockResolvedValue([
			{
				id: "child-1",
				familyId: "fam-1",
				displayName: "Evan",
				ageBand: "primary",
				grade: "Grade 2",
				guardianAccountIds: ["acct-1"],
				createdAt: "",
			},
		]);
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
		const panel = screen.getByRole("dialog", { name: "Create task ticket" });
		await fireEvent.input(within(panel).getByLabelText("Summary"), {
			target: { value: "Pack bag" },
		});
		await fireEvent.click(within(panel).getByRole("button", { name: "Select assignees…" }));
		await fireEvent.click(await screen.findByRole("option", { name: /Evan/ }));
		await fireEvent.click(within(panel).getByRole("button", { name: "Select reviewers…" }));
		expect(screen.queryByRole("option", { name: /Evan/ })).toBeNull();
		await fireEvent.click(within(panel).getByRole("button", { name: "Add task" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		const tasks = await runtime.services.tasks.listTasks("fam-1");
		expect(tasks.find((task) => task.title === "Pack bag")).toMatchObject({
			assigneeAccountIds: [],
			assigneeProfileIds: ["child-1"],
		});
		expect(screen.getByText(/· Evan/)).toBeVisible();
	});

	it("shows a relative's name, account role and ID together", async () => {
		const runtime = makeRuntime();
		runtime.services.family.getAccount = vi.fn().mockResolvedValue({
			id: "kid-1",
			displayName: "Sam Morgan",
			role: "kid",
		});
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("tab", { name: /Manage/ }));
		expect(await screen.findByText("Sam Morgan")).toBeVisible();
		expect(screen.getByText("Child")).toBeVisible();
		expect(screen.getByText("kid-1")).toBeVisible();
	});

	it("edits the family name and note through the shared side form", async () => {
		const runtime = makeRuntime();
		runtime.services.family.renameFamily = vi.fn().mockResolvedValue({ name: "Morgan family" });
		runtime.services.family.updateFamilyDescription = vi
			.fn()
			.mockResolvedValue({ description: "Our family note" });
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.dblClick(await screen.findByRole("heading", { name: "Smith family" }));
		expect(screen.getByRole("dialog", { name: "Edit family name" })).toBeInTheDocument();
		await fireEvent.input(screen.getByLabelText("Family name"), {
			target: { value: "Morgan family" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Save family name" }));
		await waitFor(() =>
			expect(runtime.services.family.renameFamily).toHaveBeenCalledWith("Morgan family"),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await fireEvent.click(screen.getByRole("button", { name: "Add a family note" }));
		expect(screen.getByRole("dialog", { name: "Who we are" })).toBeInTheDocument();
		await fireEvent.input(screen.getByLabelText("Family note"), {
			target: { value: "Our family note" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Save description" }));
		await waitFor(() =>
			expect(runtime.services.family.updateFamilyDescription).toHaveBeenCalledWith(
				"Our family note",
			),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	});

	it("shows an add-relative save failure inside the side form and allows retry", async () => {
		const runtime = makeRuntime();
		runtime.services.family.getAccount = vi.fn().mockResolvedValue({
			id: "relative",
			displayName: "Sam",
			role: "parent",
		});
		runtime.services.family.addMember = vi
			.fn()
			.mockRejectedValueOnce(new Error("Could not add relative"))
			.mockResolvedValueOnce({
				id: "new-relative",
				familyId: "fam-1",
				accountId: "relative",
				role: "member",
				createdAt: "2026-01-01T00:00:00Z",
			});
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("tab", { name: /Manage/ }));
		await fireEvent.click(screen.getByRole("button", { name: "Add relative", exact: true }));
		const panel = screen.getByRole("dialog", { name: "Add relatives" });
		await fireEvent.input(within(panel).getByLabelText("Relative account id"), {
			target: { value: "relative" },
		});
		await within(panel).findByText("Sam");
		await fireEvent.click(within(panel).getByRole("button", { name: "Add relative" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Could not add relative",
		);
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		await fireEvent.click(within(panel).getByRole("button", { name: "Add relative" }));
		const relationship = await screen.findByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await fireEvent.click(within(relationship).getByRole("button", { name: "Close", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(runtime.services.family.addMember).toHaveBeenLastCalledWith(
			"fam-1",
			"relative",
			"member",
		);
	});

	it("edits an existing task in the side form and preserves its draft after a save failure", async () => {
		const runtime = makeRuntime();
		const task = await runtime.services.tasks.createTask("fam-1", {
			title: "Original task",
			details: "Original instructions",
			assigneeAccountIds: [],
			reviewerAccountIds: [],
			startAt: "",
			endAt: "",
			repeat: "none",
		});
		const update = vi
			.spyOn(runtime.services.tasks, "updateTask")
			.mockRejectedValueOnce(new Error("Task save unavailable"));
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("button", { name: "Edit task" }));
		const panel = screen.getByRole("dialog", { name: "Edit task ticket" });
		expect(within(panel).getByLabelText("Summary")).toHaveValue("Original task");
		await fireEvent.input(within(panel).getByLabelText("Summary"), {
			target: { value: "Updated task" },
		});
		await fireEvent.click(within(panel).getByRole("button", { name: "Save task" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Task save unavailable",
		);
		expect(within(panel).getByLabelText("Summary")).toHaveValue("Updated task");
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		await fireEvent.click(within(panel).getByRole("button", { name: "Save task" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(update).toHaveBeenLastCalledWith(
			task.id,
			expect.objectContaining({
				title: "Updated task",
				details: "Original instructions",
			}),
		);
		expect((await runtime.services.tasks.listTasks("fam-1")).map((value) => value.title)).toEqual([
			"Updated task",
		]);
	});

	it("creates and completes a task with note, assignee, and timeline", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });

		expect(screen.queryByLabelText("Summary")).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

		await fireEvent.input(await screen.findByLabelText("Summary"), {
			target: { value: "Grocery shopping" },
		});
		await fireEvent.input(screen.getByLabelText("Start"), {
			target: { value: "2026-09-06T10:30" },
		});
		await fireEvent.input(screen.getByLabelText("End"), {
			target: { value: "2026-09-06T12:30" },
		});
		await fireEvent.change(screen.getByLabelText("Repeat"), {
			target: { value: "daily" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Select assignees…" }));
		await fireEvent.click(screen.getByRole("option", { name: /kid-1/ }));
		await fireEvent.click(screen.getByRole("button", { name: "Add task" }));

		expect(await screen.findByRole("heading", { name: "Grocery shopping" })).toBeTruthy();
		expect(screen.getAllByText(/kid-1/).length).toBeGreaterThan(0);
		expect(screen.getByText(/Repeats every day/)).toBeTruthy();

		await fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
		expect(await screen.findByText(/Completed/)).toBeTruthy();
	});

	it("prefills common kids tasks from templates", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });

		await fireEvent.click(screen.getByRole("button", { name: "Create task" }));
		await fireEvent.change(screen.getByLabelText("Template"), {
			target: { value: "fix-bed" },
		});

		expect((screen.getByLabelText("Summary") as HTMLInputElement).value).toBe("Fix bed");
		expect(screen.getByLabelText("Description").textContent).toContain(
			"Make the bed and tidy pillows/blankets.",
		);
		expect((screen.getByLabelText("Repeat") as HTMLSelectElement).value).toBe("daily");
		await fireEvent.click(
			screen
				.getAllByRole("button", { name: /kid-1/ })
				.find((el) => el.getAttribute("aria-haspopup") === "listbox")!,
		);
		expect(
			(screen.getByRole("option", { name: /kid-1/ }) as HTMLButtonElement).getAttribute(
				"aria-selected",
			),
		).toBe("true");
	});

	it("adds rich text formatting from the task description toolbar", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });

		await fireEvent.click(screen.getByRole("button", { name: "Create task" }));

		expect(await screen.findByLabelText("Description")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Bulleted list" })).toBeTruthy();
	});

	it("adds a comment to a task", async () => {
		render(TestFamilyProvider, { props: { runtime: makeRuntime() } });

		await fireEvent.click(screen.getByRole("button", { name: "Create task" }));
		await fireEvent.input(await screen.findByLabelText("Summary"), {
			target: { value: "Kids homework" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Add task" }));
		await screen.findByRole("heading", { name: "Kids homework" });

		await fireEvent.input(screen.getByLabelText("Add note or question"), {
			target: { value: "Did you finish math?" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

		expect(await screen.findByText("Did you finish math?")).toBeTruthy();
	});

	it("keeps stale family and task data read-only", async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.services.family.getMyFamily).mockResolvedValue({
			id: "fam-1",
			name: "Offline family",
			description: "Saved offline",
			createdAt: "2026-01-01T00:00:00Z",
			stale: true,
		});
		const task = await runtime.services.tasks.createTask("fam-1", { title: "Saved task" });
		vi.spyOn(runtime.services.tasks, "listTasks").mockResolvedValue([{ ...task, stale: true }]);
		render(TestFamilyProvider, { props: { runtime } });

		expect(await screen.findByRole("button", { name: "Edit task" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Edit Who we are" })).toBeDisabled();
		await fireEvent.dblClick(screen.getByRole("heading", { name: "Offline family" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		await fireEvent.click(screen.getByRole("tab", { name: "Manage" }));
		expect(screen.getByRole("button", { name: "Add relative" })).toBeDisabled();
	});

	it("reports account lookup failures and adds a previewed administrator", async () => {
		const runtime = makeRuntime();
		runtime.services.family.getAccount = vi.fn(async (id: string) => {
			if (id === "missing") throw new Error("Account not found");
			return { id, displayName: "Morgan Admin", role: "parent" as const };
		});
		runtime.services.family.addMember = vi.fn(async (_family, accountId, role) => ({
			id: "admin-member",
			familyId: "fam-1",
			accountId,
			role,
			createdAt: "2026-01-01T00:00:00Z",
		}));
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("tab", { name: "Manage" }));
		await fireEvent.click(screen.getByRole("button", { name: "Add relative", exact: true }));
		const input = screen.getByLabelText("Relative account id");
		await fireEvent.input(input, { target: { value: "missing" } });
		expect(await screen.findByText("Could not look up account: Account not found")).toBeVisible();
		await fireEvent.input(input, { target: { value: "admin-id" } });
		expect(await screen.findByText("Morgan Admin")).toBeVisible();
		await fireEvent.change(screen.getByLabelText("Role", { exact: true }), {
			target: { value: "admin" },
		});
		const panel = screen.getByRole("dialog", { name: "Add relatives" });
		const save = within(panel).getByRole("button", { name: "Add relative", exact: true });
		await waitFor(() => expect(save).toBeEnabled());
		await fireEvent.click(save);
		await waitFor(() =>
			expect(runtime.services.family.addMember).toHaveBeenCalledWith("fam-1", "admin-id", "admin"),
		);
	});

	it("creates a family when no saved family exists", async () => {
		const runtime = makeRuntime();
		vi.mocked(runtime.services.family.getMyFamily).mockResolvedValue(null);
		runtime.services.family.createFamily = vi.fn(async (name: string) => ({
			id: "new-family",
			name,
			description: "Our note",
			createdAt: "2026-01-01T00:00:00Z",
		}));
		render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.dblClick(await screen.findByRole("heading", { name: "Your family" }));
		await fireEvent.input(screen.getByLabelText("Family name"), {
			target: { value: "New family" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Save family name" }));
		await waitFor(() =>
			expect(runtime.services.family.createFamily).toHaveBeenCalledWith("New family"),
		);
		expect(await screen.findByText('Family "New family" created.')).toBeVisible();
	});

	it("rejects non-image files and resets unsaved picture framing", async () => {
		const runtime = makeRuntime();
		runtime.services.family.getFamilyAvatar = vi.fn(async () => ({
			image: new Uint8Array([1]),
			contentType: "image/png",
		}));
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:family"),
			revokeObjectURL: vi.fn(),
		});
		const view = render(TestFamilyProvider, { props: { runtime } });
		await fireEvent.click(await screen.findByRole("button", { name: "Open image crop and fit" }));
		await fireEvent.click(screen.getByRole("button", { name: "Fit", exact: true }));
		await fireEvent.click(screen.getByRole("button", { name: "Crop", exact: true }));
		for (const name of ["Horizontal", "Vertical"]) {
			await fireEvent.input(screen.getByLabelText(name), { target: { value: "65" } });
		}
		await fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
		expect(screen.queryByText(/Picture not saved yet/)).toBeNull();
		const input = view.container.querySelector('input[type="file"]')!;
		await fireEvent.change(input, {
			target: { files: [new File(["text"], "note.txt", { type: "text/plain" })] },
		});
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Please choose an image file.",
		);
	});
});

describe("Family picture persistence", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("opens save controls on selection and reloads the saved picture after remount", async () => {
		const runtime = makeRuntime();
		let stored: { image: Uint8Array; contentType: string } | null = null;
		runtime.services.family.getFamilyAvatar = vi.fn(async () => stored);
		runtime.services.family.setFamilyAvatar = vi.fn(async (image, contentType) => {
			stored = { image, contentType };
		});
		const createObjectURL = vi.fn().mockReturnValueOnce("blob:draft").mockReturnValue("blob:saved");
		vi.stubGlobal(
			"URL",
			class extends URL {
				static createObjectURL = createObjectURL;
				static revokeObjectURL = vi.fn();
			},
		);
		vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (
			this: HTMLImageElement,
		) {
			queueMicrotask(() => this.dispatchEvent(new Event("load")));
		});
		vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
		vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(800);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			clearRect: vi.fn(),
			fillRect: vi.fn(),
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
			callback({
				arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
			} as Blob);
		});
		const view = render(TestFamilyProvider, { props: { runtime } });
		await waitFor(() => expect(runtime.services.family.getFamilyAvatar).toHaveBeenCalled());
		const input = view.container.querySelector('input[type="file"]')!;
		await fireEvent.change(input, {
			target: {
				files: [new File(["demo"], "family.png", { type: "image/png" })],
			},
		});
		expect(await screen.findByRole("button", { name: "Save picture" })).toBeVisible();
		expect(runtime.services.family.setFamilyAvatar).not.toHaveBeenCalled();
		vi.mocked(runtime.services.family.setFamilyAvatar).mockRejectedValueOnce(
			new Error("Storage unavailable"),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Save picture" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Storage unavailable",
		);
		expect(screen.getByText(/Picture not saved yet/)).toBeVisible();
		await fireEvent.click(screen.getByRole("button", { name: "Save picture" }));
		await waitFor(() =>
			expect(runtime.services.family.setFamilyAvatar).toHaveBeenCalledWith(
				new Uint8Array([1, 2, 3]),
				"image/png",
			),
		);
		await waitFor(() => expect(screen.queryByText(/Picture not saved yet/)).toBeNull());
		view.unmount();
		render(TestFamilyProvider, { props: { runtime } });
		await waitFor(() =>
			expect(screen.getByRole("img", { name: "Smith family" })).toHaveAttribute(
				"src",
				"blob:saved",
			),
		);
	});
});

describe("personal family relationships", () => {
	afterEach(cleanup);
	function setup() {
		const runtime = makeRuntime();
		const member = {
			id: "wife-member",
			familyId: "fam-1",
			accountId: "relative",
			role: "member" as const,
			createdAt: "2026-01-01T00:00:00Z",
			relationship: "",
			reciprocalRelationship: "",
		};
		runtime.services.family.listMembers = vi.fn(async () => [member]);
		runtime.services.family.getAccount = vi.fn(async () => ({
			id: "relative",
			displayName: "Alex",
			role: "parent" as const,
		}));
		runtime.services.family.setRelationship = vi.fn(
			async (_family, _account, relationship, reciprocal) => {
				member.relationship = relationship;
				member.reciprocalRelationship = reciprocal;
			},
		);
		render(TestFamilyProvider, { props: { runtime } });
		return runtime;
	}
	it("edits an existing wife/husband pair without changing access roles", async () => {
		const runtime = setup();
		await fireEvent.click(await screen.findByRole("tab", { name: "Manage", exact: true }));
		await fireEvent.click(
			await screen.findByRole("button", {
				name: "Edit relationship with Alex",
			}),
		);
		const dialog = screen.getByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await fireEvent.change(within(dialog).getByLabelText("Their relationship to you"), {
			target: { value: "wife" },
		});
		expect(within(dialog).getByLabelText("Your relationship to them")).toHaveValue("husband");
		await fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
		await waitFor(() =>
			expect(runtime.services.family.setRelationship).toHaveBeenCalledWith(
				"fam-1",
				"relative",
				"wife",
				"husband",
			),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(screen.getByText("Wife", { exact: true })).toBeVisible();
		expect(screen.getByText("member", { exact: true })).toBeVisible();
	});
	it("clears both saved labels without removing the relative", async () => {
		const runtime = setup();
		await fireEvent.click(await screen.findByRole("tab", { name: "Manage", exact: true }));
		const edit = await screen.findByRole("button", {
			name: "Edit relationship with Alex",
		});
		await fireEvent.click(edit);
		let dialog = screen.getByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await fireEvent.change(within(dialog).getByLabelText("Their relationship to you"), {
			target: { value: "wife" },
		});
		await fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await fireEvent.click(screen.getByRole("button", { name: "Edit relationship with Alex" }));
		dialog = screen.getByRole("dialog", { name: "Relationship", exact: true });
		await fireEvent.change(within(dialog).getByLabelText("Their relationship to you"), {
			target: { value: "" },
		});
		expect(within(dialog).getByLabelText("Your relationship to them")).toHaveValue("");
		await fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(runtime.services.family.setRelationship).toHaveBeenLastCalledWith(
			"fam-1",
			"relative",
			"",
			"",
		);
		expect(screen.queryByText("Wife", { exact: true })).not.toBeInTheDocument();
		expect(screen.getByText("Alex", { exact: true })).toBeVisible();
		expect(screen.getByText("member", { exact: true })).toBeVisible();
	});
	it("discards unsaved labels when canceled", async () => {
		const runtime = setup();
		await fireEvent.click(await screen.findByRole("tab", { name: "Manage", exact: true }));
		await fireEvent.click(
			await screen.findByRole("button", {
				name: "Edit relationship with Alex",
			}),
		);
		const dialog = screen.getByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await fireEvent.change(within(dialog).getByLabelText("Their relationship to you"), {
			target: { value: "wife" },
		});
		await fireEvent.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
		expect(runtime.services.family.setRelationship).not.toHaveBeenCalled();
	});
	it("keeps the form editable after a save failure", async () => {
		const runtime = setup();
		runtime.services.family.setRelationship = vi.fn().mockRejectedValue(new Error("Save failed"));
		await fireEvent.click(await screen.findByRole("tab", { name: "Manage", exact: true }));
		await fireEvent.click(
			await screen.findByRole("button", {
				name: "Edit relationship with Alex",
			}),
		);
		const dialog = screen.getByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await fireEvent.change(within(dialog).getByLabelText("Their relationship to you"), {
			target: { value: "wife" },
		});
		await fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Save failed",
		);
		expect(within(dialog).getByLabelText("Their relationship to you")).toHaveValue("wife");
	});
});

it("reports picture rendering failures and saves fit-mode framing", async () => {
	const runtime = makeRuntime();
	runtime.services.family.setFamilyAvatar = vi.fn(async () => {});
	vi.stubGlobal("URL", {
		createObjectURL: vi.fn(() => "blob:draft"),
		revokeObjectURL: vi.fn(),
	});
	const source = vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (
		this: HTMLImageElement,
	) {
		queueMicrotask(() => this.dispatchEvent(new Event("error")));
	});
	const view = render(TestFamilyProvider, { props: { runtime } });
	const input = view.container.querySelector('input[type="file"]')!;
	const select = () =>
		fireEvent.change(input, {
			target: { files: [new File(["demo"], "family.png", { type: "image/png" })] },
		});
	await select();
	await fireEvent.click(await screen.findByRole("button", { name: "Save picture" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Could not load picture.",
	);
	source.mockImplementation(function (this: HTMLImageElement) {
		queueMicrotask(() => this.dispatchEvent(new Event("load")));
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
	await fireEvent.click(screen.getByRole("button", { name: "Save picture" }));
	await waitFor(() =>
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent(
			"Could not prepare picture crop.",
		),
	);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		drawImage: vi.fn(),
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
	await fireEvent.click(screen.getByRole("button", { name: "Save picture" }));
	await waitFor(() =>
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Crop failed."),
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
		callback(new Blob(["image"], { type: "image/png" })),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Fit", exact: true }));
	await fireEvent.click(screen.getByRole("button", { name: "Save picture" }));
	await waitFor(() => expect(runtime.services.family.setFamilyAvatar).toHaveBeenCalledOnce());
});

it("ignores stale account lookup responses after the account id changes", async () => {
	const runtime = makeRuntime();
	let finish!: (account: { id: string; displayName: string; role: "parent" }) => void;
	runtime.services.family.getAccount = vi.fn(async (id: string) => {
		if (id === "new-id") return { id, displayName: "New Account", role: "parent" as const };
		return new Promise<{ id: string; displayName: string; role: "parent" }>((resolve) => {
			finish = resolve;
		});
	});
	render(TestFamilyProvider, { props: { runtime } });
	await fireEvent.click(await screen.findByRole("tab", { name: "Manage" }));
	await fireEvent.click(screen.getByRole("button", { name: "Add relative", exact: true }));
	const input = screen.getByLabelText("Relative account id");
	await fireEvent.input(input, { target: { value: "old-id" } });
	await waitFor(() => expect(runtime.services.family.getAccount).toHaveBeenCalledWith("old-id"));
	await fireEvent.input(input, { target: { value: "new-id" } });
	expect(await screen.findByText("New Account")).toBeVisible();
	finish({ id: "old-id", displayName: "Old Account", role: "parent" });
	await waitFor(() => expect(screen.queryByText("Old Account")).toBeNull());
	expect(screen.getByText("New Account")).toBeVisible();
});
