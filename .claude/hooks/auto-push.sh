#!/bin/bash
# Auto-commit et push vers GitHub à la fin de chaque tour de travail (hook Stop).
# Les modifications sont propagées jusqu'à `main` (autorisation explicite du
# propriétaire, 2026-07-05) pour que Lovable, synchronisé sur main, les reçoive
# immédiatement — sans étape de pull request.
set -u

top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$top" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "HEAD" ] && exit 0 # détaché : ne rien faire

push_with_retry() {
  for delay in 0 2 4 8 16; do
    sleep "$delay"
    git push "$@" -q && return 0
  done
  return 1
}

# Committer les modifications en attente, s'il y en a.
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "Auto-commit: modifications de session

Co-Authored-By: Claude <noreply@anthropic.com>"
fi

# Pousser la branche courante s'il y a des commits locaux non poussés.
ahead="$(git rev-list --count "@{u}"..HEAD 2>/dev/null || echo 1)"
if [ "$ahead" -gt 0 ]; then
  push_with_retry -u origin "$branch" || {
    echo '{"systemMessage": "Auto-push: échec du push de la branche courante après 5 tentatives"}'
    exit 0
  }
fi

# Propager jusqu'à main pour la synchro Lovable.
if [ "$branch" != "main" ]; then
  git fetch origin main -q 2>/dev/null || true
  if ! git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
    # main a avancé côté distant (ex. édition Lovable) : on l'intègre d'abord.
    if ! git merge --no-edit -q origin/main; then
      git merge --abort 2>/dev/null
      echo '{"systemMessage": "Auto-push: conflit avec origin/main — fusion manuelle requise, main non mis à jour"}'
      exit 0
    fi
    push_with_retry -u origin "$branch"
  fi
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
    push_with_retry origin HEAD:main || {
      echo '{"systemMessage": "Auto-push: échec du push vers main après 5 tentatives"}'
    }
  fi
fi
exit 0
