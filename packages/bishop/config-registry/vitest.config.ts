import { defineConfig } from "vitest/config";

// Self-contained test config so the package runs its own suite in isolation (not under a
// consuming repo's root vitest projects). Tests live in __tests__/**.
export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["__tests__/**/*.test.ts"],
	},
});
