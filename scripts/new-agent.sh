#!/usr/bin/env bash
set -euo pipefail

# scripts/new-agent.sh
# Scaffolds a new TGL agent from agents/_TEMPLATE/SKILL.md,
# initialises its memory file, and registers it in config/agents.yaml.

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <name> <department>"
  echo "Example: $0 prospect-researcher revenue"
  exit 1
fi

NAME="$1"
DEPARTMENT="$2"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="${REPO_ROOT}/agents/_TEMPLATE/SKILL.md"
TARGET_DIR="${REPO_ROOT}/agents/${NAME}"
TARGET_SKILL="${TARGET_DIR}/SKILL.md"
TARGET_MEMORY="${REPO_ROOT}/memory/${NAME}.md"
AGENTS_CONFIG="${REPO_ROOT}/config/agents.yaml"

if [ ! -f "${TEMPLATE_FILE}" ]; then
  echo "Error: Template not found at ${TEMPLATE_FILE}" >&2
  exit 1
fi

if [ -d "${TARGET_DIR}" ]; then
  echo "Error: Agent directory already exists at ${TARGET_DIR}" >&2
  exit 1
fi

# 1. Create agent directory and scaffold SKILL.md
mkdir -p "${TARGET_DIR}"
sed -e "s/{{AGENT_NAME}}/${NAME}/g" \
    -e "s/{{DEPARTMENT}}/${DEPARTMENT}/g" \
    "${TEMPLATE_FILE}" > "${TARGET_SKILL}"

# 2. Create memory file
mkdir -p "${REPO_ROOT}/memory"
if [ ! -f "${TARGET_MEMORY}" ]; then
  cat <<EOF > "${TARGET_MEMORY}"
# Memory — ${NAME}
**Department:** ${DEPARTMENT}
**Created:** $(date +%Y-%m-%d)

## Accumulated Heuristics & Rules
- [Record rules learned from feedback and execution]

## Pitfalls & Anti-Patterns Avoided
- [Record rejected patterns and operational gotchas]
EOF
fi

# 3. Resolve channel and reviewer
CHANNEL="#${DEPARTMENT}"
REVIEWER="Chief of Staff"

case "${DEPARTMENT}" in
  revenue)
    CHANNEL="#revenue"
    REVIEWER="Chief of Staff"
    ;;
  doors-aeo|aeo)
    CHANNEL="#doors-aeo"
    REVIEWER="Creative Director"
    ;;
  doors-ai|ai)
    CHANNEL="#doors-ai"
    REVIEWER="Chief of Staff"
    ;;
  doors-truelead|truelead)
    CHANNEL="#doors-truelead"
    REVIEWER="Chief of Staff"
    ;;
  marketing)
    CHANNEL="#marketing"
    REVIEWER="Creative Director"
    ;;
  ops)
    CHANNEL="#ops"
    REVIEWER="Chief of Staff"
    ;;
  people)
    CHANNEL="#people"
    REVIEWER="Chief of Staff"
    ;;
  finance)
    CHANNEL="#finance"
    REVIEWER="Architect"
    ;;
  office-of-the-architect|architect)
    CHANNEL="#standup"
    REVIEWER="Architect"
    ;;
esac

TRIGGER="Issue labelled for:${NAME}, mention @${NAME}"

# 4. Append to config/agents.yaml if not already present
mkdir -p "$(dirname "${AGENTS_CONFIG}")"
if [ ! -f "${AGENTS_CONFIG}" ]; then
  echo "# The Growth Lab — Agent Directory" > "${AGENTS_CONFIG}"
fi

if ! grep -q "name: ${NAME}$" "${AGENTS_CONFIG}" 2>/dev/null; then
  cat <<EOF >> "${AGENTS_CONFIG}"

- name: ${NAME}
  department: ${DEPARTMENT}
  channel: "${CHANNEL}"
  trigger: "${TRIGGER}"
  reviewer: "${REVIEWER}"
  status: planned
EOF
fi

echo "Successfully scaffolded agent '${NAME}':"
echo "  - Skill file: agents/${NAME}/SKILL.md"
echo "  - Memory file: memory/${NAME}.md"
echo "  - Registered in: config/agents.yaml (department: ${DEPARTMENT}, channel: ${CHANNEL}, reviewer: ${REVIEWER})"
