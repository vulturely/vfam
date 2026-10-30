import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import type { FamBudCommand, FamBudDevice } from "../api/protocol";

export interface RobotService {
	pairing(profileId: string): Promise<{ token: string; expiresAt: string }>;
	list(profileId: string): Promise<FamBudDevice[]>;
	dashboard(profileId: string): Promise<{ devices: FamBudDevice[]; commands: FamBudCommand[] }>;
	revoke(deviceId: string): Promise<void>;
	issue(input: {
		commandId: string;
		target: string;
		nonce: string;
		expiresAt: string;
		practiceId: string;
		practiceVersion: number;
	}): Promise<FamBudCommand>;
	cancel(commandId: string): Promise<void>;
}
/** Parent-only typed service. Device credentials never enter browser storage. */
export function createRobotService(serverUrl: string, auth: OidcAuth): RobotService {
	const client = createNativeClient("robot", serverUrl);
	async function options() {
		const token = await auth.getAccessToken();
		if (!token) throw new Error("Guardian sign-in required.");
		return { headers: { authorization: `Bearer ${token}` } };
	}
	return {
		pairing: async (profileId) =>
			(await client.createRobotPairing({ profileId }, await options())) as {
				token: string;
				expiresAt: string;
			},
		list: async (profileId) =>
			((await client.listRobots({ profileId }, await options())) as { devices: FamBudDevice[] })
				.devices,
		dashboard: async (profileId) =>
			(await client.listRobots({ profileId }, await options())) as {
				devices: FamBudDevice[];
				commands: FamBudCommand[];
			},
		revoke: async (deviceId) => {
			await client.revokeRobot({ deviceId }, await options());
		},
		issue: async (input) => {
			const response = (await client.issueRobotCommand(input, await options())) as {
				command?: FamBudCommand;
			};
			if (!response.command) throw new Error("Robot command unavailable.");
			return response.command;
		},
		cancel: async (commandId) => {
			await client.cancelRobotCommand({ commandId }, await options());
		},
	};
}
