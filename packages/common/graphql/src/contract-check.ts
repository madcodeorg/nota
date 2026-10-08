import {
  type ExecutableDefinitionNode,
  Kind,
  parse,
  print,
  visit,
} from 'graphql';
import { lowerFirst, upperFirst } from 'lodash-es';

type QueryExport = string | { id: string; op: string; query: string };

function exportedName(definition: ExecutableDefinitionNode) {
  const name = lowerFirst(definition.name?.value);
  const suffix =
    definition.kind === Kind.OPERATION_DEFINITION
      ? upperFirst(definition.operation)
      : 'Fragment';
  return name.endsWith(suffix) ? name : name + suffix;
}

function executableDefinitions(source: string) {
  return parse(source).definitions.map(definition => {
    if (
      (definition.kind !== Kind.OPERATION_DEFINITION &&
        definition.kind !== Kind.FRAGMENT_DEFINITION) ||
      !definition.name
    ) {
      throw new Error(
        'Legacy client documents must contain named operations or fragments'
      );
    }
    return definition;
  });
}

// Check retained frontend text without inventing or importing a server schema.
export function checkClientContract(
  sources: string[],
  generated: Record<string, QueryExport>
) {
  const expected = new Map<string, ExecutableDefinitionNode>();
  for (const source of sources) {
    for (const definition of executableDefinitions(source)) {
      const name = exportedName(definition);
      if (expected.has(name))
        throw new Error(`Duplicate client export: ${name}`);
      expected.set(name, definition);
    }
  }
  const sourceFragments = [...expected.values()].filter(
    node => node.kind === Kind.FRAGMENT_DEFINITION
  );

  for (const [name, definition] of expected) {
    const value = generated[name];
    if (!value) throw new Error(`Missing generated client export: ${name}`);
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      if (
        typeof value === 'string' ||
        value.id !== name ||
        value.op !== definition.name?.value
      ) {
        throw new Error(`Stale generated operation metadata: ${name}`);
      }
    } else if (typeof value !== 'string') {
      throw new Error(`Invalid generated fragment export: ${name}`);
    }

    const definitions = executableDefinitions(
      typeof value === 'string' ? value : value.query
    );
    const fragments = new Map(
      (definition.kind === Kind.FRAGMENT_DEFINITION
        ? sourceFragments
        : definitions
      )
        .filter(node => node.kind === Kind.FRAGMENT_DEFINITION)
        .map(node => [node.name?.value, node])
    );
    for (const node of definitions) {
      const original = expected.get(exportedName(node));
      if (!original || print(original) !== print(node)) {
        throw new Error(`Stale generated query text: ${name}`);
      }
    }
    if (!definitions.some(node => exportedName(node) === name)) {
      throw new Error(`Missing generated definition: ${name}`);
    }
    const checkSpreads = (
      node: ExecutableDefinitionNode,
      ancestors: string[] = []
    ): void => {
      visit(node, {
        FragmentSpread(spread) {
          const fragment = fragments.get(spread.name.value);
          if (!fragment) {
            throw new Error(
              `Missing generated fragment ${spread.name.value} in ${name}`
            );
          }
          if (ancestors.includes(spread.name.value)) {
            throw new Error(`Cyclic client fragment: ${spread.name.value}`);
          }
          checkSpreads(fragment, [...ancestors, spread.name.value]);
        },
      });
    };
    for (const node of definitions) checkSpreads(node);
  }

  for (const name of Object.keys(generated)) {
    if (!expected.has(name))
      throw new Error(`Obsolete generated client export: ${name}`);
  }
  return expected.size;
}
