import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { NativeServerError } from "../repositories/server";
import BuddyLicense from "./BuddyLicense.svelte";
import { createFamBuddyLicenseService } from "./license.svelte";
import type { FamBuddyLicense } from "./license";

vi.mock("./onboarding/registry", () => ({ getFamilyLicense: vi.fn(), setFamilyLicense: vi.fn() }));

const valid: FamBuddyLicense = {
	state: "valid",
	edition: "Family",
	features: ["fambuddy.live_camera", "fambuddy.remote_access"],
	expires_at: "",
};

function setup(
	license?: FamBuddyLicense,
	available = true,
	command = vi.fn(async () => ({ settings: [], turns: [] })),
) {
	const repository = {
		get: vi.fn(
			async () =>
				license ?? { state: "unknown" as const, edition: "", features: [], expires_at: "" },
		),
		set: vi.fn(),
	};
	const directory = {
		available,
		refresh: vi.fn(async () => {}),
		sessions: [
			{
				registration: { id: "kitchen", name: "Kitchen", createdAt: "" },
				service: {},
				output: { settings: [], turns: [] },
				busy: false,
				error: "",
			},
		],
		devices: vi.fn(async () => ["device"]),
		command,
	};
	const service = createFamBuddyLicenseService(
		"https://family.example",
		{ getAccessToken: async () => "token" },
		directory as never,
		repository,
	);
	render(BuddyLicense, { props: { service } });
	return { repository, command };
}

afterEach(() => cleanup());

it("shows the family's license and which paid features it unlocks", async () => {
	setup(valid);
	const status = await screen.findByRole("status", { name: "Family license" });
	await vi.waitFor(() => expect(status.textContent).toContain("Active"));
	expect(status.textContent).toContain("Family edition");
	const features = screen.getByRole("list", { name: "Paid features" });
	expect(
		Array.from(features.querySelectorAll("li"), (item) =>
			item.textContent?.replace(/\s+/g, " ").trim(),
		),
	).toEqual([
		"On-device AI Off",
		"Away-from-home access On",
		"Server alerts & email Off",
		"Live camera On",
	]);
	expect(screen.getByRole("button", { name: "Remove license" })).toBeTruthy();
});

it("installs a pasted key, clears it, and lists FamBuddies that failed", async () => {
	const command = vi.fn(async () => {
		throw new Error("Device did not confirm.");
	});
	const { repository } = setup(
		{ state: "none", edition: "", features: [], expires_at: "" },
		true,
		command,
	);
	await vi.waitFor(() => expect(screen.getByText("No license")).toBeTruthy());
	expect(screen.queryByRole("button", { name: "Remove license" })).toBeNull();
	const field = screen.getByLabelText("License key") as HTMLInputElement;
	expect(field.type).toBe("password");
	expect((screen.getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	repository.set.mockResolvedValue(valid);
	await fireEvent.input(field, { target: { value: "sap-token" } });
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	await vi.waitFor(() => expect(field.value).toBe(""));
	expect(repository.set).toHaveBeenCalledWith(expect.anything(), "sap-token");
	expect(screen.getByText("License installed for your family.")).toBeTruthy();
	expect(screen.getByRole("alert").textContent).toContain("Kitchen: Device did not confirm.");

	repository.set.mockResolvedValue({ state: "none", edition: "", features: [], expires_at: "" });
	command.mockResolvedValue({ settings: [], turns: [] } as never);
	await fireEvent.click(screen.getByRole("button", { name: "Remove license" }));
	await vi.waitFor(() =>
		expect(screen.getByText("License removed for your family and on 1 FamBuddy.")).toBeTruthy(),
	);
	expect(repository.set).toHaveBeenLastCalledWith(expect.anything(), "");
});

it("keeps the key and explains a refusal", async () => {
	const { repository } = setup();
	repository.set.mockRejectedValue(new NativeServerError("already_exists", "raw"));
	const field = screen.getByLabelText("License key") as HTMLInputElement;
	await fireEvent.input(field, { target: { value: "sap-token" } });
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	await vi.waitFor(() =>
		expect(
			screen.getByText("This FamBuddy license is already used by another family."),
		).toBeTruthy(),
	);
	expect(field.value).toBe("sap-token");
});

it("explains that licenses need the family server on HTTPS", () => {
	const { repository } = setup(undefined, false);
	expect(screen.getByText(/need your family server on HTTPS/)).toBeTruthy();
	expect(screen.queryByLabelText("License key")).toBeNull();
	expect(repository.get).not.toHaveBeenCalled();
});
