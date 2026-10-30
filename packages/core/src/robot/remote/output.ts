import {
	BUDDY_STAGES,
	type BuddyAiMode,
	type BuddyOutput,
	type BuddySettings,
	type BuddyUpdateState,
} from "../buddy";
import type { FamBuddyLicenseState } from "../license";

type RemoteVoice = { speaker?: unknown; name?: unknown; role?: unknown };
type RemoteLicense = {
	state?: unknown;
	edition?: unknown;
	features?: unknown;
	expires_at?: unknown;
};

const licenseStates: readonly FamBuddyLicenseState[] = ["none", "valid", "expired"];
const aiModes: readonly BuddyAiMode[] = ["local_only", "local_first", "cloud_only"];
const updateStates: readonly BuddyUpdateState[] = ["current", "available", "installing", "failed"];

type RemoteUpdates = {
	automatic?: unknown;
	installed?: unknown;
	available?: unknown;
	state?: unknown;
	requested?: unknown;
};

/** The hub's JSON nests update status as `updates`; the app's settings keep it flat. */
function remoteUpdates(value: RemoteUpdates | undefined): Partial<BuddySettings> {
	if (!value || typeof value !== "object") return {};
	return {
		auto_update: value.automatic === true,
		installed_version: typeof value.installed === "string" ? value.installed : "",
		available_version: typeof value.available === "string" ? value.available : "",
		update_state: updateStates.find((item) => item === value.state) ?? "unknown",
		update_requested: value.requested === true,
	};
}

/** The hub's JSON license: snake_case states and a null end for a license without one. */
function remoteLicense(value: RemoteLicense | undefined) {
	if (!value || typeof value !== "object") return undefined;
	const state = licenseStates.find((item) => item === value.state) ?? "unknown";
	return {
		state,
		edition: typeof value.edition === "string" ? value.edition : "",
		features: Array.isArray(value.features) ? value.features.map(String) : [],
		expires_at: typeof value.expires_at === "string" ? value.expires_at : "",
	};
}

/**
 * The hub's relay replies use its JSON names: voices arrive as `voice_labels`, and an
 * unlabelled voice's role is `unspecified`. Anyone not known to be a parent is a child.
 * Settings carry `ai_mode` in snake_case ("local_only") and `local_ai`; stages use the
 * hub's names ("NeedsParent").
 */
export function remoteOutput(output: BuddyOutput & { voice_labels?: RemoteVoice[] }): BuddyOutput {
	const { voice_labels: labels, ...rest } = output;
	const settings = (rest.settings ?? []).map((value) => {
		const { license, updates, ...rest } = value as BuddySettings & {
			license?: RemoteLicense;
			updates?: RemoteUpdates;
		};
		const item: BuddySettings = {
			...rest,
			...remoteUpdates(updates),
			ai_mode: aiModes.find((mode) => mode === rest.ai_mode) ?? "unknown",
			local_ai: rest.local_ai === true,
		};
		const read = remoteLicense(license);
		return read ? { ...item, license: read } : item;
	});
	// A stage from a newer FamBuddy (its JSON names, e.g. "NeedsParent") is left out.
	const turns = (rest.turns ?? []).filter((turn) => BUDDY_STAGES.includes(turn.stage));
	if (!labels) return { ...rest, settings, turns };
	return {
		...rest,
		settings,
		turns,
		voices: labels.map((voice) => ({
			speaker: String(voice.speaker ?? ""),
			name: String(voice.name ?? ""),
			role: voice.role === "parent" ? "parent" : "child",
		})),
	};
}
