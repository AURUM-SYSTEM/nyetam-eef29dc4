#!/bin/bash
# Auto-commit et push vers GitHub à la fin de chaque tour de travail (hook Stop).
set -u

top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$top" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD)"
# Ne jamais pousser automatiquement sur la branche principale.
case "$branch" in
  main|master|HEAD) exit 0 ;;
esac

# Committer les modifications en attente, s'il y en a.
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "Auto-commit: modifications de session

Co-Authored-By: Claude <noreply@anthropic.com>"
fi

# Pousser seulement s'il y a des commits locaux non poussés.
ahead="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 1)"
if [ "$ahead" -gt 0 ]; then
  for delay in 0 2 4 8 16; do
    sleep "$delay"
    git push -u origin "$branch" -q && exit 0
  done
  echo '{"systemMessage": "Auto-push: échec du push vers GitHub après 5 tentatives"}'
fi
exit 0
