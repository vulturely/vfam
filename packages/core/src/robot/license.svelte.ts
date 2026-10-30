import type { OidcAuth } from "../auth/oidc";
import type { ParentAuth } from "./remote/client";
import type { FamBuddyDirectory } from "./directory.svelte";
import { getFamilyLicense, setFamilyLicense } from "./onboarding/registry";
import { licenseError, type FamBuddyLicense } from "./license";

/** A FamBuddy that did not take the license; the others are not held back by it. */
export interface LicenseInstallFailure {
	id: string;
	name: string;
	message: string;
}

export interface FamilyLicenseRepository {
	get: typeof getFamilyLicense;
	set: typeof setFamilyLicense;
}

type Directory = Pick<
	FamBuddyDirectory,
	"available" | "refresh" | "sessions" | "devices" | "command"
>;

function plural(count: number) {
	return count === 1 ? "1 FamBuddy" : `${count} FamBuddies`;
}

/**
 * The family's FamBuddy license: read and installed on the family server, then sent to
 * every paired FamBuddy, at home and away. The token passes straight through and is
 * never kept, logged, or shown again by this app.
 */
export function createFamBuddyLicenseService(
	serverUrl: string,
	auth: ParentAuth & Partial<Pick<OidcAuth, "watchSessionBoundary">>,
	directory: Directory,
	repository: FamilyLicenseRepository = { get: getFamilyLicense, set: setFamilyLicense },
) {
	const state = $state({
		license: undefined as FamBuddyLicense | undefined,
		loading: false,
		busy: false,
		error: "",
		notice: "",
		failures: [] as LicenseInstallFailure[],
	});
	let generation = 0;

	function reset() {
		generation++;
		state.license = undefined;
		state.loading = false;
		state.busy = false;
		state.error = "";
		state.notice = "";
		state.failures = [];
	}

	async function load() {
		if (!directory.available) return;
		const current = generation;
		state.loading = true;
		state.error = "";
		try {
			const license = await repository.get({ server: serverUrl, auth });
			if (current === generation) state.license = license;
		} catch (cause) {
			if (current === generation)
				state.error = licenseError(cause, "The FamBuddy license could not be read.");
		} finally {
			if (current === generation) state.loading = false;
		}
	}

	/** Sends the token to every device of every paired FamBuddy; returns the failures. */
	async function distribute(token: string) {
		await directory.refresh();
		const sessions = directory.sessions.filter((session) => session.service);
		const outcomes = await Promise.all(
			sessions.map(async (session): Promise<[number, LicenseInstallFailure | undefined]> => {
				const id = session.registration.id;
				const failure = (cause: unknown) => ({
					id,
					name: session.registration.name,
					message: licenseError(cause, "This FamBuddy could not be reached."),
				});
				let devices: string[];
				try {
					devices = await directory.devices(id);
				} catch (cause) {
					return [0, failure(cause)];
				}
				// One device that fails does not keep the license from the others on its hub.
				let installed = 0;
				let failed: LicenseInstallFailure | undefined;
				for (const device of devices) {
					try {
						await directory.command(id, { action: "install_license", device, token });
						installed++;
					} catch (cause) {
						failed ??= failure(cause);
					}
				}
				return [installed, failed];
			}),
		);
		return {
			updated: outcomes.filter(([count]) => count > 0).length,
			failures: outcomes.flatMap(([, failure]) => (failure ? [failure] : [])),
		};
	}

	async function save(token: string, removing: boolean) {
		if (state.busy) return false;
		if (!directory.available) {
			state.error = "FamBuddy licenses need your family server on HTTPS (port 443).";
			return false;
		}
		const current = generation;
		state.busy = true;
		state.error = "";
		state.notice = "";
		state.failures = [];
		try {
			const license = await repository.set({ server: serverUrl, auth }, token);
			if (current !== generation) return false;
			state.license = license;
			const { updated, failures } = await distribute(token);
			if (current !== generation) return false;
			state.failures = failures;
			const done = removing ? "License removed" : "License installed";
			state.notice = updated
				? `${done} for your family and on ${plural(updated)}.`
				: failures.length
					? `${done} for your family.`
					: `${done} for your family. No paired FamBuddy needed it.`;
			return true;
		} catch (cause) {
			if (current === generation) state.error = licenseError(cause);
			return false;
		} finally {
			if (current === generation) state.busy = false;
		}
	}

	auth.watchSessionBoundary?.(reset);

	return {
		get license() {
			return state.license;
		},
		get loading() {
			return state.loading;
		},
		get busy() {
			return state.busy;
		},
		get error() {
			return state.error;
		},
		get notice() {
			return state.notice;
		},
		get failures() {
			return state.failures;
		},
		/** Whether this family server can hold a license (HTTPS on port 443). */
		get available() {
			return directory.available;
		},
		load,
		/** Installs a pasted license key for the family, then on each paired FamBuddy. */
		async install(key: string) {
			const token = key.trim();
			if (!token) {
				state.error = "Paste your FamBuddy license key.";
				return false;
			}
			return save(token, false);
		},
		/** Removes the family's license from the server and every paired FamBuddy. */
		remove() {
			return save("", true);
		},
		/** Installs the pasted key on one FamBuddy, e.g. one paired after the family's install. */
		async installOn(id: string, device: string, key: string) {
			const token = key.trim();
			if (!token) throw new Error("Paste your FamBuddy license key.");
			try {
				await directory.command(id, { action: "install_license", device, token });
			} catch (cause) {
				throw new Error(licenseError(cause, "This FamBuddy could not be reached."), { cause });
			}
		},
		reset,
	};
}

export type FamBuddyLicenseService = ReturnType<typeof createFamBuddyLicenseService>;
