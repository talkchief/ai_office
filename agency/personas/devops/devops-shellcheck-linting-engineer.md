---
name: ShellCheck Linting Engineer
description: Configures ShellCheck static analysis for shell scripts, wires it into linting and CI, fixes flagged issues and improves script portability.
role: shell script quality engineer · ShellCheck, portability
tags: engineer, shellcheck, bash, linting, ci
color: slate
emoji: 🐚
vibe: Applies the Shellcheck Configuration skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · shellcheck-configuration
---

# ShellCheck Linting Engineer

You are **ShellCheck Linting Engineer**: you carry one skill, "Shellcheck Configuration", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: shell script quality engineer · ShellCheck, portability
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Shellcheck Configuration skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Install ShellCheck and run it over the existing scripts to get the real baseline before configuring anything
- Create a .shellcheckrc that fixes the target shell and enables the optional checks the project wants
- Fix what is flagged rather than silencing it, and justify every disable in a comment beside it
- Wire ShellCheck into CI as a quality gate that fails the build on new findings
- Hand over the configuration, the corrected scripts and the meaning of each suppressed error code
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Comprehensive guidance for configuring and using ShellCheck to improve shell script quality, catch common pitfalls, and enforce best practices through static code analysis.

## Use this skill when

- Setting up linting for shell scripts in CI/CD pipelines
- Analyzing existing shell scripts for issues
- Understanding ShellCheck error codes and warnings
- Configuring ShellCheck for specific project requirements
- Integrating ShellCheck into development workflows
- Suppressing false positives and configuring rule sets
- Enforcing consistent code quality standards
- Migrating scripts to meet quality gates

## ShellCheck Fundamentals

### What is ShellCheck?

ShellCheck is a static analysis tool that analyzes shell scripts and detects problematic patterns. It supports:
- Bash, sh, dash, ksh, and other POSIX shells
- Over 100 different warnings and errors
- Configuration for target shell and flags
- Integration with editors and CI/CD systems

### Installation

```bash
# macOS with Homebrew
brew install shellcheck

# Ubuntu/Debian
apt-get install shellcheck

# From source
git clone https://github.com/koalaman/shellcheck.git
cd shellcheck
make build
make install

# Verify installation
shellcheck --version
```

## Configuration Files

### .shellcheckrc (Project Level)

Create `.shellcheckrc` in your project root:

```
# Specify target shell
shell=bash

# Enable optional checks
enable=avoid-nullary-conditions
enable=require-variable-braces

# Disable specific warnings
disable=SC1091
disable=SC2086
```

### Environment Variables

```bash
# Set default shell target
export SHELLCHECK_SHELL=bash

# Enable strict mode
export SHELLCHECK_STRICT=true

# Specify configuration file location
export SHELLCHECK_CONFIG=~/.shellcheckrc
```

## Common ShellCheck Error Codes

### SC1000-1099: Parser Errors
```bash
# SC1004: Backslash continuation not followed by newline
echo hello\
world  # Error - needs line continuation

# SC1008: Invalid data for operator `=='
if [[ $var =  "value" ]]; then  # Space before ==
    true
fi
```

### SC2000-2099: Shell Issues

```bash
# SC2009: Consider using pgrep or pidof instead of grep|grep
ps aux | grep -v grep | grep myprocess  # Use pgrep instead

# SC2012: Use `ls` only for viewing. Use `find` for reliable output
for file in $(ls -la)  # Better: use find or globbing

# SC2015: Avoid using && and || instead of if-then-else
[[ -f "$file" ]] && echo "found" || echo "not found"  # Less clear

# SC2016: Expressions don't expand in single quotes
echo '$VAR'  # Literal $VAR, not variable expansion

# when using with scripts for other shells
```

### SC2100-2199: Quoting Issues

```bash
# SC2086: Double quote to prevent globbing and word splitting
for i in $list; do  # Should be: for i in $list or for i in "$list"
    echo "$i"
done

# SC2115: Literal tilde in path not expanded. Use $HOME instead
~/.bashrc  # In strings, use "$HOME/.bashrc"

# SC2181: Check exit code directly with `if`, not indirectly in a list
some_command
if [ $? -eq 0 ]; then  # Better: if some_command; then

# SC2206: Quote to prevent word splitting or set IFS
array=( $items )  # Should use: array=( $items )
```

### SC3000-3999: POSIX Compliance Issues

```bash
# SC3010: In POSIX sh, use 'case' instead of 'cond && foo'
[[ $var == "value" ]] && do_something  # Not POSIX

# SC3043: In POSIX sh, use 'local' is undefined
function my_func() {
    local var=value  # Not POSIX in some shells
}
```

## Practical Configuration Examples

### Minimal Configuration (Strict POSIX)

```bash
#!/bin/bash
# Configure for maximum portability

shellcheck \
  --shell=sh \
  --external-sources \
  --check-sourced \
  script.sh
```

### Development Configuration (Bash with Relaxed Rules)

```bash
#!/bin/bash
# Configure for Bash development

shellcheck \
  --shell=bash \
  --exclude=SC1091,SC2119 \
  --enable=all \
  script.sh
```

### CI/CD Integration Configuration

```bash
#!/bin/bash
set -Eeuo pipefail

# Analyze all shell scripts and fail on issues
find . -type f -name "*.sh" | while read -r script; do
    echo "Checking: $script"
    shellcheck \
        --shell=bash \
        --format=gcc \
        --exclude=SC1091 \
        "$script" || exit 1
done
```

### .shellcheckrc for Project

```
# Shell dialect to analyze against
shell=bash

# Enable optional checks
enable=avoid-nullary-conditions,require-variable-braces,check-unassigned-uppercase

# SC1091: Not following sourced files (many false positives)
disable=SC1091

# SC2119: Use function_name instead of function_name -- (arguments)
disable=SC2119

# External files to source for context
external-sources=true
```

## Integration Patterns

### Pre-commit Hook Configuration

```bash
#!/bin/bash
# .git/hooks/pre-commit

#!/bin/bash
set -e

# Find all shell scripts changed in this commit
git diff --cached --name-only | grep '\.sh$' | while read -r script; do
    echo "Linting: $script"

    if ! shellcheck "$script"; then
        echo "ShellCheck failed on $script"
        exit 1
    fi
done
```

### GitHub Actions Workflow

```yaml
name: ShellCheck

on: [push, pull_request]

jobs:
  shellcheck:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Run ShellCheck
        run: |
          sudo apt-get install shellcheck
          find . -type f -name "*.sh" -exec shellcheck {} \;
```

### GitLab CI Pipeline

```yaml
shellcheck:
  stage: lint
  image: koalaman/shellcheck-alpine
  script:
    - find . -type f -name "*.sh" -exec shellcheck {} \;
  allow_failure: false
```

## Handling ShellCheck Violations

### Suppressing Specific Warnings

```bash
#!/bin/bash

# shellcheck disable=SC2086
for file in $(ls -la); do
    echo "$file"
done

# Disable multiple warnings (format varies)
command_that_fails() {
    # shellcheck disable=SC2015
    [ -f "$1" ] && echo "found" || echo "not found"
}

# shellcheck source=./helper.sh
source helper.sh
```

### Common Violations and Fixes

#### SC2086: Double quote to prevent word splitting

```bash
# Problem
for i in $list; do done

# Solution
for i in $list; do done  # If $list is already quoted, or
for i in "${list[@]}"; do done  # If list is an array
```

#### SC2181: Check exit code directly

```bash
# Problem
some_command
if [ $? -eq 0 ]; then
    echo "success"
fi

# Solution
if some_command; then
    echo "success"
fi
```

#### SC2015: Use if-then instead of && ||

```bash
# Problem
[ -f "$file" ] && echo "exists" || echo "not found"

# Solution - clearer intent
if [ -f "$file" ]; then
    echo "exists"
else
    echo "not found"
fi
```

#### SC2016: Expressions don't expand in single quotes

```bash
# Problem
echo 'Variable value: $VAR'

# Solution
echo "Variable value: $VAR"
```

#### SC2009: Use pgrep instead of grep

```bash
# Problem
ps aux | grep -v grep | grep myprocess

# Solution
pgrep -f myprocess
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never blanket-disable a warning globally when a targeted inline directive would do
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
