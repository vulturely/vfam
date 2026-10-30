import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import { Task, TaskStatus } from "../api/protocol";
import { createChildHomeService } from "./service";
const client = vi.hoisted(() => ({
	listChildTasks: vi.fn(),
	markChildTaskStatus: vi.fn(),
	listChildFamily: vi.fn(),
	getProfileAvatar: vi.fn(),
	setProfileAvatar: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getChildAccessToken = vi.fn();
const service = () =>
	createChildHomeService("https://server.invalid", { getChildAccessToken } as unknown as OidcAuth);
const options = { headers: { authorization: "Bearer child" } };
beforeEach(() => {
	vi.resetAllMocks();
	getChildAccessToken.mockResolvedValue("child");
});

it("lists and updates the child's tasks with the child token", async () => {
	const task = new Task({ id: "t", title: "Tidy" });
	client.listChildTasks.mockResolvedValueOnce({ tasks: [task] }).mockResolvedValueOnce({});
	client.markChildTaskStatus.mockResolvedValueOnce({ task }).mockResolvedValueOnce({});
	const api = service();
	expect(await api.tasks()).toEqual([task]);
	expect(await api.tasks()).toEqual([]);
	expect(await api.markTask("t", TaskStatus.IN_PROGRESS)).toBe(task);
	await expect(api.markTask("t", TaskStatus.IN_REVIEW)).rejects.toThrow("did not return");
	expect(client.listChildTasks).toHaveBeenCalledWith({}, options);
	expect(client.markChildTaskStatus).toHaveBeenCalledWith(
		{ taskId: "t", status: TaskStatus.IN_PROGRESS },
		options,
	);
});

it("maps family members and handles pictures", async () => {
	client.listChildFamily
		.mockResolvedValueOnce({
			members: [{ participantId: "mum", displayName: "Mum", guardian: true }, {}],
		})
		.mockResolvedValueOnce({});
	const api = service();
	expect(await api.family()).toEqual([
		{ participantId: "mum", displayName: "Mum", child: false, guardian: true },
		{ participantId: "", displayName: "", child: false, guardian: false },
	]);
	expect(await api.family()).toEqual([]);
	client.getProfileAvatar
		.mockResolvedValueOnce({ image: new Uint8Array([1]), contentType: "image/png" })
		.mockResolvedValueOnce({ image: new Uint8Array(), contentType: "" });
	expect(await api.avatar("p")).toEqual({ image: new Uint8Array([1]), contentType: "image/png" });
	expect(await api.avatar("p")).toBeNull();
	expect(client.getProfileAvatar).toHaveBeenCalledWith({ profileId: "p" }, options);
	await api.setAvatar({ image: new Uint8Array([2]), contentType: "image/webp" });
	await api.setAvatar();
	expect(client.setProfileAvatar).toHaveBeenNthCalledWith(
		1,
		{ image: new Uint8Array([2]), contentType: "image/webp" },
		options,
	);
	expect(client.setProfileAvatar).toHaveBeenNthCalledWith(
		2,
		{ image: new Uint8Array(), contentType: "" },
		options,
	);
});

it("requires a child session", async () => {
	getChildAccessToken.mockResolvedValue(null);
	await expect(service().tasks()).rejects.toThrow("Child session expired");
	expect(client.listChildTasks).not.toHaveBeenCalled();
});
