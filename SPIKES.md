# Phase 1 — spike results

Run against the live devnet TEE rollup (`devnet-tee.magicblock.app`) and the
real VRF oracle on 2026-09-09. All three passed, so the design stands.

## 1a · Committing rollup state back to Solana — PASS

A counter delegated to the TEE, incremented inside the rollup, then committed
without undelegating. The new value appears on Solana about ten seconds later.

Why it mattered: the pot lives on Solana and pays out from there, so the result
of a game played inside a rollup has to be able to reach it. If this had failed
the whole settlement model would have needed rethinking.

## 1b · A room nobody can read — PASS

An ephemeral permission created with `is_private: true` and an **empty** member
list. Afterwards the account is refused to everyone: anonymous readers, an
authenticated stranger, and its own owner.

Why it mattered: players must not read each other's sealed answers, so a
permission listing every player is useless — the program inside the rollup needs
to see the answers and nobody outside it does. The fallback was one permissioned
account per player, which costs ER-local rent per account and drags the fee payer
back into a problem that took days to solve last time. Not needed.

## 1c · VRF inside a rollup — PASS

`request_roll` from inside the rollup against `DEFAULT_EPHEMERAL_QUEUE`, and the
callback landed randomness in the account within a few seconds. Repeatable.

Why it mattered: the rule that defeats collusion — majority survives or minority
survives — is drawn *after* every answer is sealed. Without VRF in the rollup
there is no honest way to do that.

## Two client bugs found on the way

The IDL declares the delegation record and metadata PDAs as being derived under
an account reference (`delegation_program`), not a literal. A builder that only
handles literal program ids derives a plausible-looking address and the program
rejects it with a seeds-constraint violation.

Reads must pin `commitment: confirmed`. Writing at confirmed and reading at the
default finalized makes a freshly created account look absent.
