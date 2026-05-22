# exegol-shell-integration (zshenv)
#
# Trailing `:` is load-bearing — without it, a missing user .zshenv leaves
# $?=1, which propagates through the rest of init into the first prompt's
# `%?` (themes that color the prompt by exit code show red on a clean shell).
{
  _exegol_user_zdotdir="${EXEGOL_USER_ZDOTDIR:-$HOME}"
  [ -f "$_exegol_user_zdotdir/.zshenv" ] && source "$_exegol_user_zdotdir/.zshenv"
  unset _exegol_user_zdotdir
}
:
