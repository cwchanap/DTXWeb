import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/auth/schema.ts',
	out: './d1-migrations'
});
