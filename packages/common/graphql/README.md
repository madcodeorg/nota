# Retained GraphQL Client

This package keeps the generated frontend compatibility contracts used by
remaining legacy UI modules. It is not the schema for Nota's local AI backend.
The old cloud server and its schema are not distributed with Nota.

Run `yarn workspace @nota/graphql check` to check document syntax, named exports,
fragment references and generated query text against the checked-in `.gql`
files. CI runs this check without a server or network connection. It does not
validate fields against a server schema or regenerate the frozen types in
`src/schema.ts`, upload metadata or deprecation metadata.

Full code generation is only available when a maintainer supplies an
appropriately licensed authoritative schema through
`NOTA_LEGACY_GRAPHQL_SCHEMA_PATH`. Do not restore the removed server directory
to make code generation run. Changes to legacy field/variable contracts require
an explicit schema and generated-type review.
