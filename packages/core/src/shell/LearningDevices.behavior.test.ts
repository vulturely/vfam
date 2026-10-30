import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LearningDevices from "./LearningDevices.svelte";
import { RobotCapabilityValue as Capability } from "../api/protocol";
import type { Dashboard } from "../parent-learning/dashboard";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../parent-learning/dashboard", async (importOriginal) => ({
	...(await importOriginal<typeof import("../parent-learning/dashboard")>()),
	loadDashboard: mocks.load,
}));

const practice = { id: "practice", version: "2" };
const onlineDevice = {
	id: "device",
	displayName: "Kitchen FamBud",
	revoked: false,
	connected: true,
	lastSeenAt: new Date().toISOString(),
	batteryPercent: 80,
	firmware: "1.0",
	capabilities: [Capability.START_QUIZ, Capability.STOP_QUIZ],
};
const liveCommand = {
	commandId: "command",
	target: "device",
	state: "accepted",
	sessionId: "session",
	expiresAt: "later",
};
const dashboard = {
	spelling: [
		{
			practice: { practice },
			title: "Spelling",
			questions: [],
		},
	],
	devices: [onlineDevice],
	commands: [liveCommand],
} as unknown as Dashboard;
const robot = {
	issue: vi.fn(async () => {}),
	dashboard: vi.fn(async () => ({ commands: [liveCommand] })),
	cancel: vi.fn(async () => {}),
	revoke: vi.fn(async () => {}),
};
const services = { robot } as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.load.mockResolvedValue(dashboard);
});

afterEach(cleanup);

it("starts and stops approved spelling quizzes on an online device", async () => {
	mocks.load.mockResolvedValueOnce(dashboard).mockResolvedValue({ ...dashboard, commands: [] });
	render(LearningDevices, { services, profileId: "child" });
	expect(await screen.findByText("Online")).toBeVisible();
	expect(screen.getByText(/Battery: 80%/)).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Stop quiz", exact: true }));
	await waitFor(() => expect(robot.cancel).toHaveBeenCalledWith("command"));
	expect(robot.dashboard).toHaveBeenCalledWith("child");
	const start = screen.getByRole("button", { name: "Start quiz", exact: true });
	await waitFor(() => expect(start).toBeEnabled());
	await fireEvent.click(start);
	await waitFor(() =>
		expect(robot.issue).toHaveBeenCalledWith(
			expect.objectContaining({
				target: "device",
				practiceId: "practice",
				practiceVersion: "2",
			}),
		),
	);
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Quiz queued/));
	await fireEvent.click(screen.getByRole("button", { name: "Refresh devices" }));
	expect(mocks.load).toHaveBeenCalled();
});

it("revokes a device and blocks unsupported or stale controls", async () => {
	render(LearningDevices, { services, profileId: "child" });
	await fireEvent.click(await screen.findByRole("button", { name: "Revoke device" }));
	await waitFor(() => expect(robot.revoke).toHaveBeenCalledWith("device"));
	for (const name of ["Speak prompt", "Camera", "Sensors", "Move", "Fly"]) {
		expect(screen.getByRole("button", { name: `${name} · unsupported` })).toBeDisabled();
	}
	mocks.load.mockResolvedValue({
		...dashboard,
		devices: [
			{
				...onlineDevice,
				lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
				capabilities: [],
			},
		],
		commands: [],
	});
	const refresh = screen.getByRole("button", { name: "Refresh devices" });
	await waitFor(() => expect(refresh).toBeEnabled());
	await fireEvent.click(refresh);
	expect(await screen.findByText(/telemetry stale/)).toBeVisible();
	expect(screen.getByRole("button", { name: "Start quiz", exact: true })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Stop quiz", exact: true })).toBeDisabled();
});

it("fails closed after dashboard errors and shows empty states", async () => {
	mocks.load.mockRejectedValueOnce(new Error("Dashboard offline"));
	render(LearningDevices, { services, profileId: "child" });
	expect(await screen.findByRole("alert")).toHaveTextContent(/Dashboard offline/);
	mocks.load.mockResolvedValue({ spelling: [], devices: [], commands: [] } as unknown as Dashboard);
	await fireEvent.click(screen.getByRole("button", { name: "Refresh devices" }));
	expect(await screen.findByText(/Approve an all-spelling practice set/)).toBeVisible();
	expect(screen.getByText(/No paired devices/)).toBeVisible();
});
