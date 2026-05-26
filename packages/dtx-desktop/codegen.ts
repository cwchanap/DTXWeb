import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: '../dtx-api/dist/schema.graphql',
	documents: ['src/main/graphql/operations/**/*.graphql'],
	generates: {
		'src/main/graphql/generated/graphql.ts': {
			plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
			config: {
				avoidOptionals: {
					field: true,
					inputValue: false,
					object: false,
					defaultValue: true
				},
				skipTypename: true,
				useTypeImports: true,
				enumsAsTypes: false,
				scalars: { ID: 'string' }
			}
		}
	}
};

export default config;
