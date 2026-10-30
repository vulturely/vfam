import {
	createAccountSetupService,
	type AccountSetupService,
	type AccountSetupState,
} from "../account/setup";
import FirstSignIn from "../shell/FirstSignIn.svelte";
import { createResourceService, type ResourceService } from "../resources/service";
import { createVoiceService, type VoiceService } from "../voice/service";
import { createCallService, type CallService } from "../calls/service";
import { createRobotService, type RobotService } from "../robot/service";
import { createFamBuddyDirectory, type FamBuddyDirectory } from "../robot/directory.svelte";
import { createFamBuddyLicenseService, type FamBuddyLicenseService } from "../robot/license.svelte";
import { createChatService, type ChatService } from "../chat/service";
import { createChatPeopleService, type ChatPeopleService } from "../chat/people";
import { createChatViewState, type ChatViewState } from "../chat/viewState.svelte";
import { createChildHomeService, type ChildHomeService } from "../child-home/service";
import { createHelpAlertService } from "../help-alerts/service";
import {
	approvalMessage,
	createApprovalWatch,
	type ApprovalWatch,
} from "../robot/approvals.svelte";
import { createApprovalNoticeRepository } from "../repositories/fambuddyApprovals";
import { createHelpAlertRepository } from "../repositories/helpAlerts";
import { toastService } from "../services/toast.svelte";
import FamBuddyScreen from "../shell/FamBuddyScreen.svelte";
import Bot from "lucide-svelte/icons/bot";
import ChatScreen from "../shell/ChatScreen.svelte";
import MessageCircle from "lucide-svelte/icons/message-circle";
import { createTimetableService, type TimetableService } from "../timetable/service";
import { createChildLearningService, type ChildLearningService } from "../child-learning/service";
import { createPracticeService, type PracticeService } from "../practice/service";
import { createFamilyAiService, type FamilyAiService } from "../family-ai/service";
import { createAppLifecycleService, type AppLifecycleService } from "../app/lifecycle";
import { createChildFamilyAiService, type ChildFamilyAiService } from "../family-ai/child";
import { createExtractionService, type ExtractionService } from "../extraction/service";
import { createHomeworkService, type HomeworkService } from "../homework/service";
import type { ChildSessionState } from "../auth/sessionStorage";
import { createLearningApi } from "../api/learning/learningApi";
import { createLearningService, type LearningService } from "../learning/service";
import LearningProfiles from "../shell/LearningProfiles.svelte";
import BookOpen from "lucide-svelte/icons/book-open";
import type { Component, ComponentType } from "svelte";
import type { Role } from "@vulture/data";
import type { Plugin, PluginContext } from "@vulture/plugin-sdk";
import type { AccountService } from "../account/service";
import { createAccountService } from "../account/service";
import { createAccountApi } from "../api/account/accountApi";
import type { OidcAuth } from "../auth/oidc";
import { createOidcAuth } from "../auth/oidc";
import type { FamilyService } from "../family/service";
import { createFamilyService } from "../family/service";
import type { TaskService } from "../tasks/service";
import { createRemoteTaskService } from "../tasks/service";
import { createCacheService, type CacheService } from "../services/storage/cache";
import { createLocalStateService, type LocalStateService } from "../services/storage/localState";
import House from "lucide-svelte/icons/house";
import Baby from "lucide-svelte/icons/baby";
import HeartHandshake from "lucide-svelte/icons/heart-handshake";
import Users from "lucide-svelte/icons/users";
import UserRound from "lucide-svelte/icons/user-round";
import RoleHome from "../shell/RoleHome.svelte";
import FamilyScreen from "../shell/FamilyScreen.svelte";
import FamilyOnboarding from "../shell/FamilyOnboarding.svelte";
import ProfileChooser from "../shell/ProfileChooser.svelte";
import ProfileScreen from "../shell/ProfileScreen.svelte";
import type { AppConfig } from "./defineApp";
import { createBus } from "./bus";
import { createRouter } from "./router.svelte";
import { SvelteMap } from "svelte/reactivity";

/** A sidebar entry, resolved from a plugin ScreenDef.nav at assembly time. */
export interface NavEntry {
	id: string;
	label: string;
	icon?: ComponentType;
	roles?: Role[];
	order: number;
}

export interface Runtime {
	config: AppConfig;
	bus: ReturnType<typeof createBus>;
	router: ReturnType<typeof createRouter>;
	state: {
		identity: import("@vulture/data").Person | null;
		accountSetup: AccountSetupState | null;
		familyId: string | null;
		childSession: ChildSessionState | null;
		sessionError: string;
		restoring: boolean;
		/** A parent PIN must be entered before parent screens open. */
		parentLocked: boolean;
		/** Signed in from "Forgot PIN?"; the parent must set a new PIN. */
		parentPinReset: boolean;
	};
	hasIdentity: boolean;
	/** screen id → component, flattened from all plugin ScreenDefs. */
	screens: Map<string, Component>;
	navItems: NavEntry[];
	services: {
		accounts: AccountService;
		accountSetup: AccountSetupService;
		auth: OidcAuth;
		cache: CacheService;
		family: FamilyService;
		tasks: TaskService;
		learning: LearningService;
		homework: HomeworkService;
		extraction: ExtractionService;
		practice: PracticeService;
		familyAi: FamilyAiService;
		lifecycle: AppLifecycleService;
		childFamilyAi: ChildFamilyAiService;
		childLearning: ChildLearningService;
		voice: VoiceService;
		resources: ResourceService;
		timetable: TimetableService;
		robot: RobotService;
		fambuddy: FamBuddyDirectory;
		/** The family's FamBuddy license; parents only. */
		fambuddyLicense: FamBuddyLicenseService;
		approvals: ApprovalWatch;
		chat: ChatService;
		chatPeople: ChatPeopleService;
		/** The chat screen's state, kept while the session lasts. */
		chatView: ChatViewState;
		childHome: ChildHomeService;
		calls: CallService;
	};
	/**
	 * Services registered by plugins via `plugin.setup`. Keyed by plugin id,
	 * then by the service key the plugin chose. Core screens consume these so
	 * feature behavior stays plugin-owned (e.g. the identity plugin registers
	 * a profile-avatar service that ProfileScreen uses).
	 */
	pluginServices: Record<string, Record<string, unknown>>;
	theme: {
		mode: "light" | "dark";
		toggle: () => void;
	};
	canAccessScreen: (screen: string) => boolean;
	homeScreenForCurrentRole: () => string;
	logout: () => void;
	/** Restore a previously stored OIDC session on app load. */
	restoreSession: () => Promise<void>;
	/** Enters the parent PIN on a shared device; parent screens stay locked until then. */
	unlockParentProfile: (pin: string) => Promise<void>;
	/** Signs in again so a parent who forgot the PIN can set a new one. */
	forgotParentPin: () => Promise<void>;
	/** A new parent PIN was saved for this session; parent screens open. */
	parentPinSaved: () => void;
	refreshChildSession: () => Promise<void>;
	completeOnboarding: (person: import("@vulture/data").Person, screen?: string) => void;
}

/**
 * Assemble one app from its AppConfig: flatten the screen registry, build nav,
 * construct each plugin's context, and run plugin `setup` hooks. Identity
 * starts null — the shell shows Onboarding until `completeOnboarding` runs
 * (mocked in M2, backed by the Rust identity commands in M3).
 */
export function createAppRuntime(
	config: AppConfig,
	localState: LocalStateService = createLocalStateService(),
): Runtime {
	const bus = createBus();
	const router = createRouter(defaultScreen());

	const state = $state<{
		identity: import("@vulture/data").Person | null;
		accountSetup: AccountSetupState | null;
		familyId: string | null;
		childSession: ChildSessionState | null;
		sessionError: string;
		restoring: boolean;
		/** A parent PIN must be entered before parent screens open. */
		parentLocked: boolean;
		parentPinReset: boolean;
	}>({
		identity: null,
		accountSetup: null,
		familyId: null,
		childSession: null,
		sessionError: "",
		restoring: true,
		parentLocked: false,
		parentPinReset: false,
	});
	const theme = $state<{ mode: "light" | "dark" }>({ mode: "light" });
	void localState
		.read<string>(THEME_STORAGE_KEY)
		.then((mode) => {
			if (mode === "dark") theme.mode = "dark";
		})
		.catch(() => {});
	const hasIdentity = $derived(state.identity !== null);

	$effect(() => {
		if (typeof document !== "undefined") {
			document.documentElement.dataset.vTheme = theme.mode;
		}
	});

	const screens = new SvelteMap<string, Component>([
		["home:parent", RoleHome],
		["home:kid", RoleHome],
		["home:grandparent", RoleHome],
		["family:manage", FamilyScreen],
		["family:setup", FamilyOnboarding],
		["profile:choose", ProfileChooser],
		["account:setup", FirstSignIn],
		["profile", ProfileScreen],
		["learning:profiles", LearningProfiles],
		["chat", ChatScreen],
		["fambuddy", FamBuddyScreen],
		["calls", ChatScreen],
	]);
	const navItems: NavEntry[] = [
		{
			id: "fambuddy",
			label: "FamBuddy",
			icon: Bot,
			roles: ["manager"],
			order: 4,
		},
		{ id: "chat", label: "Chat & calls", icon: MessageCircle, order: 3 },
		{
			id: "home:parent",
			label: "Parent home",
			icon: House,
			roles: ["manager"],
			order: 0,
		},
		{
			id: "home:kid",
			label: "Kid home",
			icon: Baby,
			roles: ["kid"],
			order: 0,
		},
		{
			id: "home:grandparent",
			label: "Grandparent home",
			icon: HeartHandshake,
			roles: ["elder"],
			order: 0,
		},
		{
			id: "family:manage",
			label: "Family",
			icon: Users,
			roles: ["manager"],
			order: 1,
		},
		{
			id: "learning:profiles",
			label: "Learning",
			icon: BookOpen,
			roles: ["manager"],
			order: 2,
		},
		{
			id: "profile",
			label: "Profile",
			icon: UserRound,
			order: 2,
		},
	];
	const auth = createOidcAuth(config.oidc, config.serverUrl, localState);
	const cache = createCacheService(config.serverUrl, auth);
	const family = createFamilyService(config.serverUrl, auth, cache);
	const familyAi = createFamilyAiService(
		config.serverUrl,
		auth,
		async () => (await family.getMyFamily())?.id ?? null,
	);
	const childHome = createChildHomeService(config.serverUrl, auth);
	const learning = createLearningService(createLearningApi(config.serverUrl, auth), family);
	const fambuddy = createFamBuddyDirectory(
		config.serverUrl,
		auth,
		() => state.identity?.id,
		familyAi,
	);
	const approvalNotices = createApprovalNoticeRepository();
	const services = {
		childHome,
		chatView: createChatViewState(),
		chatPeople: createChatPeopleService({
			child: () => (state.childSession?.status === "active" ? state.childSession : null),
			parent: () =>
				state.identity
					? { id: state.identity.id, name: state.identity.name, role: state.identity.role }
					: null,
			family,
			learning,
			childHome,
		}),
		accountSetup: createAccountSetupService(config.serverUrl, auth),
		chat: createChatService(config.serverUrl, auth),
		calls: createCallService(config.serverUrl, auth),
		robot: createRobotService(config.serverUrl, auth),
		fambuddy,
		fambuddyLicense: createFamBuddyLicenseService(config.serverUrl, auth, fambuddy),
		timetable: createTimetableService(config.serverUrl, auth),
		childLearning: createChildLearningService(config.serverUrl, auth),
		voice: createVoiceService(config.serverUrl, auth),
		resources: createResourceService(config.serverUrl, auth),
		practice: createPracticeService(config.serverUrl, auth, familyAi),
		familyAi,
		lifecycle: createAppLifecycleService(),
		childFamilyAi: createChildFamilyAiService(config.serverUrl, auth, () =>
			state.childSession?.status === "active" ? { familyId: state.childSession.familyId } : null,
		),
		extraction: createExtractionService(config.serverUrl, auth),
		homework: createHomeworkService(config.serverUrl, auth, familyAi),
		learning,
		accounts: createAccountService(createAccountApi(config.serverUrl), auth),
		auth,
		cache,
		family,
		tasks: createRemoteTaskService(config.serverUrl, auth, cache),
		// Every paired FamBuddy is watched while a parent is signed in, so a waiting
		// approval is announced at once, even with VFAM in the background.
		approvals: createApprovalWatch(
			fambuddy,
			(notice) => {
				const message = approvalMessage(notice);
				void approvalNotices.show(message.title, message.body).catch(() => {});
				toastService.info(`${message.title}. ${message.body}`, {
					label: "Open",
					run: () => {
						void fambuddy.acknowledge(notice.id, notice.turn).catch(() => {});
						router.navigate("chat", { buddy: notice.id });
					},
				});
			},
			() => state.identity !== null && state.childSession?.status !== "active",
			approvalNotices,
		),
		// The native app listens for help requests whenever a guardian is signed in.
		helpAlerts: createHelpAlertService(createHelpAlertRepository(), (notice) =>
			toastService.info(`${notice.title}. ${notice.body}`, {
				label: "Open",
				run: () => {
					if (canAccessScreen(notice.screen)) router.navigate(notice.screen);
				},
			}),
		),
	};
	void services.helpAlerts.start();
	void services.approvals.start();

	for (const plugin of config.plugins) {
		for (const screen of plugin.screens) {
			screens.set(screen.id, screen.component);
			if (screen.nav) {
				navItems.push({
					id: screen.nav.id,
					label: screen.nav.label,
					icon: screen.nav.icon,
					roles: screen.nav.roles ?? plugin.roles,
					order: screen.nav.order ?? 100,
				});
			}
		}
	}
	navItems.sort((a, b) => a.order - b.order);

	const pluginServices = new SvelteMap<string, Record<string, unknown>>();

	function createContext(plugin: Plugin): PluginContext {
		const pluginServicesFor = pluginServices.get(plugin.id) ?? {};
		pluginServices.set(plugin.id, pluginServicesFor);
		// Plugin setup may register typed services here. Screens should consume
		// services, not API or IPC clients.

		return {
			pluginId: plugin.id,
			services: pluginServicesFor,
			navigate: (screen: string, params?: Record<string, string>) =>
				router.navigate(screen, params),
			get role() {
				return state.identity?.role ?? "manager";
			},
			get familyId() {
				return state.familyId;
			},
			permissions: [],
			subscribe: bus.subscribe,
			// Hand the core family service to plugins so they can wrap/extend it
			// (`FamilyService.setAvatar`/`getAvatar` match `PluginFamilyService`).
			family: services.family,
		};
	}

	for (const plugin of config.plugins) {
		plugin.setup?.(createContext(plugin));
	}

	function logout() {
		state.parentLocked = false;
		state.parentPinReset = false;
		services.chat.disconnect();
		services.chatView.reset();
		services.calls.close();
		state.identity = null;
		state.accountSetup = null;
		state.familyId = null;
		state.sessionError = "";
		void services.cache
			.clear()
			.catch(() => {})
			.then(() =>
				services.auth.signOut().catch(() => {
					state.sessionError =
						"Could not end the session. Please check your connection and try again.";
				}),
			);
	}

	// Chat connects as soon as a session is ready, so it is quick to open and stays live.
	function connectChat() {
		void services.chat.connect().catch(() => {});
	}

	async function refreshChildSession() {
		const child = await services.auth.getChildSession();
		if (child) {
			state.identity = null;
			state.familyId = null;
			state.childSession = child;
		}
	}
	async function restoreSession() {
		state.restoring = true;
		state.sessionError = "";
		try {
			const child = await services.auth.getChildSession();
			if (child) {
				state.identity = null;
				state.familyId = null;
				state.childSession = child;
				if (child.status === "active") connectChat();
				return;
			}
			const session = await services.auth.getUser();
			if (session) {
				state.accountSetup = await services.accountSetup.get();
				if (state.accountSetup.role === "kid") {
					session.person.role = "kid";
					session.landingScreen = "home:kid";
				} else if (state.accountSetup.role === "grandparent") {
					session.person.role = "elder";
					session.landingScreen = "home:grandparent";
				}
				const requestedRoute = router.current;
				state.parentLocked =
					session.person.role === "manager" && (await services.auth.parentPinLocked());
				state.parentPinReset = state.parentLocked && (await services.auth.parentPinResetPending());
				if (state.parentLocked) session.landingScreen = "profile:choose";
				state.identity = session.person;
				// Also while the PIN is locked: a guardian at this device still hears help requests.
				connectChat();
				const canRestoreRequestedRoute =
					screens.has(requestedRoute.screen) && canAccessScreen(requestedRoute.screen);
				completeOnboarding(
					session.person,
					canRestoreRequestedRoute ? requestedRoute.screen : session.landingScreen,
					canRestoreRequestedRoute ? requestedRoute.params : {},
				);
			}
		} catch {
			state.identity = null;
			state.familyId = null;
			state.sessionError =
				"Could not verify your session. Check your connection and reload to try again.";
		} finally {
			state.restoring = false;
		}
	}

	function toggleTheme() {
		theme.mode = theme.mode === "light" ? "dark" : "light";
		void localState.put(THEME_STORAGE_KEY, theme.mode).catch(() => {});
	}

	function canAccessScreen(screen: string): boolean {
		const role = state.identity?.role;
		if (!role) return false;
		if (needsAccountSetup()) return screen === "account:setup";
		if (screen === "account:setup") return role === "manager";
		if (state.parentLocked && role === "manager") return screen === "profile:choose";
		if (screen === "profile:choose" || screen === "family:setup") return role === "manager";
		const navItem = navItems.find((item) => item.id === screen);
		if (!navItem?.roles?.length) return true;
		return navItem.roles.includes(role);
	}

	function needsAccountSetup(): boolean {
		return !!state.accountSetup && !state.accountSetup.completed;
	}

	function homeScreenForCurrentRole(): string {
		if (needsAccountSetup()) return "account:setup";
		if (state.parentLocked) return "profile:choose";
		return roleHomeScreen(state.identity?.role ?? "manager");
	}

	function completeOnboarding(
		person: import("@vulture/data").Person,
		screen = roleHomeScreen(person.role),
		params: Record<string, string> = {},
	) {
		state.identity = person;
		state.familyId = person.familyId;
		router.navigate(needsAccountSetup() ? "account:setup" : screen, params);
	}

	return {
		config,
		bus,
		router,
		state,
		get hasIdentity() {
			return hasIdentity;
		},
		screens,
		navItems,
		services,
		// Convert the plugin service map to a plain object so core screens can
		// look up a typed, plugin-registered service (e.g. the identity plugin's
		// avatar service) by plugin id.
		pluginServices: Object.fromEntries(pluginServices),
		theme: {
			get mode() {
				return theme.mode;
			},
			toggle: toggleTheme,
		},
		canAccessScreen,
		homeScreenForCurrentRole,
		logout,
		restoreSession,
		async unlockParentProfile(pin: string) {
			await services.auth.verifyParentPin(pin);
			state.parentLocked = false;
			connectChat();
		},
		async forgotParentPin() {
			await services.auth.signIn({ resetParentPin: true });
			if (services.auth.isNative()) await restoreSession();
		},
		parentPinSaved() {
			state.parentLocked = false;
			state.parentPinReset = false;
			connectChat();
		},
		refreshChildSession,
		completeOnboarding,
	};
}

function defaultScreen(): string {
	return "profile:choose";
}

function roleHomeScreen(role: Role): string {
	switch (role) {
		case "kid":
			return "home:kid";
		case "elder":
			return "home:grandparent";
		default:
			return "home:parent";
	}
}

const THEME_STORAGE_KEY = "vulture.theme";
