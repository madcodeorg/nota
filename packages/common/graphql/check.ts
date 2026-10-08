import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkClientContract } from './src/contract-check';
import * as generated from './src/graphql';

const directory = fileURLToPath(new URL('./src/graphql/', import.meta.url));
const sources = readdirSync(directory, { recursive: true })
  .map(String)
  .filter(file => file.endsWith('.gql'))
  .sort()
  .map(file => readFileSync(join(directory, file), 'utf8'));
const definitions = checkClientContract(sources, generated);
console.log(
  `Checked ${definitions} retained GraphQL definitions; server-schema validation is not included.`
);
