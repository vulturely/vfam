export { defineApp } from "./runtime/defineApp";
export type { AppConfig, Profile } from "./runtime/defineApp";
export { createAppRuntime } from "./runtime/registry.svelte";
export type { NavEntry, Runtime } from "./runtime/registry.svelte";
export { createOidcAuth } from "./auth/oidc";
export type { OidcAuth, OidcConfig } from "./auth/oidc";
export { createFamilyService } from "./family/service";
export type {
	AvatarRecord,
	FamilyMemberRecord,
	FamilyRecord,
	FamilyService,
} from "./family/service";
export type { IdentityService } from "./identity/service";
export { createRemoteTaskService, createTaskService } from "./tasks/service";
export type { TaskRecord, TaskService, TaskStatus, TaskRepeat } from "./tasks/service";
export { createAccountService } from "./account/service";
export type { AccountService } from "./account/service";
export type {
	AccountFormInput,
	AccountRecord,
	AccountRole,
	AuthMode,
	RoleOption,
	SignedInAccount,
} from "./account/types";
export { ROLE_OPTIONS, roleOptionFor } from "./account/types";
export { default as VultureApp } from "./shell/VultureApp.svelte";
export { PRESETS } from "./theme/presets";
export { FEATURE_SETS } from "./theme/features";
export type { FeatureHighlight } from "./theme/features";
export { Badge, Button, Card, ErrorToast, IconButton, Input, ToastStack } from "./components/index";
export { default as AppIcon } from "./components/display/AppIcon.svelte";
export type { AccountApi, IpcArgs, IpcClient, PluginCommandApi } from "./api";
export { createAccountApi, createPluginCommandApi, createTauriIpcClient } from "./api";

export { createRobotService } from "./robot/service";
export type { RobotService } from "./robot/service";
