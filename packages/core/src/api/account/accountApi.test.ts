import { expect, it, vi } from "vitest";
import { createAccountApi } from "./accountApi";
import { AccountRole } from "../protocol";

const client = vi.hoisted(() => ({ createAccount: vi.fn() }));
vi.mock("../../repositories/nativeClient", () => ({ createNativeClient: () => client }));

it("creates accounts through the native control service", async () => {
	client.createAccount.mockResolvedValue({
		account: {
			id: "account",
			displayName: "Alex",
			role: AccountRole.PARENT,
			email: "alex@example.com",
			createdAt: "created",
			updatedAt: "updated",
		},
	});
	const api = createAccountApi("https://server.example");
	await expect(
		api.createAccount({
			displayName: " Alex ",
			email: "ALEX@example.COM",
			role: "parent",
		}),
	).resolves.toEqual({
		id: "account",
		displayName: "Alex",
		role: "parent",
		email: "alex@example.com",
		createdAt: "created",
		updatedAt: "updated",
	});
	expect(client.createAccount).toHaveBeenCalledWith({
		displayName: "Alex",
		email: "alex@example.com",
		role: AccountRole.PARENT,
	});
});

it("rejects missing account responses", async () => {
	client.createAccount.mockResolvedValue({});
	const api = createAccountApi("https://server.example");
	await expect(api.createAccount({ displayName: "Alex", role: "kid" })).rejects.toThrow(
		"Server did not return an account.",
	);
});
