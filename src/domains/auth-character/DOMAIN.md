# auth-character Domain

## Owns
- `players`
- `characters`

## Depends On
- Supabase Auth only

## Public API
- `getPlayer`
- `getCharacter`
- `upsertPlayerFromAuthUser`
- `createCharacter`
- `updateCharacterCity`

Import from `@/domains/auth-character` only.

## Rules
- This domain does not own gameplay state beyond identity/profile.
- Character location updates must happen through `updateCharacterCity`.
