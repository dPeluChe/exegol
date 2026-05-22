# exegol-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_exegol_ret`.

{
  _exegol_user_zdotdir="${EXEGOL_USER_ZDOTDIR:-$HOME}"
  [ -f "$_exegol_user_zdotdir/.zshrc" ] && source "$_exegol_user_zdotdir/.zshrc"
  unset _exegol_user_zdotdir
}

if [[ -z "$__EXEGOL_HOOKS_LOADED" ]]; then
  __EXEGOL_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # URL-encode $PWD byte-wise so multi-byte paths stay valid in the `file://`
  # URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index bytes (not
  # code points), and LC_ALL=C keeps [a-zA-Z0-9...] single-byte.
  _exegol_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _exegol_precmd() {
    local _exegol_ret=$?
    printf '\e]133;D;%s\e\\' "$_exegol_ret"
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_exegol_urlencode "$PWD")"
    # Re-inject prompt-end marker in case a framework rebuilt PS1 (p10k, starship).
    if [[ "$PS1" != *$'\e]133;B\e\\'* ]]; then
      PS1=$'%{\e]133;B\e\\%}'"$PS1"
    fi
    printf '\e]133;A\e\\'
  }

  _exegol_preexec() {
    printf '\e]133;C\e\\'
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _exegol_precmd
    add-zsh-hook preexec _exegol_preexec
  fi

  _exegol_precmd
fi

# One-shot OSC-777 shell-ready marker — preserves Exegol's existing readiness
# gating (pty-shell-ready.ts watches for this byte sequence). Self-removes
# after firing once.
if [[ -z "$__EXEGOL_SHELL_READY_FIRED" ]]; then
  __EXEGOL_SHELL_READY_FIRED=1
  _exegol_shell_ready() {
    add-zsh-hook -d precmd _exegol_shell_ready 2>/dev/null
    unset -f _exegol_shell_ready 2>/dev/null
    printf '\e]777;exegol-shell-ready\a'
  }
  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _exegol_shell_ready
  fi
fi
:
