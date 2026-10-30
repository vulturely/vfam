import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import type { Timetable, CalendarEntry, GetChildPolicyResponse } from "../api/protocol";
export interface TimetableService {
	setTimezone(profileId: string, timezone: string): Promise<Timetable>;
	saveCalendar(profileId: string, entries: CalendarEntry[]): Promise<Timetable>;
	get(profileId: string): Promise<Timetable>;
	save(profileId: string, timetable: Timetable): Promise<Timetable>;
	override(profileId: string, minutes: number, reason: string): Promise<Timetable>;
	policy(activity: "learning" | "chat" | "robot"): Promise<GetChildPolicyResponse>;
}
export function createTimetableService(serverUrl: string, auth: OidcAuth): TimetableService {
	const client = createNativeClient("control", serverUrl);
	async function options(child = false) {
		const token = child ? await auth.getChildAccessToken() : await auth.getAccessToken();
		if (!token)
			throw new Error(
				child ? "Child session expired. Ask a guardian to sign in." : "Guardian sign-in required.",
			);
		return { headers: { authorization: `Bearer ${token}` } };
	}
	function required(value: unknown) {
		const timetable = (value as { timetable?: Timetable }).timetable;
		if (!timetable) throw new Error("Timetable unavailable.");
		return timetable;
	}
	return {
		setTimezone: async (profileId, timezone) =>
			required(await client.setProfileTimezone({ profileId, timezone }, await options())),
		saveCalendar: async (profileId, entries) =>
			required(await client.saveCalendar({ profileId, entries }, await options())),
		get: async (profileId) => required(await client.getTimetable({ profileId }, await options())),
		save: async (profileId, timetable) =>
			required(await client.saveTimetable({ profileId, timetable }, await options())),
		override: async (profileId, minutes, reason) =>
			required(await client.overrideTimetable({ profileId, minutes, reason }, await options())),
		policy: async (activity) =>
			(await client.getChildPolicy({ activity }, await options(true))) as GetChildPolicyResponse,
	};
}
/** Relative server lease, capped and reduced by round-trip time; never trust cached storage. */
export function policyLease(policy: GetChildPolicyResponse, roundTrip: number): number {
	const ttl = Date.parse(policy.validUntil) - Date.parse(policy.evaluatedAt);
	return Number.isFinite(ttl) ? Math.max(0, Math.min(30000, ttl) - roundTrip) : 0;
}
