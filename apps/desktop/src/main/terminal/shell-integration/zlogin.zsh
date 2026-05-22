# exegol-shell-integration (zlogin)
#
# zlogin runs as the LAST init file before zsh enters the prompt loop, so its
# exit status becomes the very first `$?`. Trailing `:` keeps `%?`-themed
# prompts from rendering a red error indicator on a clean shell start.
{
  _exegol_user_zdotdir="${EXEGOL_USER_ZDOTDIR:-$HOME}"
  [ -f "$_exegol_user_zdotdir/.zlogin" ] && source "$_exegol_user_zdotdir/.zlogin"
  unset _exegol_user_zdotdir
}
:
