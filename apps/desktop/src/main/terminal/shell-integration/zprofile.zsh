# exegol-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _exegol_user_zdotdir="${EXEGOL_USER_ZDOTDIR:-$HOME}"
  [ -f "$_exegol_user_zdotdir/.zprofile" ] && source "$_exegol_user_zdotdir/.zprofile"
  unset _exegol_user_zdotdir
}
:
