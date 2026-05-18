import { builder } from './builder';

builder.queryField('healthz', (t) =>
	t.string({
		resolve: () => 'ok'
	})
);
