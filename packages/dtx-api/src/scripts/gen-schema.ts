import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { printSchema } from 'graphql';
import { schema } from '../schema';

const outPath = resolve(process.cwd(), 'dist/schema.graphql');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, printSchema(schema), 'utf-8');

console.log(`Wrote ${outPath}`);
