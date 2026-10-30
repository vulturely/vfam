import type { OidcAuth } from "../auth/oidc";
import { createCacheService, type CacheService } from "../services/storage/cache";
import {
	createServerRepository,
	isServerNetworkError,
	type ServerRepository,
} from "../repositories/server";

export interface FamilyMemberRecord {
	id: string;
	familyId: string;
	accountId: string;
	role: "admin" | "member";
	createdAt: string;
	relationship?: string;
	reciprocalRelationship?: string;
	stale?: boolean;
}

export interface FamilyRecord {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	stale?: boolean;
}

export interface FamilyService {
	createFamily(name: string): Promise<FamilyRecord>;
	getMyFamily(): Promise<FamilyRecord | null>;
	renameFamily(name: string): Promise<FamilyRecord>;
	updateFamilyDescription(description: string): Promise<FamilyRecord>;
	getAccount(accountId: string): Promise<AccountLookup | null>;
	addMember(
		familyId: string,
		accountId: string,
		role: "admin" | "member",
	): Promise<FamilyMemberRecord>;
	listMembers(familyId: string): Promise<FamilyMemberRecord[]>;
	setRelationship(
		familyId: string,
		accountId: string,
		relationship: string,
		reciprocalRelationship: string,
	): Promise<void>;
	setAvatar(image: Uint8Array, contentType: string): Promise<void>;
	getAvatar(accountId: string): Promise<AvatarRecord | null>;
	setFamilyAvatar(image: Uint8Array, contentType: string): Promise<void>;
	getFamilyAvatar(familyId: string): Promise<AvatarRecord | null>;
}

export interface AvatarRecord {
	image: Uint8Array;
	contentType: string;
}

export interface AccountLookup {
	id: string;
	displayName: string;
	role: "parent" | "kid" | "grandparent";
}

interface FamilyDto {
	id: string;
	name: string;
	description: string;
	createdAt: string;
}

interface FamilyResponse {
	family?: FamilyDto;
}

interface MemberDto extends Omit<FamilyMemberRecord, "role"> {
	role: number | string;
}

interface AccountDto {
	id: string;
	displayName: string;
	role: number | string;
}

interface AvatarDto {
	image: string;
	contentType: string;
}

export function createFamilyService(
	serverUrl: string,
	auth: OidcAuth,
	cache: CacheService = createCacheService(serverUrl, auth),
	server: ServerRepository = createServerRepository(serverUrl),
): FamilyService {
	async function token(): Promise<string | undefined> {
		return (await auth.getAccessToken()) ?? undefined;
	}

	function call<T>(
		method: string,
		payload: Record<string, unknown>,
		tokenValue?: string,
	): Promise<T> {
		return server.unary<T>("control", method, payload, { token: tokenValue });
	}

	async function cachedDisplay<T>(key: string, load: () => Promise<T>): Promise<T> {
		const fresh = await cache.get<T>(key).catch(() => null);
		if (fresh !== null) return fresh;
		try {
			const value = await load();
			if (value !== null) await cache.put(key, value).catch(() => {});
			return value;
		} catch (error) {
			if (isServerNetworkError(error)) {
				const stale = await cache.get<T>(key, true).catch(() => null);
				if (stale !== null) return markStale(stale);
			}
			throw error;
		}
	}

	function markStale<T>(value: T): T {
		if (Array.isArray(value)) return value.map((item) => ({ ...item, stale: true })) as T;
		return { ...value, stale: true };
	}

	async function invalidate(): Promise<void> {
		await cache.clear().catch(() => {});
	}

	function familyFromResponse(response: FamilyResponse): FamilyRecord {
		if (!response.family) throw new Error("Server did not return a family.");
		return response.family;
	}

	return {
		async createFamily(name) {
			const response = await call<FamilyResponse>("CreateFamily", { name }, await token());
			await invalidate();
			return familyFromResponse(response);
		},

		async getMyFamily() {
			return cachedDisplay("family:mine", async () => {
				const response = await call<FamilyResponse>("GetMyFamily", {}, await token());
				return response.family ?? null;
			});
		},

		async renameFamily(name) {
			const response = await call<FamilyResponse>("RenameFamily", { name }, await token());
			await invalidate();
			return familyFromResponse(response);
		},

		async updateFamilyDescription(description) {
			const response = await call<FamilyResponse>(
				"UpdateFamilyDescription",
				{ description },
				await token(),
			);
			await invalidate();
			return familyFromResponse(response);
		},

		async getAccount(accountId) {
			const response = await call<{ account?: AccountDto }>(
				"GetAccount",
				{ accountId },
				await token(),
			);
			if (!response.account) return null;
			return {
				id: response.account.id,
				displayName: response.account.displayName,
				role: accountRole(response.account.role),
			};
		},

		async addMember(familyId, accountId, role) {
			const response = await call<{ member?: MemberDto }>(
				"AddFamilyMember",
				{ familyId, accountId, role: role === "admin" ? 1 : 2 },
				await token(),
			);
			if (!response.member) throw new Error("Server did not return a member.");
			await invalidate();
			return memberFromDto(response.member);
		},

		async setRelationship(familyId, accountId, relationship, reciprocalRelationship) {
			await call(
				"SetFamilyRelationship",
				{ familyId, accountId, relationship, reciprocalRelationship },
				await token(),
			);
			await invalidate();
		},

		async listMembers(familyId) {
			return cachedDisplay(`family:${familyId}:members`, async () => {
				const response = await call<{ members: MemberDto[] }>(
					"ListFamilyMembers",
					{ familyId },
					await token(),
				);
				return (response.members ?? []).map(memberFromDto);
			});
		},

		async setAvatar(image, contentType) {
			await call("SetAvatar", { image: encodeBytes(image), contentType }, await token());
		},

		async getAvatar(accountId) {
			const response = await call<AvatarDto>("GetAvatar", { accountId }, await token());
			return avatarFromDto(response);
		},

		async setFamilyAvatar(image, contentType) {
			await call("SetFamilyAvatar", { image: encodeBytes(image), contentType }, await token());
		},

		async getFamilyAvatar(familyId) {
			const response = await call<AvatarDto>("GetFamilyAvatar", { familyId }, await token());
			return avatarFromDto(response);
		},
	};
}

function memberFromDto(member: MemberDto): FamilyMemberRecord {
	return {
		id: member.id,
		familyId: member.familyId,
		accountId: member.accountId,
		role:
			member.role === 1 || member.role === "ADMIN" || member.role === "FAMILY_MEMBER_ROLE_ADMIN"
				? "admin"
				: "member",
		createdAt: member.createdAt,
		relationship: member.relationship,
		reciprocalRelationship: member.reciprocalRelationship,
	};
}

function avatarFromDto(response: AvatarDto): AvatarRecord | null {
	if (!response.image || !response.contentType) return null;
	return { image: decodeBytes(response.image), contentType: response.contentType };
}

function encodeBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBytes(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function accountRole(role: number | string): "parent" | "kid" | "grandparent" {
	switch (role) {
		case 2:
		case "KID":
		case "ACCOUNT_ROLE_KID":
			return "kid";
		case 3:
		case "GRANDPARENT":
		case "ACCOUNT_ROLE_GRANDPARENT":
			return "grandparent";
		default:
			return "parent";
	}
}
