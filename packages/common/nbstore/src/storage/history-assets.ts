import {
  AbstractType,
  applyUpdate,
  Array as YArray,
  ContentFormat,
  Doc,
  type Item,
  Map as YMap,
  Text as YText,
} from 'yjs';

/** Collect possible asset IDs without depending on block, database or canvas schemas. */
export function collectCurrentContentStrings(
  bin: Uint8Array,
  canonicalDocIds?: ReadonlySet<string>
) {
  const strings = new Set<string>();
  let preserveAll = false;
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.add(value);
    } else if (value && typeof value === 'object') {
      if (visited.has(value)) return;
      visited.add(value);
      if (value instanceof Doc) {
        strings.add(value.guid);
        // Nota's legacy `spaces` root keeps subdoc references while canonical
        // page bytes live in separately clocked nbstore documents.
        if (!canonicalDocIds?.has(value.guid)) preserveAll = true;
      } else if (value instanceof YMap && value.constructor === YMap) {
        for (const [key, child] of value) {
          strings.add(key);
          visit(child);
        }
      } else if (value instanceof YArray) {
        for (const child of value.toArray()) visit(child);
      } else if (value instanceof YText && value.constructor === YText) {
        strings.add(value.toString());
        visit(value.toDelta());
      } else if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (
        !(value instanceof AbstractType) &&
        (Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === null)
      ) {
        for (const [key, child] of Object.entries(value)) {
          strings.add(key);
          visit(child);
        }
      } else {
        // Binary payloads, XML and subdocs can encode references we cannot inspect.
        preserveAll = true;
      }
    }
  };
  const doc = new Doc();
  try {
    applyUpdate(doc, bin);
    if (doc.store.pendingStructs || doc.store.pendingDs) preserveAll = true;
    for (const [key, root] of doc.share) {
      strings.add(key);
      // Constructors of root types are not encoded. Map entries and generic
      // sequence values remain readable with these public collection APIs.
      if (root._start && root._map.size) preserveAll = true;
      else if (root._start) {
        // Generic sequence readers omit text formatting attributes. An unknown
        // formatted root must refuse cleanup rather than hide an asset ID.
        for (let item: Item | null = root._start; item; item = item.right) {
          if (!item.deleted && item.content instanceof ContentFormat)
            preserveAll = true;
        }
        const sequence = doc.getArray(key).toArray();
        visit(sequence);
        // Text root content is exposed as characters through an array reader.
        // Keep the complete string too, including strings split across edits.
        if (sequence.every(value => typeof value === 'string'))
          strings.add(sequence.join(''));
      } else visit(doc.getMap(key));
    }
  } catch {
    // Unreadable or future content must never make recovery destructive.
    preserveAll = true;
  } finally {
    doc.destroy();
  }
  return { strings, preserveAll };
}
