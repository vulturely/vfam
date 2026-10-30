import {
	createAppLifecycleRepository,
	type AppLifecycleRepository,
} from "../repositories/appLifecycle";

export interface AppLifecycleService {
	/** Only the desktop app can quit itself; browsers keep their own window controls. */
	canExit(): boolean;
	/** Quits the desktop app without signing out. */
	exit(): Promise<void>;
}

export function createAppLifecycleService(
	repository: AppLifecycleRepository = createAppLifecycleRepository(),
): AppLifecycleService {
	return {
		canExit: () => repository.isDesktop(),
		async exit() {
			if (repository.isDesktop()) await repository.exit();
		},
	};
}
