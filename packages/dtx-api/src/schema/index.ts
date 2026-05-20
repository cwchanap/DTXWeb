import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import './healthz';
import './user';
// Phase 2: additional resolver modules import-registered as they land.
// import './auth';
import './simfile';
import { createContext } from '../context';
import type { Env } from '../env';

export const schema = builder.toSchema();

type YogaServerContext = { env: Env; ctx: ExecutionContext };

export const yoga = createYoga<YogaServerContext>({
	schema,
	context: ({ request, env }) => createContext(request, env),
	graphiql: (_request, { env }) => env.GRAPHIQL === 'true',
	landingPage: false,
	cors: false,
	maskedErrors: true
});
