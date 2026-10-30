import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import ParentPinSettings from "./ParentPinSettings.svelte";
afterEach(cleanup);
it("saves matching parent PINs and clears the entered secrets", async () => {
	const setParentPin = vi.fn().mockResolvedValue({ enabled: true });
	const onSave = vi.fn();
	render(ParentPinSettings, {
		auth: {
			getParentPinAccess: vi.fn().mockResolvedValue({ enabled: false }),
			setParentPin,
		} as unknown as OidcAuth,
		initialOpen: true,
		onSave,
	});
	const first = await screen.findByLabelText("New parent PIN");
	await fireEvent.input(first, { target: { value: "123456" } });
	await fireEvent.input(screen.getByLabelText("Confirm parent PIN"), {
		target: { value: "654321" },
	});
	const form = screen.getByRole("button", { name: "Save PIN" }).closest("form")!;
	await fireEvent.submit(form);
	expect(setParentPin).not.toHaveBeenCalled();
	expect(await screen.findByRole("alert")).toHaveTextContent("both PINs match");
	await fireEvent.input(screen.getByLabelText("Confirm parent PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.submit(form);
	expect(setParentPin).toHaveBeenCalledExactlyOnceWith("123456", "");
	await screen.findByRole("button", { name: "Change PIN" });
	expect(screen.queryByLabelText("New parent PIN")).toBeNull();
	expect(onSave).toHaveBeenCalledOnce();
});
it("keeps the form usable after a failed save", async () => {
	render(ParentPinSettings, {
		auth: {
			getParentPinAccess: vi.fn().mockResolvedValue({ enabled: false }),
			setParentPin: vi.fn().mockRejectedValue(new Error("offline")),
		} as unknown as OidcAuth,
		initialOpen: true,
	});
	await fireEvent.input(await screen.findByLabelText("New parent PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.input(screen.getByLabelText("Confirm parent PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Save PIN" }).closest("form")!);
	expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
	expect(screen.getByRole("button", { name: "Save PIN" })).toBeEnabled();
});

async function fill(label: string, value: string) {
	await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

it("asks for the current PIN before changing it and offers the forgotten-PIN reset", async () => {
	const setParentPin = vi
		.fn()
		.mockRejectedValueOnce(new Error("incorrect PIN"))
		.mockResolvedValue({ enabled: true });
	const onForgot = vi.fn();
	render(ParentPinSettings, {
		auth: {
			getParentPinAccess: vi.fn().mockResolvedValue({ enabled: true }),
			setParentPin,
		} as unknown as OidcAuth,
		initialOpen: true,
		onForgot,
	});
	await fireEvent.click(await screen.findByRole("button", { name: "Change PIN" }));
	await fill("New parent PIN", "111111");
	await fill("Confirm parent PIN", "111111");
	const form = screen.getByRole("button", { name: "Save PIN" }).closest("form")!;
	await fireEvent.submit(form);
	expect(await screen.findByRole("alert")).toHaveTextContent("current parent PIN");
	expect(setParentPin).not.toHaveBeenCalled();
	await fill("Current parent PIN", "000000");
	await fireEvent.submit(form);
	expect(await screen.findByText(/Check your current parent PIN/)).toBeVisible();
	expect(screen.getByLabelText("Current parent PIN")).toHaveValue("");
	await fill("Current parent PIN", "482691");
	await fireEvent.submit(form);
	expect(setParentPin).toHaveBeenLastCalledWith("111111", "482691");
	await screen.findByRole("button", { name: "Change PIN" });
	await fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
	await fireEvent.click(screen.getByRole("button", { name: "Forgot PIN? Sign in to reset" }));
	expect(onForgot).toHaveBeenCalledOnce();
	await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.queryByLabelText("Current parent PIN")).toBeNull();
});

it("sets a new PIN without the old one after a reset sign-in", async () => {
	const setParentPin = vi
		.fn()
		.mockRejectedValueOnce(new Error("sign in again"))
		.mockResolvedValue({ enabled: true });
	const onSave = vi.fn();
	render(ParentPinSettings, {
		auth: {
			getParentPinAccess: vi.fn().mockResolvedValue({ enabled: true }),
			setParentPin,
		} as unknown as OidcAuth,
		initialOpen: true,
		resetting: true,
		onSave,
	});
	await screen.findByLabelText("New parent PIN");
	expect(screen.queryByLabelText("Current parent PIN")).toBeNull();
	expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
	await fill("New parent PIN", "222222");
	await fill("Confirm parent PIN", "222222");
	const form = screen.getByRole("button", { name: "Save PIN" }).closest("form")!;
	await fireEvent.submit(form);
	expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
	await fireEvent.submit(form);
	expect(setParentPin).toHaveBeenLastCalledWith("222222", "");
	await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
});
