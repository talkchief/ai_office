---
name: IT Professional Postgresql Cli
description: PostgreSQL interactive terminal (psql) reference and usage guide.
color: slate
emoji: 🛠️
vibe: Applies the Postgresql Cli skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · postgresql-cli
---

# IT Professional Postgresql Cli Agent

You are **IT Professional Postgresql Cli**: you carry one skill, "Postgresql Cli", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Postgresql Cli specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Postgresql Cli skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Postgresql Cli skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# psql — PostgreSQL Interactive Terminal

psql is PostgreSQL's feature-rich interactive terminal. It lets you write and execute queries, inspect database objects, import/export data, script batch operations, and customize output formatting — all from the command line.

## Prerequisites

Before using psql, verify it is installed and available:

```bash
# Check if psql is installed
psql --version

# If not found, install PostgreSQL client tools:

# macOS (Homebrew)
brew install libpq
brew link --force libpq

# Ubuntu / Debian
sudo apt install postgresql-client

# CentOS / RHEL
sudo yum install postgresql

# Alpine
apk add postgresql-client

# Windows — install PostgreSQL via the official installer or use WSL
```

psql ships as part of the `postgresql-client` package. The server (`postgresql`) is not required — you only need the client to connect to a remote PostgreSQL instance.

## Quick Reference

### Connecting

```
# 1. CLI flags
psql -h host -p port -U user -d dbname

# 2. Connection URI
# WARNING: Password in URI is visible in shell history and process listings.
#          Prefer ~/.pgpass for production use (see method 4 below).
psql "postgresql://user:YOUR_PASSWORD@host:port/dbname"

# 3. Environment variables (no flags needed)
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=mydb
export PGUSER=postgres
# WARNING: PGPASSWORD is visible in process listings (e.g. `ps aux`).
#          Use ~/.pgpass in production instead.
export PGPASSWORD=YOUR_PASSWORD
psql                       # picks up all params from env

# 4. ~/.pgpass file (RECOMMENDED for passwords)
#    Format: hostname:port:database:username:password
touch ~/.pgpass && chmod 600 ~/.pgpass
# Then manually edit ~/.pgpass and add entries (avoids password in shell history):
# hostname:port:database:username:password
# Example: localhost:5432:mydb:postgres:YOUR_PASSWORD
psql -h localhost -U postgres -d mydb   # no password prompt

# 5. Execute and exit
psql -f script.sql dbname                        # execute file then exit
psql -c "SELECT 1" dbname                        # run single command then exit
psql -1 -f migration.sql dbname                  # run in single transaction

# 6. Service connection (reads from pg_service.conf)
psql service=mydb_prod

# 7. Reconnect within a session
\c dbname                                       # reconnect to different db
\c -reuse-previous=on sslmode=require           # change only sslmode
\c "host=newhost port=5432 dbname=mydb"         # conninfo string
```

On connection failure: interactive mode keeps the previous connection; script mode closes it and all subsequent database commands fail until the next successful `\c`.

Key flags: `-h` host, `-p` port, `-U` user, `-d` database, `-w` no password prompt, `-W` force password prompt, `-1` single transaction, `-f` execute file, `-c` execute command, `-t` tuples only, `-x` expanded, `-A` unaligned, `-E` echo hidden queries (`\d` internals), `-L` log file, `-X` skip `~/.psqlrc`.

**Connection precedence**: CLI flags > environment variables > `pg_service.conf` > defaults. **Password precedence**: connection string/password flag > `PGPASSWORD` env > `~/.pgpass`. Use `~/.pgpass` instead of `PGPASSWORD` in production — `PGPASSWORD` is visible in process listings (`ps aux`).

### Object Inspection (\d family)

| Command           | Shows                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `\d`            | All tables, views, materialized views, sequences, foreign tables (equiv.`\dtvmsE`)                  |
| `\dP`           | Partitioned tables                                                                                    |
| `\dt`           | Tables only                                                                                           |
| `\dv`           | Views only                                                                                            |
| `\di`           | Indexes only                                                                                          |
| `\ds`           | Sequences only                                                                                        |
| `\dm`           | Materialized views only                                                                               |
| `\det`          | Foreign tables (mnemonic: "external tables")                                                          |
| `\dT`           | Data types                                                                                            |
| `\df`           | Functions (use modifiers:`a`=aggregate, `n`=normal, `p`=procedure, `t`=trigger, `w`=window) |
| `\da`           | Aggregate functions                                                                                   |
| `\dn`           | Schemas                                                                                               |
| `\du` / `\dg` | Roles                                                                                                 |
| `\db`           | Tablespaces                                                                                           |
| `\dc`           | Conversions                                                                                           |
| `\dD`           | Domains                                                                                               |
| `\dl`           | Large objects (alias for `\lo_list`)                                                                |
| `\dF`           | Text search configurations                                                                            |
| `\dFd`          | Text search dictionaries                                                                              |
| `\dFp`          | Text search parsers                                                                                   |
| `\dFt`          | Text search templates                                                                                 |
| `\des`          | Foreign servers                                                                                       |
| `\deu`          | User mappings                                                                                         |
| `\dew`          | Foreign-data wrappers                                                                                 |
| `\dp`           | Privileges (GRANT/REVOKE)                                                                             |
| `\drds`         | Per-role and per-database configuration settings                                                      |
| `\l`            | List databases (accepts pattern:`\l test*`)

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
